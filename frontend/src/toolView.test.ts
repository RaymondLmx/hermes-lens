import { describe, expect, it } from "vitest";

import { buildToolView } from "./toolView";
import type { MonitorEvent } from "./types";

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): MonitorEvent {
  return {
    schema_version: 1,
    session_id: "session-1",
    turn_id: "turn-1",
    seq,
    ts: "2026-06-24T10:00:00+08:00",
    source: "tool",
    type,
    importance: "normal",
    group_id: "tool-1",
    payload,
  };
}

describe("buildToolView", () => {
  it("surfaces arguments, terminal output streams, exit code, and duration", () => {
    const view = buildToolView([
      event(1, "tool.start", {
        name: "terminal",
        arguments: { command: "npm test" },
      }),
      event(2, "tool.done", {
        name: "terminal",
        duration_ms: 1234,
        result: {
          exit_code: 0,
          stdout: "all tests passed",
          stderr: "npm notice",
        },
      }),
    ]);

    expect(view.title).toBe("terminal");
    expect(view.subtitle).toContain("npm test");
    expect(view.argsText).toContain('"command": "npm test"');
    expect(view.exitCodeLabel).toBe("exit_code: 0");
    expect(view.durationLabel).toBe("1.2 s");
    expect(view.streams).toEqual([
      { label: "stdout", text: "all tests passed", tone: "normal" },
      { label: "stderr", text: "npm notice", tone: "muted" },
    ]);
  });

  it("unwraps nested result payloads into readable summaries", () => {
    const view = buildToolView([
      event(1, "tool.done", {
        name: "example_navigation_tool",
        result: { result: "{\"result\": true}" },
      }),
    ]);

    expect(view.detail).toBe("true");
  });
});
