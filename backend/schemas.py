from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any


class EventImportance(StrEnum):
    PRIMARY = "primary"
    NORMAL = "normal"
    DETAIL = "detail"
    DEBUG = "debug"


class SessionStatus(StrEnum):
    RUNNING = "running"
    IDLE = "idle"
    STALE = "stale"
    DONE = "done"
    ERROR = "error"
    UNKNOWN = "unknown"


KNOWN_EVENT_TYPES = frozenset(
    {
        "session.start",
        "session.heartbeat",
        "session.done",
        "turn.start",
        "turn.done",
        "user.message",
        "assistant.start",
        "assistant.delta",
        "assistant.done",
        "reasoning.delta",
        "thinking.delta",
        "tool.start",
        "tool.progress",
        "tool.done",
        "tool.error",
        "vision.frame",
        "vision.analysis",
        "robot.action.start",
        "robot.action.progress",
        "robot.action.done",
        "robot.action.error",
        "status.update",
        "warning",
        "error",
        "debug.log",
    }
)


class EventValidationError(ValueError):
    pass


def _required_string(data: dict[str, Any], field: str) -> str:
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        raise EventValidationError(f"{field} must be a non-empty string")
    return value


def _optional_string(data: dict[str, Any], field: str) -> str | None:
    value = data.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise EventValidationError(f"{field} must be a string or null")
    return value


def parse_timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise EventValidationError("ts must be an ISO 8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EventValidationError("ts must be a valid ISO 8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise EventValidationError("ts must include a timezone")
    return parsed


@dataclass(frozen=True, slots=True)
class HermesMonitorEvent:
    schema_version: int
    session_id: str
    turn_id: str | None
    seq: int
    ts: datetime
    source: str
    type: str
    importance: EventImportance
    group_id: str | None
    agent_id: str | None
    agent_name: str | None
    profile: str | None
    payload: dict[str, Any]
    raw: dict[str, Any]

    @classmethod
    def from_dict(cls, data: Any) -> "HermesMonitorEvent":
        if not isinstance(data, dict):
            raise EventValidationError("event must be a JSON object")

        schema_version = data.get("schema_version")
        if schema_version != 1:
            raise EventValidationError("schema_version must be 1")

        seq = data.get("seq")
        if not isinstance(seq, int) or isinstance(seq, bool) or seq < 0:
            raise EventValidationError("seq must be a non-negative integer")

        event_type = _required_string(data, "type")
        if event_type not in KNOWN_EVENT_TYPES:
            raise EventValidationError(f"unsupported event type: {event_type}")

        importance_value = data.get("importance", EventImportance.NORMAL.value)
        try:
            importance = EventImportance(importance_value)
        except ValueError as exc:
            raise EventValidationError(
                f"unsupported importance: {importance_value}"
            ) from exc

        payload = data.get("payload", {})
        if not isinstance(payload, dict):
            raise EventValidationError("payload must be a JSON object")

        return cls(
            schema_version=schema_version,
            session_id=_required_string(data, "session_id"),
            turn_id=_optional_string(data, "turn_id"),
            seq=seq,
            ts=parse_timestamp(data.get("ts")),
            source=_required_string(data, "source"),
            type=event_type,
            importance=importance,
            group_id=_optional_string(data, "group_id"),
            agent_id=_optional_string(data, "agent_id"),
            agent_name=_optional_string(data, "agent_name"),
            profile=_optional_string(data, "profile"),
            payload=payload,
            raw=dict(data),
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.raw)

