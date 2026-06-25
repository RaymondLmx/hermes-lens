from __future__ import annotations

import unittest
from datetime import datetime, timezone

from backend.schemas import HermesMonitorEvent, SessionStatus
from backend.session_index import build_session_summary


def event(seq: int, event_type: str, ts: str, **values):
    raw = {
        "schema_version": 1,
        "session_id": "session-1",
        "turn_id": values.pop("turn_id", None),
        "seq": seq,
        "ts": ts,
        "source": "hermes",
        "type": event_type,
        "importance": "normal",
        "group_id": values.pop("group_id", None),
        "payload": values.pop("payload", {}),
        **values,
    }
    return HermesMonitorEvent.from_dict(raw)


NOW = datetime(2026, 6, 24, 2, 0, 30, tzinfo=timezone.utc)


class SessionIndexTests(unittest.TestCase):
    def test_running_session_has_open_turn_and_fresh_heartbeat(self):
        events = [
            event(
                1,
                "session.start",
                "2026-06-24T10:00:00+08:00",
                agent_id="demo-agent",
                agent_name="Demo Agent",
                profile="demo",
            ),
            event(
                2,
                "turn.start",
                "2026-06-24T10:00:05+08:00",
                turn_id="turn-1",
            ),
            event(
                3,
                "session.heartbeat",
                "2026-06-24T10:00:20+08:00",
            ),
        ]

        summary = build_session_summary(
            "session-1",
            events,
            now=NOW,
            heartbeat_ttl_seconds=30,
        )

        self.assertEqual(summary.status, SessionStatus.RUNNING)
        self.assertEqual(summary.agent_id, "demo-agent")
        self.assertEqual(summary.current_turn_id, "turn-1")
        self.assertTrue(summary.to_dict(NOW)["active"])

    def test_stale_session_exceeds_heartbeat_ttl(self):
        summary = build_session_summary(
            "session-1",
            [
                event(
                    1,
                    "session.heartbeat",
                    "2026-06-24T09:59:00+08:00",
                )
            ],
            now=NOW,
            heartbeat_ttl_seconds=30,
        )

        self.assertEqual(summary.status, SessionStatus.STALE)
        self.assertFalse(summary.to_dict(NOW)["active"])

    def test_done_takes_precedence_over_stale(self):
        summary = build_session_summary(
            "session-1",
            [
                event(
                    1,
                    "session.heartbeat",
                    "2026-06-24T09:59:00+08:00",
                ),
                event(
                    2,
                    "session.done",
                    "2026-06-24T09:59:10+08:00",
                ),
            ],
            now=NOW,
            heartbeat_ttl_seconds=30,
        )

        self.assertEqual(summary.status, SessionStatus.DONE)

    def test_last_activity_seen_ignores_heartbeats(self):
        summary = build_session_summary(
            "session-1",
            [
                event(
                    1,
                    "user.message",
                    "2026-06-24T10:00:05+08:00",
                    payload={"text": "start"},
                ),
                event(
                    2,
                    "session.heartbeat",
                    "2026-06-24T10:00:25+08:00",
                ),
            ],
            now=NOW,
            heartbeat_ttl_seconds=30,
        )

        data = summary.to_dict(NOW)
        self.assertEqual(data["last_seen"], "2026-06-24T10:00:25+08:00")
        self.assertEqual(
            data["last_activity_seen"],
            "2026-06-24T10:00:05+08:00",
        )


if __name__ == "__main__":
    unittest.main()
