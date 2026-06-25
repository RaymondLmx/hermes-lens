from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _media_roots(value: str | None) -> tuple[Path, ...]:
    if not value:
        return ()
    return tuple(
        Path(item).expanduser().resolve()
        for item in value.split(os.pathsep)
        if item.strip()
    )


@dataclass(frozen=True, slots=True)
class Settings:
    events_dir: Path
    media_roots: tuple[Path, ...]
    heartbeat_ttl_seconds: float = 30.0
    poll_interval_seconds: float = 0.5

    @classmethod
    def from_env(cls) -> "Settings":
        events_dir = Path(
            os.environ.get(
                "HERMES_MONITOR_EVENTS_DIR",
                "~/.hermes/live-events",
            )
        ).expanduser().resolve()
        configured_media_roots = os.environ.get("HERMES_MONITOR_MEDIA_ROOTS")
        default_media_root = events_dir.parent / "live-media"
        return cls(
            events_dir=events_dir,
            media_roots=(
                _media_roots(configured_media_roots)
                if configured_media_roots
                else (default_media_root.resolve(),)
            ),
            heartbeat_ttl_seconds=float(
                os.environ.get("HERMES_MONITOR_HEARTBEAT_TTL", "30")
            ),
            poll_interval_seconds=float(
                os.environ.get("HERMES_MONITOR_POLL_INTERVAL", "0.5")
            ),
        )
