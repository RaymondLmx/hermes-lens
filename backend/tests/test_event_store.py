from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.event_store import JsonlEventStore, SessionNotFoundError


def event(seq: int, event_type: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        "session_id": "session-1",
        "turn_id": None,
        "seq": seq,
        "ts": f"2026-06-24T10:00:{seq:02d}+08:00",
        "source": "hermes",
        "type": event_type,
        "importance": "normal",
        "group_id": None,
        "payload": {},
    }


class JsonlEventStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.events_dir = Path(self.temp_dir.name)
        self.store = JsonlEventStore(self.events_dir)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_reads_valid_lines_and_surfaces_invalid_lines(self):
        path = self.events_dir / "session-1.jsonl"
        path.write_text(
            "\n".join(
                [
                    json.dumps(event(1, "session.start")),
                    "{partial",
                    json.dumps(event(2, "session.heartbeat")),
                ]
            ),
            encoding="utf-8",
        )

        result = self.store.read_session("session-1")

        self.assertEqual([item.seq for item in result.events], [1, 2])
        self.assertEqual(result.invalid_lines[0]["line"], 2)

    def test_reads_only_recent_event_lines(self):
        path = self.events_dir / "session-1.jsonl"
        path.write_text(
            "".join(
                json.dumps(event(seq, "session.heartbeat")) + "\n"
                for seq in range(1, 6)
            ),
            encoding="utf-8",
        )

        result = self.store.read_session_tail("session-1", 2)

        self.assertEqual([item.seq for item in result.events], [4, 5])

    def test_lists_discovered_jsonl_sessions(self):
        path = self.events_dir / "session-1.jsonl"
        path.write_text(
            json.dumps(event(1, "session.heartbeat")) + "\n",
            encoding="utf-8",
        )

        summaries = self.store.list_sessions(
            now=datetime(2026, 6, 24, 2, 0, 10, tzinfo=timezone.utc)
        )

        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0].session_id, "session-1")

    def test_rejects_path_traversal_as_unknown_session(self):
        with self.assertRaises(SessionNotFoundError):
            self.store.read_session("../secret")

    def test_skips_event_with_mismatched_session_id(self):
        path = self.events_dir / "session-1.jsonl"
        mismatched = event(1, "session.start")
        mismatched["session_id"] = "other-session"
        path.write_text(json.dumps(mismatched) + "\n", encoding="utf-8")

        result = self.store.read_session("session-1")

        self.assertEqual(result.events, [])
        self.assertIn("does not match", str(result.invalid_lines[0]["error"]))

    def test_rejects_session_symlink_outside_events_directory(self):
        with tempfile.TemporaryDirectory() as other_dir:
            target = Path(other_dir) / "outside.jsonl"
            target.write_text(
                json.dumps(event(1, "session.start")) + "\n",
                encoding="utf-8",
            )
            (self.events_dir / "linked.jsonl").symlink_to(target)

            with self.assertRaises(SessionNotFoundError):
                self.store.read_session("linked")


if __name__ == "__main__":
    unittest.main()
