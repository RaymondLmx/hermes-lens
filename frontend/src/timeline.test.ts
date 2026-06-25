import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  eventText,
  filterEvents,
  formatTurnDuration,
  groupTimeline,
  isDefaultExpanded,
  mergeEvent,
} from "./timeline";
import type { MonitorEvent } from "./types";

function event(
  seq: number,
  type: string,
  groupId: string | null = null,
  payload: Record<string, unknown> = {},
): MonitorEvent {
  return {
    schema_version: 1,
    session_id: "session-1",
    turn_id: "turn-1",
    seq,
    ts: "2026-06-24T10:00:00+08:00",
    source: "hermes",
    type,
    importance: "normal",
    group_id: groupId,
    payload,
  };
}

describe("buildTimeline", () => {
  it("groups tool lifecycle events by group_id", () => {
    const result = buildTimeline([
      event(1, "tool.start", "tool-1"),
      event(2, "tool.progress", "tool-1"),
      event(3, "tool.done", "tool-1"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("tool");
    if (result[0].kind === "tool") {
      expect(result[0].events.map((item) => item.seq)).toEqual([1, 2, 3]);
    }
  });

  it("keeps ungrouped events in sequence order", () => {
    const result = buildTimeline([
      event(2, "assistant.done"),
      event(1, "user.message"),
    ]);

    expect(result.map((item) => item.id)).toEqual(["event:1", "event:2"]);
  });

  it("attaches turn duration to the assistant event", () => {
    const started = event(1, "turn.start");
    started.ts = "2026-06-24T10:00:00+08:00";
    const user = event(2, "user.message", null, { text: "go" });
    user.ts = "2026-06-24T10:00:01+08:00";
    const assistant = event(3, "assistant.done", null, { text: "done" });
    assistant.ts = "2026-06-24T10:00:05+08:00";
    const done = event(4, "turn.done");
    done.ts = "2026-06-24T10:00:06+08:00";

    const result = buildTimeline(filterEvents([started, user, assistant, done], "activity"), [
      started,
      user,
      assistant,
      done,
    ]);

    expect(result.map((item) => item.kind)).toEqual(["event", "event"]);
    const assistantItem = result[1];
    expect(assistantItem.kind).toBe("event");
    if (assistantItem.kind === "event") {
      expect(assistantItem.turnTiming?.durationMs).toBe(6000);
      expect(assistantItem.turnTiming?.complete).toBe(true);
    }
  });

  it("does not merge reused turn ids into one long duration", () => {
    const firstStart = event(1, "turn.start");
    firstStart.ts = "2026-06-24T10:00:00+08:00";
    const firstAssistant = event(2, "assistant.done", null, { text: "first" });
    firstAssistant.ts = "2026-06-24T10:00:03+08:00";
    const firstDone = event(3, "turn.done");
    firstDone.ts = "2026-06-24T10:00:04+08:00";
    const secondStart = event(4, "turn.start");
    secondStart.ts = "2026-06-24T10:21:00+08:00";
    const secondAssistant = event(5, "assistant.done", null, { text: "second" });
    secondAssistant.ts = "2026-06-24T10:21:05+08:00";
    const secondDone = event(6, "turn.done");
    secondDone.ts = "2026-06-24T10:21:06+08:00";
    const allEvents = [
      firstStart,
      firstAssistant,
      firstDone,
      secondStart,
      secondAssistant,
      secondDone,
    ];

    const result = buildTimeline(filterEvents(allEvents, "activity"), allEvents);
    const assistantItems = result.filter(
      (item) => item.kind === "event" && item.event.type === "assistant.done",
    );

    expect(assistantItems).toHaveLength(2);
    const secondItem = assistantItems[1];
    expect(secondItem.kind).toBe("event");
    if (secondItem.kind === "event") {
      expect(secondItem.turnTiming?.durationMs).toBe(6000);
    }
  });
});

describe("groupTimeline", () => {
  it("keeps conversation and tools from the same turn together", () => {
    const user = event(1, "user.message");
    const toolStart = event(2, "tool.start", "tool-1");
    const toolDone = event(3, "tool.done", "tool-1");
    const assistant = event(4, "assistant.done");
    const done = event(5, "turn.done");
    const allEvents = [user, toolStart, toolDone, assistant, done];

    const groups = groupTimeline(
      buildTimeline([user, toolStart, toolDone, assistant], allEvents),
      allEvents,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].turnId).toBe("turn-1");
    expect(groups[0].running).toBe(false);
    expect(groups[0].items).toHaveLength(3);
  });

  it("marks an open turn as running", () => {
    const user = event(1, "user.message");
    const groups = groupTimeline(buildTimeline([user]), [user]);

    expect(groups[0].running).toBe(true);
  });

  it("uses unique keys when debug events split the same turn", () => {
    const first = event(1, "user.message");
    const heartbeat = event(2, "session.heartbeat");
    heartbeat.turn_id = null;
    const second = event(3, "assistant.done");
    const items = buildTimeline([first, heartbeat, second]);
    const groups = groupTimeline(items, [first, heartbeat, second]);

    expect(groups.map((group) => group.id)).toEqual([
      "turn-1:0",
      "ungrouped:event:2:0",
      "turn-1:1",
    ]);
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
  });
});

describe("mergeEvent", () => {
  it("deduplicates replayed sequence numbers", () => {
    expect(mergeEvent([event(1, "assistant.delta")], event(1, "assistant.done")))
      .toHaveLength(1);
  });
});

describe("filterEvents", () => {
  it("hides system lifecycle events from the default activity view", () => {
    const events = [
      event(1, "session.start"),
      event(2, "turn.start"),
      event(3, "status.update"),
      event(4, "user.message"),
      event(5, "tool.start", "tool-1"),
      event(6, "assistant.done"),
      event(7, "turn.done"),
    ];

    expect(filterEvents(events, "activity").map((item) => item.type)).toEqual([
      "user.message",
      "tool.start",
      "assistant.done",
    ]);
  });

  it("keeps all events in debug view", () => {
    const events = [
      event(1, "session.start"),
      event(2, "turn.start"),
      event(3, "assistant.done"),
    ];

    expect(filterEvents(events, "debug")).toHaveLength(3);
  });

  it("keeps reasoning and thinking events in activity view", () => {
    const reasoning = event(1, "reasoning.delta", null, { text: "thinking" });
    const thinking = event(2, "thinking.delta", null, { text: "planning" });
    const status = event(3, "status.update");

    expect(filterEvents([reasoning, thinking, status], "activity").map(
      (item) => item.type,
    )).toEqual(["reasoning.delta", "thinking.delta"]);
    expect(isDefaultExpanded(reasoning)).toBe(false);
    expect(isDefaultExpanded(thinking)).toBe(false);
  });

  it("hides internal memory review turns from activity view", () => {
    const memoryPrompt = event(1, "user.message", null, {
      text:
        "Review the conversation above and consider saving to memory if appropriate.\n\n" +
        "You can only call memory and skill management tools. Other tools will be denied at runtime.",
    });
    const memoryAnswer = event(2, "assistant.done", null, {
      text: "Nothing to save.",
    });
    const userMessage = event(3, "user.message", null, { text: "go forward" });
    userMessage.turn_id = "turn-2";

    expect(
      filterEvents([memoryPrompt, memoryAnswer, userMessage], "activity").map(
        (item) => item.seq,
      ),
    ).toEqual([3]);
    expect(filterEvents([memoryPrompt, memoryAnswer], "debug")).toHaveLength(2);
  });
});

describe("eventText", () => {
  it("extracts user text from Hermes multimodal content", () => {
    expect(
      eventText(
        event(1, "user.message", null, {
          text: [
            {
              type: "text",
              text: JSON.stringify({ user_text: "看看这张图" }),
            },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,abc" },
            },
          ],
        }),
      ),
    ).toBe("看看这张图");
  });

  it("extracts useful nested tool error output", () => {
    expect(
      eventText(
        event(1, "tool.error", "tool-1", {
          result: {
            output: "/usr/bin/bash: example_tool: command not found",
            exit_code: 127,
            error: null,
          },
        }),
      ),
    ).toContain("exit_code: 127");
    expect(
      eventText(
        event(1, "tool.error", "tool-1", {
          result: {
            output: "/usr/bin/bash: example_tool: command not found",
            exit_code: 127,
            error: null,
          },
        }),
      ),
    ).toContain("command not found");
  });
});

describe("isDefaultExpanded", () => {
  it("expands conversation while folding reasoning and errors", () => {
    expect(isDefaultExpanded(event(1, "user.message"))).toBe(true);
    expect(isDefaultExpanded(event(2, "tool.error", "tool-1"))).toBe(false);
    expect(isDefaultExpanded(event(3, "error"))).toBe(false);
    expect(isDefaultExpanded(event(4, "warning"))).toBe(false);
    const primaryError = event(5, "error");
    primaryError.importance = "primary";
    expect(isDefaultExpanded(primaryError)).toBe(false);
    expect(isDefaultExpanded(event(6, "reasoning.delta"))).toBe(false);
  });
});

describe("formatTurnDuration", () => {
  it("formats compact turn durations", () => {
    expect(formatTurnDuration(450)).toBe("450 ms");
    expect(formatTurnDuration(1250)).toBe("1.3 s");
    expect(formatTurnDuration(62_000)).toBe("1m 2s");
  });
});
