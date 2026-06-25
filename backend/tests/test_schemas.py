from __future__ import annotations

import unittest

from backend.schemas import EventValidationError, HermesMonitorEvent


def event_data(**overrides):
    data = {
        "schema_version": 1,
        "session_id": "session-1",
        "turn_id": "turn-1",
        "seq": 1,
        "ts": "2026-06-24T10:00:00+08:00",
        "source": "hermes",
        "type": "user.message",
        "importance": "primary",
        "group_id": None,
        "payload": {"text": "hello"},
    }
    data.update(overrides)
    return data


class HermesMonitorEventTests(unittest.TestCase):
    def test_accepts_backward_compatible_event_without_identity(self):
        event = HermesMonitorEvent.from_dict(event_data())

        self.assertIsNone(event.agent_id)
        self.assertEqual(event.session_id, "session-1")

    def test_rejects_naive_timestamp(self):
        with self.assertRaisesRegex(EventValidationError, "timezone"):
            HermesMonitorEvent.from_dict(
                event_data(ts="2026-06-24T10:00:00")
            )

    def test_rejects_unknown_event_type(self):
        with self.assertRaisesRegex(EventValidationError, "unsupported event type"):
            HermesMonitorEvent.from_dict(event_data(type="made.up"))

    def test_rejects_non_object_payload(self):
        with self.assertRaisesRegex(EventValidationError, "payload"):
            HermesMonitorEvent.from_dict(event_data(payload=[]))


if __name__ == "__main__":
    unittest.main()

