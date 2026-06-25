from __future__ import annotations

import json
import mimetypes
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from backend.config import Settings
from backend.event_store import JsonlEventStore, SessionNotFoundError
from backend.media import MediaAccessDeniedError, resolve_media_path


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = JsonlEventStore(
        settings.events_dir,
        heartbeat_ttl_seconds=settings.heartbeat_ttl_seconds,
        poll_interval_seconds=settings.poll_interval_seconds,
    )
    app = FastAPI(title="Hermes Lens API", version="0.1.0")

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/sessions")
    async def list_sessions() -> dict[str, object]:
        now = datetime.now(timezone.utc)
        sessions = [
            summary.to_dict(now)
            for summary in store.list_sessions(now=now)
        ]
        return {"sessions": sessions}

    @app.get("/api/sessions/{session_id}/events")
    async def get_events(
        session_id: str,
        limit: int | None = Query(default=None, ge=1, le=5000),
    ) -> dict[str, object]:
        try:
            result = (
                store.read_session_tail(session_id, limit)
                if limit is not None
                else store.read_session(session_id)
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        return {
            "session_id": session_id,
            "events": [event.to_dict() for event in result.events],
            "warnings": result.invalid_lines,
        }

    @app.get("/api/sessions/{session_id}/stream")
    async def stream_events(
        session_id: str,
        request: Request,
        after_seq: int = Query(default=-1, ge=-1),
    ) -> StreamingResponse:
        if not store.session_exists(session_id):
            raise HTTPException(status_code=404, detail="session not found")

        async def generate():
            async for event in store.stream_session(
                session_id,
                after_seq=after_seq,
            ):
                if await request.is_disconnected():
                    break
                yield (
                    f"id: {event.seq}\n"
                    f"event: monitor-event\n"
                    f"data: {json.dumps(event.to_dict(), ensure_ascii=False)}\n\n"
                )

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/api/media")
    async def get_media(path: str = Query(min_length=1)) -> StreamingResponse:
        try:
            media_path = resolve_media_path(path, settings.media_roots)
        except MediaAccessDeniedError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="media not found") from exc

        async def read_chunks():
            with media_path.open("rb") as stream:
                while chunk := stream.read(64 * 1024):
                    yield chunk

        media_type, _ = mimetypes.guess_type(media_path.name)
        return StreamingResponse(
            read_chunks(),
            media_type=media_type or "application/octet-stream",
            headers={
                "Content-Disposition": (
                    f"inline; filename*=UTF-8''{quote(media_path.name)}"
                ),
                "X-Content-Type-Options": "nosniff",
            },
        )

    return app


app = create_app()
