from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from backend.event_store import JsonlEventStore


def serialized_event(seq: int) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            "session_id": "session-1",
            "turn_id": "turn-1",
            "seq": seq,
            "ts": f"2026-06-24T10:00:{seq:02d}+08:00",
            "source": "hermes",
            "type": "assistant.delta",
            "importance": "primary",
            "group_id": "assistant-1",
            "payload": {"text": f"chunk-{seq}"},
        }
    )


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_waits_for_partial_line_then_emits_completed_event(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "session-1.jsonl"
            path.write_text(serialized_event(1) + "\n", encoding="utf-8")
            store = JsonlEventStore(
                Path(temp_dir),
                poll_interval_seconds=0.001,
            )
            stream = store.stream_session("session-1", after_seq=1)

            with path.open("a", encoding="utf-8") as writer:
                writer.write(serialized_event(2))
                writer.flush()

                pending = asyncio.create_task(anext(stream))
                await asyncio.sleep(0.01)
                self.assertFalse(pending.done())

                writer.write("\n")
                writer.flush()
                emitted = await asyncio.wait_for(pending, timeout=0.2)

            self.assertEqual(emitted.seq, 2)
            await stream.aclose()


if __name__ == "__main__":
    unittest.main()

