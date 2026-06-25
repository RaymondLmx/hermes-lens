from __future__ import annotations

import base64
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path


PLUGIN_PATH = Path(__file__).parents[1] / "__init__.py"


def load_plugin(events_dir: Path):
    os.environ["HERMES_MONITOR_EVENTS_DIR"] = str(events_dir)
    os.environ["HERMES_MONITOR_HEARTBEAT_SECONDS"] = "60"
    os.environ["HERMES_MONITOR_CAPTURE_CONTENT"] = "preview"
    name = f"test_live_monitor_exporter_{time.time_ns()}"
    spec = importlib.util.spec_from_file_location(name, PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def read_events(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


class ExporterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.events_dir = Path(self.temp_dir.name)
        self.plugin = load_plugin(self.events_dir)

    def tearDown(self):
        self.plugin._EXPORTER.shutdown()
        for name in (
            "HERMES_MONITOR_AGENT_ID",
            "HERMES_MONITOR_AGENT_NAME",
            "HERMES_MONITOR_PROFILE",
            "HERMES_MONITOR_MAX_CHARS",
            "HERMES_MONITOR_MEDIA_DIR",
            "HERMES_HOME",
            "HERMES_MONITOR_BOOTSTRAP_STATE_DB",
            "HERMES_MONITOR_BOOTSTRAP_WINDOW_SECONDS",
            "HERMES_MONITOR_BOOTSTRAP_LIMIT",
        ):
            os.environ.pop(name, None)
        self.temp_dir.cleanup()

    def test_extracts_multimodal_text_and_materializes_image(self):
        media_dir = self.events_dir / "media"
        self.plugin._EXPORTER.media_dir = media_dir
        image = b"\xff\xd8test-image\xff\xd9"
        data_url = (
            "data:image/jpeg;base64,"
            + base64.b64encode(image).decode("ascii")
        )
        self.plugin._pre_llm_call(
            "session-1",
            user_message=[
                {
                    "type": "text",
                    "text": json.dumps(
                        {"user_text": "describe this image"},
                        ensure_ascii=False,
                    ),
                },
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        )

        self.assertTrue(self.plugin._EXPORTER.flush())
        event = next(
            event
            for event in read_events(self.events_dir / "session-1.jsonl")
            if event["type"] == "user.message"
        )
        self.assertEqual(event["payload"]["text"], "describe this image")
        descriptor = event["payload"]["media"][0]
        self.assertEqual(descriptor["mime"], "image/jpeg")
        self.assertEqual(Path(descriptor["path"]).read_bytes(), image)
        self.assertNotIn("data:image", json.dumps(event))

    def test_exports_real_turn_and_tool_lifecycle(self):
        self.plugin._on_session_start(
            "session-1",
            model="test-model",
            platform="cli",
        )
        self.plugin._pre_llm_call(
            "session-1",
            user_message="inspect the bench",
            model="test-model",
            platform="cli",
        )
        self.plugin._pre_tool_call(
            "terminal",
            {"command": "pwd"},
            session_id="session-1",
            task_id="task-1",
            tool_call_id="call-1",
        )
        self.plugin._post_tool_call(
            "terminal",
            "/workspace",
            session_id="session-1",
            task_id="task-1",
            tool_call_id="call-1",
            duration_ms=12,
        )
        self.plugin._post_llm_call(
            "session-1",
            assistant_response="done",
            model="test-model",
            platform="cli",
        )
        self.plugin._on_session_finalize("session-1", platform="cli")

        self.assertTrue(self.plugin._EXPORTER.flush())
        events = read_events(self.events_dir / "session-1.jsonl")

        self.assertEqual(
            [event["type"] for event in events],
            [
                "session.start",
                "user.message",
                "turn.start",
                "tool.start",
                "tool.done",
                "assistant.done",
                "turn.done",
                "session.done",
            ],
        )
        self.assertEqual(
            [event["seq"] for event in events],
            list(range(1, len(events) + 1)),
        )
        self.assertEqual(events[1]["payload"]["text"], "inspect the bench")
        self.assertEqual(events[3]["group_id"], "call-1")

    def test_on_session_end_does_not_finish_multi_turn_session(self):
        self.plugin._pre_llm_call("session-1", user_message="first")
        self.plugin._post_llm_call("session-1", assistant_response="answer")
        self.plugin._on_session_end("session-1", completed=True)

        self.assertTrue(self.plugin._EXPORTER.flush())
        event_types = [
            event["type"]
            for event in read_events(self.events_dir / "session-1.jsonl")
        ]
        self.assertNotIn("session.done", event_types)

    def test_on_session_end_closes_failed_open_turn(self):
        self.plugin._pre_llm_call("session-1", user_message="first")
        self.plugin._on_session_end(
            "session-1",
            completed=False,
            interrupted=False,
        )

        self.assertTrue(self.plugin._EXPORTER.flush())
        events = read_events(self.events_dir / "session-1.jsonl")
        self.assertEqual(events[-2]["type"], "error")
        self.assertEqual(events[-1]["type"], "turn.done")
        self.assertEqual(events[-1]["payload"]["status"], "error")
        self.assertIsNone(self.plugin._EXPORTER.current_turn("session-1"))

    def test_redacts_secret_fields_and_truncates_content(self):
        os.environ["HERMES_MONITOR_MAX_CHARS"] = "64"
        self.plugin._pre_llm_call("session-1", user_message="x" * 100)
        self.plugin._pre_tool_call(
            "http",
            {"api_key": "secret-value", "body": "y" * 100},
            session_id="session-1",
            tool_call_id="call-1",
        )

        self.assertTrue(self.plugin._EXPORTER.flush())
        events = read_events(self.events_dir / "session-1.jsonl")
        user = next(event for event in events if event["type"] == "user.message")
        tool = next(event for event in events if event["type"] == "tool.start")

        self.assertIn("truncated", user["payload"]["text"])
        self.assertEqual(
            tool["payload"]["arguments"]["api_key"],
            "[redacted]",
        )
        self.assertIn("truncated", tool["payload"]["arguments"]["body"])

    def test_redacts_secret_fields_inside_json_tool_result(self):
        self.plugin._pre_llm_call("session-1", user_message="run")
        self.plugin._post_tool_call(
            "http",
            '{"token":"secret-value","status":"ok"}',
            session_id="session-1",
            tool_call_id="call-1",
        )

        self.assertTrue(self.plugin._EXPORTER.flush())
        events = read_events(self.events_dir / "session-1.jsonl")
        tool = next(event for event in events if event["type"] == "tool.done")
        self.assertEqual(tool["payload"]["result"]["token"], "[redacted]")

    def test_tool_result_failure_detection_uses_values_not_key_names(self):
        self.plugin._pre_llm_call("session-1", user_message="run")
        self.plugin._post_tool_call(
            "terminal",
            {"output": "ok", "exit_code": 0, "error": None},
            session_id="session-1",
            tool_call_id="call-ok",
        )
        self.plugin._post_tool_call(
            "terminal",
            {"output": "command not found", "exit_code": 127, "error": None},
            session_id="session-1",
            tool_call_id="call-exit",
        )
        self.plugin._post_tool_call(
            "browser",
            {"success": False, "error": "Navigation failed"},
            session_id="session-1",
            tool_call_id="call-success",
        )

        self.assertTrue(self.plugin._EXPORTER.flush())
        events = read_events(self.events_dir / "session-1.jsonl")
        by_group = {
            event["group_id"]: event
            for event in events
            if event["type"].startswith("tool.")
        }
        self.assertEqual(by_group["call-ok"]["type"], "tool.done")
        self.assertEqual(by_group["call-exit"]["type"], "tool.error")
        self.assertEqual(by_group["call-success"]["type"], "tool.error")

    def test_uses_explicit_agent_identity(self):
        os.environ["HERMES_MONITOR_AGENT_ID"] = "planner"
        os.environ["HERMES_MONITOR_AGENT_NAME"] = "Demo Agent"
        os.environ["HERMES_MONITOR_PROFILE"] = "robot"
        self.plugin._on_session_start("session-1", model="test-model")

        self.assertTrue(self.plugin._EXPORTER.flush())
        event = read_events(self.events_dir / "session-1.jsonl")[0]
        self.assertEqual(event["agent_id"], "planner")
        self.assertEqual(event["agent_name"], "Demo Agent")
        self.assertEqual(event["profile"], "robot")

    def test_infers_profile_identity_from_hermes_home(self):
        os.environ["HERMES_HOME"] = "/home/test/.hermes/profiles/planner"
        self.plugin._on_session_start("session-1", model="test-model")

        self.assertTrue(self.plugin._EXPORTER.flush())
        event = read_events(self.events_dir / "session-1.jsonl")[0]
        self.assertEqual(event["agent_id"], "planner")
        self.assertEqual(event["agent_name"], "Hermes Planner")
        self.assertEqual(event["profile"], "planner")

    def test_bootstraps_recent_active_sessions_from_state_db(self):
        self.plugin._EXPORTER.shutdown()
        with tempfile.TemporaryDirectory() as home_dir:
            home = Path(home_dir) / ".hermes" / "profiles" / "planner"
            home.mkdir(parents=True)
            db_path = home / "state.db"
            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(
                    """
                    CREATE TABLE sessions (
                        id TEXT PRIMARY KEY,
                        source TEXT NOT NULL,
                        model TEXT,
                        started_at REAL NOT NULL,
                        ended_at REAL
                    );
                    CREATE TABLE messages (
                        id INTEGER PRIMARY KEY,
                        session_id TEXT NOT NULL,
                        timestamp REAL NOT NULL
                    );
                    """
                )
                conn.execute(
                    "INSERT INTO sessions VALUES (?, ?, ?, ?, NULL)",
                    ("session-active", "api_server", "test-model", time.time()),
                )
                conn.execute(
                    "INSERT INTO messages (session_id, timestamp) VALUES (?, ?)",
                    ("session-active", time.time()),
                )
                conn.commit()
            finally:
                conn.close()
            events_dir = Path(self.temp_dir.name) / "bootstrap"
            os.environ["HERMES_HOME"] = str(home)
            plugin = load_plugin(events_dir)
            try:
                self.assertTrue(plugin._EXPORTER.flush())
                events = read_events(events_dir / "session-active.jsonl")
                self.assertEqual(events[0]["type"], "session.start")
                self.assertEqual(events[0]["agent_id"], "planner")
                self.assertEqual(events[1]["type"], "session.heartbeat")
                self.assertTrue(events[1]["payload"]["bootstrap"])
            finally:
                plugin._EXPORTER.shutdown()
                self.plugin = load_plugin(self.events_dir)

    def test_queue_overflow_drops_detail_before_primary(self):
        exporter = self.plugin.JsonlExporter(
            self.events_dir / "overflow",
            queue_size=16,
            heartbeat_seconds=60,
        )
        try:
            exporter._stopping = True
            with exporter._condition:
                exporter._condition.notify_all()
            exporter._writer.join(timeout=1.0)
            state = exporter._state("session-1")
            for index in range(16):
                exporter._enqueue(
                    {"importance": "detail", "seq": index},
                    state,
                )
            exporter._enqueue(
                {"importance": "primary", "seq": 99},
                state,
            )
            self.assertEqual(len(exporter._queue), 16)
            self.assertTrue(
                any(event["importance"] == "primary" for event in exporter._queue)
            )
            self.assertEqual(state.dropped_events, 1)
        finally:
            exporter.shutdown()


if __name__ == "__main__":
    unittest.main()
