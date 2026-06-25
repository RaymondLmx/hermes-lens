from __future__ import annotations

import asyncio
from collections import deque
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from .schemas import EventValidationError, HermesMonitorEvent
from .session_index import SessionSummary, build_session_summary


class SessionNotFoundError(FileNotFoundError):
    pass


@dataclass(frozen=True, slots=True)
class ReadResult:
    events: list[HermesMonitorEvent]
    invalid_lines: list[dict[str, object]]


class JsonlEventStore:
    def __init__(
        self,
        events_dir: Path,
        *,
        heartbeat_ttl_seconds: float = 30.0,
        poll_interval_seconds: float = 0.5,
    ) -> None:
        self.events_dir = events_dir.resolve()
        self.heartbeat_ttl_seconds = heartbeat_ttl_seconds
        self.poll_interval_seconds = poll_interval_seconds

    def _session_path(self, session_id: str) -> Path:
        if (
            not session_id
            or Path(session_id).name != session_id
            or session_id.endswith(".jsonl")
        ):
            raise SessionNotFoundError(session_id)
        path = self.events_dir / f"{session_id}.jsonl"
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(self.events_dir)
        except (FileNotFoundError, ValueError):
            raise SessionNotFoundError(session_id)
        if not resolved.is_file():
            raise SessionNotFoundError(session_id)
        return resolved

    def session_exists(self, session_id: str) -> bool:
        try:
            self._session_path(session_id)
        except SessionNotFoundError:
            return False
        return True

    def read_session(self, session_id: str) -> ReadResult:
        return self._read_path(self._session_path(session_id), session_id)

    def read_session_tail(self, session_id: str, limit: int) -> ReadResult:
        path = self._session_path(session_id)
        if limit <= 0:
            return ReadResult(events=[], invalid_lines=[])
        with path.open("r", encoding="utf-8") as stream:
            lines = deque(enumerate(stream, start=1), maxlen=limit)
        return self._parse_lines(lines, session_id)

    def _read_path(self, path: Path, session_id: str | None = None) -> ReadResult:
        with path.open("r", encoding="utf-8") as stream:
            return self._parse_lines(enumerate(stream, start=1), session_id)

    def _parse_lines(
        self,
        lines,
        session_id: str | None,
    ) -> ReadResult:
        events: list[HermesMonitorEvent] = []
        invalid_lines: list[dict[str, object]] = []
        for line_number, line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                data = json.loads(stripped)
                event = HermesMonitorEvent.from_dict(data)
            except (json.JSONDecodeError, EventValidationError) as exc:
                invalid_lines.append(
                    {"line": line_number, "error": str(exc)}
                )
                continue
            if session_id is not None and event.session_id != session_id:
                invalid_lines.append(
                    {
                        "line": line_number,
                        "error": "event session_id does not match JSONL filename",
                    }
                )
                continue
            events.append(event)
        events.sort(key=lambda event: (event.seq, event.ts))
        return ReadResult(events=events, invalid_lines=invalid_lines)

    def list_sessions(
        self,
        *,
        now: datetime | None = None,
    ) -> list[SessionSummary]:
        now = now or datetime.now(timezone.utc)
        if not self.events_dir.is_dir():
            return []

        summaries: list[SessionSummary] = []
        for path in self.events_dir.glob("*.jsonl"):
            try:
                resolved = path.resolve(strict=True)
                resolved.relative_to(self.events_dir)
            except (FileNotFoundError, ValueError):
                continue
            result = self._read_path(resolved, path.stem)
            summaries.append(
                build_session_summary(
                    path.stem,
                    result.events,
                    now=now,
                    heartbeat_ttl_seconds=self.heartbeat_ttl_seconds,
                    invalid_line_count=len(result.invalid_lines),
                )
            )

        summaries.sort(
            key=lambda summary: summary.last_seen or datetime.min.replace(
                tzinfo=timezone.utc
            ),
            reverse=True,
        )
        return summaries

    async def stream_session(
        self,
        session_id: str,
        *,
        after_seq: int = -1,
    ) -> AsyncIterator[HermesMonitorEvent]:
        path = self._session_path(session_id)
        pending = ""

        with path.open("r", encoding="utf-8") as stream:
            while True:
                chunk = stream.read()
                if chunk:
                    pending += chunk
                    lines = pending.splitlines(keepends=True)
                    pending = ""
                    for line in lines:
                        if not line.endswith(("\n", "\r")):
                            pending = line
                            continue
                        stripped = line.strip()
                        if not stripped:
                            continue
                        try:
                            event = HermesMonitorEvent.from_dict(
                                json.loads(stripped)
                            )
                        except (json.JSONDecodeError, EventValidationError):
                            continue
                        if event.seq > after_seq:
                            yield event
                            after_seq = event.seq
                await asyncio.sleep(self.poll_interval_seconds)
