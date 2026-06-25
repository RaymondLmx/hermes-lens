"""Non-blocking JSONL exporter for Hermes Lens.

This plugin deliberately depends only on the Python standard library and the
Hermes hook contract. Hook callbacks normalize small snapshots and enqueue
them; a background writer owns all filesystem I/O.
"""

from __future__ import annotations

import atexit
import base64
import binascii
from contextlib import closing
import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LOW_IMPORTANCE = {"debug", "detail"}
_SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|authorization|password|passwd|secret|token|cookie)",
    re.IGNORECASE,
)
_ERROR_KEY_RE = re.compile(r"(error|exception|failed|failure)", re.IGNORECASE)
_DATA_IMAGE_RE = re.compile(
    r"^data:(image/(?:jpeg|png|webp|gif));base64,(.+)$",
    re.IGNORECASE | re.DOTALL,
)


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _capture_mode() -> str:
    mode = os.getenv("HERMES_MONITOR_CAPTURE_CONTENT", "preview").strip().lower()
    return mode if mode in {"none", "preview", "full"} else "preview"


def _max_chars() -> int:
    try:
        return max(64, int(os.getenv("HERMES_MONITOR_MAX_CHARS", "2000")))
    except ValueError:
        return 2000


def _truncate(value: str) -> str:
    if _capture_mode() == "none":
        return ""
    if _capture_mode() == "full":
        return value
    limit = _max_chars()
    if len(value) <= limit:
        return value
    return value[:limit] + f"... [truncated {len(value) - limit} chars]"


def _sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return "[max depth]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate(value)
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for raw_key, raw_value in list(value.items())[:100]:
            key = str(raw_key)
            cleaned[key] = (
                "[redacted]"
                if _SECRET_KEY_RE.search(key)
                else _sanitize(raw_value, depth + 1)
            )
        return cleaned
    if isinstance(value, (list, tuple)):
        return [_sanitize(item, depth + 1) for item in list(value)[:100]]
    return _truncate(str(value))


def _display_text(value: str) -> str:
    stripped = value.strip()
    if not stripped.startswith("{"):
        return value
    try:
        parsed = json.loads(stripped)
    except (TypeError, ValueError):
        return value
    if isinstance(parsed, dict) and isinstance(parsed.get("user_text"), str):
        return parsed["user_text"]
    return value


def _content_payload(content: Any) -> dict[str, Any]:
    if not isinstance(content, (list, tuple)):
        original = str(content or "")
        captured = _truncate(original)
        payload: dict[str, Any] = {"chars": len(original)}
        if captured:
            payload["text"] = captured
        return payload

    text_parts: list[str] = []
    media: list[dict[str, Any]] = []
    data_images: list[str] = []
    for part in content[:100]:
        if isinstance(part, str):
            text_parts.append(_display_text(part))
            continue
        if not isinstance(part, dict):
            continue
        part_type = str(part.get("type") or "")
        if part_type == "text" and isinstance(part.get("text"), str):
            text_parts.append(_display_text(part["text"]))
            continue
        if part_type not in {"image", "image_url", "media"}:
            continue
        image_value = part.get("image_url", part)
        if isinstance(image_value, dict):
            source = image_value.get("url") or image_value.get("path")
        else:
            source = image_value
        if not isinstance(source, str):
            continue
        if source.startswith("data:image/"):
            data_images.append(source)
        else:
            media.append({"url": source})

    joined = "\n".join(part for part in text_parts if part)
    payload = {"chars": len(joined)}
    captured = _truncate(joined)
    if captured:
        payload["text"] = captured
    if media:
        payload["media"] = media
    if data_images:
        payload["_monitor_data_images"] = data_images
    return payload


def _profile_from_env() -> str:
    explicit = os.getenv("HERMES_MONITOR_PROFILE")
    if explicit:
        return explicit
    hermes_home = os.getenv("HERMES_HOME")
    if not hermes_home:
        return ""
    path = Path(hermes_home).expanduser()
    if path.name and path.parent.name == "profiles":
        return path.name
    return ""


def _identity(state: SessionState) -> tuple[str, str, str]:
    profile = _profile_from_env() or state.profile
    agent_id = os.getenv("HERMES_MONITOR_AGENT_ID") or profile or state.model or "hermes"
    agent_name = os.getenv("HERMES_MONITOR_AGENT_NAME")
    if not agent_name:
        agent_name = f"Hermes {profile.title()}" if profile else "Hermes Agent"
    return agent_id, agent_name, profile or "default"


def _result_failed(result: Any) -> bool:
    if isinstance(result, dict):
        success = result.get("success")
        if success is False:
            return True
        exit_code = result.get("exit_code")
        if isinstance(exit_code, int) and exit_code != 0:
            return True
        for key, value in result.items():
            if not _ERROR_KEY_RE.search(str(key)):
                continue
            if isinstance(value, str):
                if value.strip():
                    return True
            elif value:
                return True
        return False
    if not isinstance(result, str):
        return False
    try:
        parsed = json.loads(result)
    except (TypeError, ValueError):
        return bool(_ERROR_KEY_RE.search(result[:200]))
    return _result_failed(parsed)


def _sanitize_result(result: Any) -> Any:
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
        except (TypeError, ValueError):
            return result
        return parsed
    return result


@dataclass(slots=True)
class SessionState:
    session_id: str
    seq: int = 0
    turn_counter: int = 0
    active_turn_id: str | None = None
    running_tools: set[str] = field(default_factory=set)
    model: str = ""
    platform: str = ""
    profile: str = ""
    last_activity: float = field(default_factory=time.monotonic)
    finalized: bool = False
    dropped_events: int = 0


class JsonlExporter:
    def __init__(
        self,
        events_dir: Path,
        *,
        queue_size: int = 2048,
        heartbeat_seconds: float = 5.0,
    ) -> None:
        self.events_dir = events_dir
        self.media_dir = Path(
            os.getenv(
                "HERMES_MONITOR_MEDIA_DIR",
                str(events_dir.parent / "live-media"),
            )
        ).expanduser()
        self.queue_size = max(16, queue_size)
        self.heartbeat_seconds = max(1.0, heartbeat_seconds)
        self._queue: deque[dict[str, Any]] = deque()
        self._sessions: dict[str, SessionState] = {}
        self._condition = threading.Condition()
        self._state_lock = threading.RLock()
        self._stopping = False
        self._stop_event = threading.Event()
        self._writer = threading.Thread(
            target=self._writer_loop,
            name="hermes-lens-writer",
            daemon=True,
        )
        self._heartbeat = threading.Thread(
            target=self._heartbeat_loop,
            name="hermes-lens-heartbeat",
            daemon=True,
        )
        self._writer.start()
        self._heartbeat.start()

    def _state(
        self,
        session_id: str,
        *,
        model: str = "",
        platform: str = "",
    ) -> SessionState:
        state = self._sessions.get(session_id)
        if state is None:
            state = SessionState(
                session_id=session_id,
                seq=self._existing_last_seq(session_id),
            )
            self._sessions[session_id] = state
        if model:
            state.model = model
        if platform:
            state.platform = platform
        return state

    def _existing_last_seq(self, session_id: str) -> int:
        path = self.events_dir / f"{session_id}.jsonl"
        if not path.is_file():
            return 0
        try:
            with path.open("rb") as stream:
                stream.seek(0, os.SEEK_END)
                size = stream.tell()
                stream.seek(max(0, size - 64 * 1024))
                lines = stream.read().decode("utf-8", errors="ignore").splitlines()
            for line in reversed(lines):
                try:
                    seq = json.loads(line).get("seq")
                except (TypeError, ValueError):
                    continue
                if isinstance(seq, int):
                    return seq
        except OSError:
            return 0
        return 0

    def emit(
        self,
        session_id: str,
        event_type: str,
        *,
        payload: dict[str, Any] | None = None,
        turn_id: str | None = None,
        source: str = "hermes",
        importance: str = "normal",
        group_id: str | None = None,
        model: str = "",
        platform: str = "",
    ) -> None:
        if not session_id or self._stopping:
            return
        try:
            with self._state_lock:
                state = self._state(
                    session_id,
                    model=model,
                    platform=platform,
                )
                state.seq += 1
                state.last_activity = time.monotonic()
                agent_id, agent_name, profile = _identity(state)
                raw_payload = payload or {}
                data_images = raw_payload.get("_monitor_data_images")
                sanitized_payload = _sanitize(
                    {
                        key: value
                        for key, value in raw_payload.items()
                        if key != "_monitor_data_images"
                    }
                )
                event = {
                    "schema_version": 1,
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "seq": state.seq,
                    "ts": _now(),
                    "source": source,
                    "type": event_type,
                    "importance": importance,
                    "group_id": group_id,
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "profile": profile,
                    "payload": sanitized_payload,
                }
                if isinstance(data_images, list):
                    event["_monitor_data_images"] = data_images
            self._enqueue(event, state)
        except Exception as exc:
            logger.debug("Hermes Lens emit failed: %s", exc)

    def _enqueue(self, event: dict[str, Any], state: SessionState) -> None:
        with self._condition:
            if len(self._queue) >= self.queue_size:
                if event["importance"] in _LOW_IMPORTANCE:
                    state.dropped_events += 1
                    return
                low_index = next(
                    (
                        index
                        for index, queued in enumerate(self._queue)
                        if queued["importance"] in _LOW_IMPORTANCE
                    ),
                    None,
                )
                if low_index is None:
                    state.dropped_events += 1
                    return
                del self._queue[low_index]
                state.dropped_events += 1
            self._queue.append(event)
            self._condition.notify()

    def start_session(
        self,
        session_id: str,
        *,
        model: str = "",
        platform: str = "",
        reset: bool = False,
    ) -> None:
        with self._state_lock:
            state = self._state(session_id, model=model, platform=platform)
            if state.seq > 0 and not reset:
                state.finalized = False
                return
            state.finalized = False
            agent_id, agent_name, profile = _identity(state)
        self.emit(
            session_id,
            "session.start",
            model=model,
            platform=platform,
            payload={
                "status": "active",
                "agent_id": agent_id,
                "agent_name": agent_name,
                "profile": profile,
                "platform": state.platform,
                "model": state.model,
                "pid": os.getpid(),
                "cwd": os.getcwd(),
                "heartbeat_interval_ms": int(self.heartbeat_seconds * 1000),
                "capture_content": _capture_mode(),
            },
        )

    def begin_turn(
        self,
        session_id: str,
        user_message: Any,
        *,
        model: str = "",
        platform: str = "",
    ) -> str:
        self.start_session(session_id, model=model, platform=platform)
        with self._state_lock:
            state = self._state(session_id, model=model, platform=platform)
            state.turn_counter += 1
            state.active_turn_id = f"turn-{state.turn_counter:04d}"
            turn_id = state.active_turn_id
        self.emit(
            session_id,
            "user.message",
            turn_id=turn_id,
            importance="primary",
            payload=_content_payload(user_message),
        )
        self.emit(
            session_id,
            "turn.start",
            turn_id=turn_id,
            payload={},
        )
        return turn_id

    def current_turn(self, session_id: str) -> str | None:
        with self._state_lock:
            return self._state(session_id).active_turn_id

    def end_turn(
        self,
        session_id: str,
        assistant_response: str,
        *,
        model: str = "",
        platform: str = "",
    ) -> None:
        turn_id = self.current_turn(session_id)
        self.emit(
            session_id,
            "assistant.done",
            turn_id=turn_id,
            importance="primary",
            model=model,
            platform=platform,
            payload=_content_payload(assistant_response),
        )
        self.emit(
            session_id,
            "turn.done",
            turn_id=turn_id,
            payload={"status": "done"},
        )
        with self._state_lock:
            self._state(session_id).active_turn_id = None

    def finalize_session(
        self,
        session_id: str,
        *,
        platform: str = "",
        reason: str = "finalized",
    ) -> None:
        if not session_id:
            return
        with self._state_lock:
            state = self._state(session_id, platform=platform)
            if state.finalized:
                return
            state.finalized = True
        self.emit(
            session_id,
            "session.done",
            platform=platform,
            payload={
                "status": "done",
                "reason": reason,
                "dropped_events": state.dropped_events,
            },
        )

    def _heartbeat_loop(self) -> None:
        while not self._stopping:
            if self._stop_event.wait(self.heartbeat_seconds):
                return
            with self._state_lock:
                states = list(self._sessions.values())
            for state in states:
                if state.finalized:
                    continue
                self.emit(
                    state.session_id,
                    "session.heartbeat",
                    importance="debug",
                    payload={
                        "status": (
                            "running"
                            if state.active_turn_id or state.running_tools
                            else "idle"
                        ),
                        "pid": os.getpid(),
                        "active_turn_id": state.active_turn_id,
                        "running_tools": sorted(state.running_tools),
                        "dropped_events": state.dropped_events,
                    },
                )

    def _writer_loop(self) -> None:
        while True:
            with self._condition:
                while not self._queue and not self._stopping:
                    self._condition.wait(timeout=1.0)
                if not self._queue and self._stopping:
                    return
                event = self._queue.popleft()
            try:
                self.events_dir.mkdir(parents=True, exist_ok=True)
                self._materialize_media(event)
                path = self.events_dir / f"{event['session_id']}.jsonl"
                with path.open("a", encoding="utf-8") as stream:
                    stream.write(
                        json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                        + "\n"
                    )
            except Exception as exc:
                logger.warning("Hermes Lens writer failed: %s", exc)

    def _materialize_media(self, event: dict[str, Any]) -> None:
        data_images = event.pop("_monitor_data_images", None)
        if not isinstance(data_images, list):
            return
        try:
            max_bytes = int(
                os.getenv(
                    "HERMES_MONITOR_MAX_MEDIA_BYTES",
                    str(10 * 1024 * 1024),
                )
            )
        except ValueError:
            max_bytes = 10 * 1024 * 1024
        descriptors: list[dict[str, Any]] = []
        for value in data_images:
            if not isinstance(value, str):
                continue
            match = _DATA_IMAGE_RE.match(value)
            if not match:
                continue
            try:
                image = base64.b64decode(match.group(2), validate=True)
            except (binascii.Error, ValueError):
                continue
            if not image or len(image) > max_bytes:
                continue
            mime = match.group(1).lower()
            extension = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
                "image/gif": ".gif",
            }[mime]
            digest = hashlib.sha256(image).hexdigest()
            self.media_dir.mkdir(parents=True, exist_ok=True)
            path = (self.media_dir / f"{digest}{extension}").resolve()
            if not path.exists():
                path.write_bytes(image)
            descriptors.append(
                {"media_id": digest, "path": str(path), "mime": mime}
            )
        if descriptors:
            payload = event.get("payload")
            if isinstance(payload, dict):
                existing = payload.get("media")
                payload["media"] = (
                    [*existing, *descriptors]
                    if isinstance(existing, list)
                    else descriptors
                )

    def flush(self, timeout: float = 2.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._condition:
                if not self._queue:
                    return True
            time.sleep(0.01)
        return False

    def shutdown(self) -> None:
        if self._stopping:
            return
        self._stopping = True
        self._stop_event.set()
        with self._condition:
            self._condition.notify_all()
        self._writer.join(timeout=2.0)
        self._heartbeat.join(timeout=2.0)


def _queue_size() -> int:
    try:
        return int(os.getenv("HERMES_MONITOR_QUEUE_SIZE", "2048"))
    except ValueError:
        return 2048


def _heartbeat_seconds() -> float:
    try:
        return float(os.getenv("HERMES_MONITOR_HEARTBEAT_SECONDS", "5"))
    except ValueError:
        return 5.0


def _bootstrap_enabled() -> bool:
    return not os.getenv("HERMES_MONITOR_BOOTSTRAP_STATE_DB", "1").strip().lower() in {
        "0",
        "false",
        "no",
        "off",
    }


def _bootstrap_window_seconds() -> float:
    try:
        return max(60.0, float(os.getenv("HERMES_MONITOR_BOOTSTRAP_WINDOW_SECONDS", "3600")))
    except ValueError:
        return 3600.0


def _bootstrap_limit() -> int:
    try:
        return max(1, int(os.getenv("HERMES_MONITOR_BOOTSTRAP_LIMIT", "10")))
    except ValueError:
        return 10


def _bootstrap_active_sessions(exporter: JsonlExporter) -> None:
    if not _bootstrap_enabled():
        return
    hermes_home = os.getenv("HERMES_HOME")
    if not hermes_home:
        return
    state_db = Path(hermes_home).expanduser() / "state.db"
    if not state_db.is_file():
        return
    cutoff = time.time() - _bootstrap_window_seconds()
    try:
        uri = f"file:{state_db}?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=0.25)) as conn:
            rows = conn.execute(
                """
                SELECT s.id, COALESCE(s.model, ''), COALESCE(s.source, ''),
                       COALESCE(MAX(m.timestamp), s.started_at) AS last_activity
                FROM sessions s
                LEFT JOIN messages m ON m.session_id = s.id
                WHERE s.ended_at IS NULL
                GROUP BY s.id
                HAVING last_activity >= ?
                ORDER BY last_activity DESC
                LIMIT ?
                """,
                (cutoff, _bootstrap_limit()),
            ).fetchall()
    except Exception as exc:
        logger.debug("Hermes Lens state bootstrap failed: %s", exc)
        return

    for session_id, model, platform, last_activity in rows:
        if not session_id:
            continue
        exporter.start_session(
            str(session_id),
            model=str(model or ""),
            platform=str(platform or ""),
        )
        exporter.emit(
            str(session_id),
            "session.heartbeat",
            source="hermes-state",
            importance="debug",
            model=str(model or ""),
            platform=str(platform or ""),
            payload={
                "status": "idle",
                "pid": os.getpid(),
                "bootstrap": True,
                "state_db": str(state_db),
                "state_last_activity": float(last_activity or 0),
            },
        )


_EXPORTER = JsonlExporter(
    Path(
        os.getenv(
            "HERMES_MONITOR_EVENTS_DIR",
            "~/.hermes/live-events",
        )
    ).expanduser(),
    queue_size=_queue_size(),
    heartbeat_seconds=_heartbeat_seconds(),
)
_bootstrap_active_sessions(_EXPORTER)


def _on_session_start(
    session_id: str,
    model: str = "",
    platform: str = "",
    **_: Any,
) -> None:
    _EXPORTER.start_session(session_id, model=model, platform=platform)


def _on_session_reset(
    session_id: str,
    platform: str = "",
    **_: Any,
) -> None:
    _EXPORTER.start_session(session_id, platform=platform, reset=True)


def _on_session_end(
    session_id: str,
    completed: bool = False,
    interrupted: bool = False,
    **_: Any,
) -> None:
    turn_id = _EXPORTER.current_turn(session_id)
    if turn_id:
        status = "interrupted" if interrupted else "done" if completed else "error"
        if status != "done":
            _EXPORTER.emit(
                session_id,
                "warning" if interrupted else "error",
                turn_id=turn_id,
                importance="primary",
                payload={
                    "scope": "turn",
                    "message": (
                        "Turn interrupted"
                        if interrupted
                        else "Turn ended without a successful assistant response"
                    ),
                },
            )
        _EXPORTER.emit(
            session_id,
            "turn.done",
            turn_id=turn_id,
            payload={"status": status, "completed": completed},
        )
        with _EXPORTER._state_lock:
            _EXPORTER._state(session_id).active_turn_id = None


def _on_session_finalize(
    session_id: str | None = None,
    platform: str = "",
    **_: Any,
) -> None:
    if session_id:
        _EXPORTER.finalize_session(session_id, platform=platform)


def _pre_llm_call(
    session_id: str,
    user_message: Any = "",
    model: str = "",
    platform: str = "",
    **_: Any,
) -> None:
    _EXPORTER.begin_turn(
        session_id,
        user_message,
        model=model,
        platform=platform,
    )


def _post_llm_call(
    session_id: str,
    assistant_response: str = "",
    model: str = "",
    platform: str = "",
    **_: Any,
) -> None:
    _EXPORTER.end_turn(
        session_id,
        assistant_response,
        model=model,
        platform=platform,
    )


def _pre_api_request(
    session_id: str,
    task_id: str = "",
    api_call_count: int = 0,
    provider: str = "",
    **_: Any,
) -> None:
    _EXPORTER.emit(
        session_id,
        "status.update",
        turn_id=_EXPORTER.current_turn(session_id),
        importance="detail",
        payload={
            "status": "llm_request",
            "task_id": task_id,
            "api_call_count": api_call_count,
            "provider": provider,
        },
    )


def _post_api_request(
    session_id: str,
    task_id: str = "",
    api_call_count: int = 0,
    api_duration: float | int = 0,
    finish_reason: str | None = None,
    usage: Any = None,
    **_: Any,
) -> None:
    _EXPORTER.emit(
        session_id,
        "status.update",
        turn_id=_EXPORTER.current_turn(session_id),
        importance="detail",
        payload={
            "status": "llm_response",
            "task_id": task_id,
            "api_call_count": api_call_count,
            "duration_ms": int(float(api_duration or 0) * 1000),
            "finish_reason": finish_reason,
            "usage": usage,
        },
    )


def _pre_tool_call(
    tool_name: str,
    args: dict[str, Any] | None = None,
    session_id: str = "",
    task_id: str = "",
    tool_call_id: str = "",
    **_: Any,
) -> None:
    if not session_id:
        return
    group_id = tool_call_id or f"{task_id}:{tool_name}"
    with _EXPORTER._state_lock:
        _EXPORTER._state(session_id).running_tools.add(group_id)
    _EXPORTER.emit(
        session_id,
        "tool.start",
        source="tool",
        turn_id=_EXPORTER.current_turn(session_id),
        group_id=group_id,
        payload={"name": tool_name, "arguments": args or {}, "task_id": task_id},
    )


def _post_tool_call(
    tool_name: str,
    result: Any = None,
    session_id: str = "",
    task_id: str = "",
    tool_call_id: str = "",
    duration_ms: int = 0,
    **_: Any,
) -> None:
    if not session_id:
        return
    group_id = tool_call_id or f"{task_id}:{tool_name}"
    failed = _result_failed(result)
    _EXPORTER.emit(
        session_id,
        "tool.error" if failed else "tool.done",
        source="tool",
        importance="primary" if failed else "normal",
        turn_id=_EXPORTER.current_turn(session_id),
        group_id=group_id,
        payload={
            "name": tool_name,
            "result": _sanitize_result(result),
            "duration_ms": duration_ms,
            "task_id": task_id,
        },
    )
    with _EXPORTER._state_lock:
        _EXPORTER._state(session_id).running_tools.discard(group_id)


def register(ctx: Any) -> None:
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("on_session_finalize", _on_session_finalize)
    ctx.register_hook("on_session_reset", _on_session_reset)
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("post_llm_call", _post_llm_call)
    ctx.register_hook("pre_api_request", _pre_api_request)
    ctx.register_hook("post_api_request", _post_api_request)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)


atexit.register(_EXPORTER.shutdown)
