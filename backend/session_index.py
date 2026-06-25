from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable

from .schemas import HermesMonitorEvent, SessionStatus


def _payload_string(event: HermesMonitorEvent, field: str) -> str | None:
    value = event.payload.get(field)
    return value if isinstance(value, str) and value else None


def _preview(event: HermesMonitorEvent) -> str | None:
    for field in ("text", "content", "message", "summary"):
        value = event.payload.get(field)
        if isinstance(value, str) and value:
            return value[:200]
    return None


ACTIVITY_EVENT_TYPES = {
    "user.message",
    "assistant.delta",
    "assistant.done",
    "tool.start",
    "tool.progress",
    "tool.done",
    "tool.error",
    "warning",
    "error",
}


def _is_activity_event(event: HermesMonitorEvent) -> bool:
    if event.type in ACTIVITY_EVENT_TYPES:
        return True
    return (
        event.type.startswith("robot.")
        or event.type.startswith("vision.")
        or "reasoning" in event.type
        or "thinking" in event.type
    )


@dataclass(slots=True)
class SessionSummary:
    session_id: str
    status: SessionStatus = SessionStatus.UNKNOWN
    agent_id: str = "unknown"
    agent_name: str = "unknown"
    profile: str = "unknown"
    sources: set[str] = field(default_factory=set)
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    last_activity_seen: datetime | None = None
    last_heartbeat: datetime | None = None
    current_turn_id: str | None = None
    running_tools: set[str] = field(default_factory=set)
    last_user_preview: str | None = None
    last_assistant_preview: str | None = None
    error_count: int = 0
    event_count: int = 0
    last_seq: int = -1
    done: bool = False
    failed: bool = False
    invalid_line_count: int = 0

    def to_dict(self, now: datetime) -> dict[str, object]:
        active = self.status in {SessionStatus.RUNNING, SessionStatus.IDLE}
        heartbeat_age = None
        if self.last_heartbeat is not None:
            heartbeat_age = max(
                0.0,
                (now.astimezone(timezone.utc) - self.last_heartbeat).total_seconds(),
            )
        return {
            "session_id": self.session_id,
            "status": self.status.value,
            "active": active,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "profile": self.profile,
            "sources": sorted(self.sources),
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "last_activity_seen": (
                self.last_activity_seen.isoformat()
                if self.last_activity_seen
                else None
            ),
            "last_heartbeat": (
                self.last_heartbeat.isoformat() if self.last_heartbeat else None
            ),
            "heartbeat_age_seconds": heartbeat_age,
            "current_turn_id": self.current_turn_id,
            "running_tools": sorted(self.running_tools),
            "last_user_preview": self.last_user_preview,
            "last_assistant_preview": self.last_assistant_preview,
            "error_count": self.error_count,
            "event_count": self.event_count,
            "last_seq": self.last_seq,
            "invalid_line_count": self.invalid_line_count,
        }


def build_session_summary(
    session_id: str,
    events: Iterable[HermesMonitorEvent],
    *,
    now: datetime,
    heartbeat_ttl_seconds: float,
    invalid_line_count: int = 0,
) -> SessionSummary:
    summary = SessionSummary(
        session_id=session_id,
        invalid_line_count=invalid_line_count,
    )

    for event in events:
        summary.event_count += 1
        summary.last_seq = max(summary.last_seq, event.seq)
        summary.sources.add(event.source)
        summary.first_seen = min(
            filter(None, (summary.first_seen, event.ts)),
            default=event.ts,
        )
        summary.last_seen = max(
            filter(None, (summary.last_seen, event.ts)),
            default=event.ts,
        )
        if _is_activity_event(event):
            summary.last_activity_seen = max(
                filter(None, (summary.last_activity_seen, event.ts)),
                default=event.ts,
            )

        summary.agent_id = (
            event.agent_id
            or _payload_string(event, "agent_id")
            or summary.agent_id
        )
        summary.agent_name = (
            event.agent_name
            or _payload_string(event, "agent_name")
            or summary.agent_name
        )
        summary.profile = (
            event.profile
            or _payload_string(event, "profile")
            or summary.profile
        )

        if event.type == "session.heartbeat":
            summary.last_heartbeat = event.ts
        elif event.type == "session.done":
            summary.done = True
            payload_status = event.payload.get("status")
            summary.failed = payload_status in {"error", "failed"}
        elif event.type == "turn.start":
            summary.current_turn_id = event.turn_id
        elif event.type == "turn.done":
            if not event.turn_id or event.turn_id == summary.current_turn_id:
                summary.current_turn_id = None
        elif event.type == "tool.start":
            summary.running_tools.add(event.group_id or f"seq:{event.seq}")
        elif event.type in {"tool.done", "tool.error"}:
            summary.running_tools.discard(event.group_id or f"seq:{event.seq}")

        if event.type == "user.message":
            summary.last_user_preview = _preview(event)
        elif event.type == "assistant.done":
            summary.last_assistant_preview = _preview(event)

        if event.type in {"error", "tool.error", "robot.action.error"}:
            summary.error_count += 1
            if event.type == "error" and event.payload.get("scope") == "session":
                summary.failed = True

    if summary.failed:
        summary.status = SessionStatus.ERROR
    elif summary.done:
        summary.status = SessionStatus.DONE
    elif summary.last_heartbeat is None:
        summary.status = SessionStatus.UNKNOWN
    elif now.astimezone(timezone.utc) - summary.last_heartbeat > timedelta(
        seconds=heartbeat_ttl_seconds
    ):
        summary.status = SessionStatus.STALE
    elif summary.current_turn_id is not None or summary.running_tools:
        summary.status = SessionStatus.RUNNING
    else:
        summary.status = SessionStatus.IDLE

    return summary
