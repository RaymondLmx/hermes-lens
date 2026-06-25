from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from httpx import ASGITransport, AsyncClient

from backend.config import Settings
from backend.main import create_app


def event(seq: int, event_type: str, **overrides) -> dict[str, object]:
    data = {
        "schema_version": 1,
        "session_id": "session-1",
        "turn_id": None,
        "seq": seq,
        "ts": f"2026-06-24T10:00:{seq:02d}+08:00",
        "source": "hermes",
        "type": event_type,
        "importance": "normal",
        "group_id": None,
        "agent_id": "demo-agent",
        "agent_name": "Demo Agent",
        "profile": "demo",
        "payload": {},
    }
    data.update(overrides)
    return data


def write_events(path: Path, events: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(f"{json.dumps(item)}\n" for item in events),
        encoding="utf-8",
    )


class ApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.events_dir = root / "events"
        self.media_dir = root / "media"
        self.events_dir.mkdir()
        self.media_dir.mkdir()
        write_events(
            self.events_dir / "session-1.jsonl",
            [
                event(1, "session.start"),
                event(2, "session.heartbeat"),
            ],
        )
        settings = Settings(
            events_dir=self.events_dir,
            media_roots=(self.media_dir.resolve(),),
            heartbeat_ttl_seconds=30,
            poll_interval_seconds=0.01,
        )
        self.client = AsyncClient(
            transport=ASGITransport(app=create_app(settings)),
            base_url="http://testserver",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        self.temp_dir.cleanup()

    async def test_health(self):
        response = await self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    async def test_lists_sessions_with_agent_identity(self):
        response = await self.client.get("/api/sessions")

        self.assertEqual(response.status_code, 200)
        session = response.json()["sessions"][0]
        self.assertEqual(session["session_id"], "session-1")
        self.assertEqual(session["agent_id"], "demo-agent")
        self.assertEqual(session["profile"], "demo")

    async def test_reads_events_and_reports_invalid_lines(self):
        with (self.events_dir / "session-1.jsonl").open(
            "a",
            encoding="utf-8",
        ) as stream:
            stream.write("{partial")

        response = await self.client.get("/api/sessions/session-1/events")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["events"]), 2)
        self.assertEqual(body["warnings"][0]["line"], 3)

    async def test_limits_initial_event_history(self):
        write_events(
            self.events_dir / "session-1.jsonl",
            [event(seq, "session.heartbeat") for seq in range(1, 6)],
        )

        response = await self.client.get(
            "/api/sessions/session-1/events",
            params={"limit": 2},
        )

        self.assertEqual(
            [item["seq"] for item in response.json()["events"]],
            [4, 5],
        )

    async def test_rejects_unknown_session(self):
        response = await self.client.get("/api/sessions/missing/events")

        self.assertEqual(response.status_code, 404)

    async def test_serves_media_only_from_allowlisted_root(self):
        image = self.media_dir / "frame.jpg"
        image.write_bytes(b"frame")

        allowed = await self.client.get("/api/media", params={"path": str(image)})
        denied = await self.client.get(
            "/api/media",
            params={"path": str(self.events_dir / "session-1.jsonl")},
        )

        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.content, b"frame")
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
