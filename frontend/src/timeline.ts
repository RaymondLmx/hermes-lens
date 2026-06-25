import type { MonitorEvent, TimelineGroup, TimelineItem } from "./types";
import { messageContent } from "./messageContent";
import { buildToolView } from "./toolView";

const TOOL_TYPES = new Set([
  "tool.start",
  "tool.progress",
  "tool.done",
  "tool.error",
]);

const SYSTEM_TYPES = new Set([
  "session.start",
  "session.heartbeat",
  "session.done",
  "turn.start",
  "turn.done",
  "status.update",
]);

export type EventFilter = "activity" | "errors" | "tools" | "debug";

export function isBehaviorEvent(event: MonitorEvent): boolean {
  if (event.importance === "debug") return false;
  if (isInternalPromptEvent(event)) return false;
  if (event.type === "warning" || event.type === "error") return true;
  if (event.type.includes("error")) return true;
  if (event.type === "user.message") return true;
  if (event.type.startsWith("assistant.")) return true;
  if (event.type.includes("reasoning") || event.type.includes("thinking")) {
    return true;
  }
  if (event.type.startsWith("tool.")) return true;
  if (event.type.startsWith("robot.")) return true;
  if (event.type.startsWith("vision.")) return true;
  if (SYSTEM_TYPES.has(event.type)) return false;
  return event.importance === "primary";
}

export function filterEvents(
  events: MonitorEvent[],
  filter: EventFilter,
): MonitorEvent[] {
  if (filter === "debug") {
    return events;
  }
  if (filter === "errors") {
    return events.filter(
      (event) => event.type === "warning" || event.type.includes("error"),
    );
  }
  if (filter === "tools") {
    return events.filter((event) => event.type.startsWith("tool."));
  }
  const internalTurns = new Set(
    events
      .filter(isInternalPromptEvent)
      .map((event) => event.turn_id)
      .filter((turnId): turnId is string => Boolean(turnId)),
  );
  return events.filter((event) => {
    if (event.turn_id && internalTurns.has(event.turn_id)) return false;
    return isBehaviorEvent(event);
  });
}

function isInternalPromptEvent(event: MonitorEvent): boolean {
  if (event.type !== "user.message") return false;
  const text = eventText(event).trim();
  return (
    text.startsWith("Review the conversation above and consider saving to memory") &&
    text.includes("You can only call memory and skill management tools")
  );
}

export function mergeEvent(
  events: MonitorEvent[],
  incoming: MonitorEvent,
): MonitorEvent[] {
  const existing = events.findIndex((event) => event.seq === incoming.seq);
  if (existing >= 0) {
    const next = [...events];
    next[existing] = incoming;
    return next.sort((left, right) => left.seq - right.seq);
  }
  return [...events, incoming].sort((left, right) => left.seq - right.seq);
}

interface TurnTiming {
  complete: boolean;
  durationMs: number;
}

function eventMs(event: MonitorEvent): number {
  const value = Date.parse(event.ts);
  return Number.isFinite(value) ? value : 0;
}

function formatDurationMs(durationMs: number): string {
  const safeMs = Math.max(0, durationMs);
  if (safeMs < 1000) return `${Math.round(safeMs)} ms`;
  const seconds = safeMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function formatTurnDuration(durationMs: number): string {
  return formatDurationMs(durationMs);
}

function computeTurnTimings(events: MonitorEvent[]): Map<number, TurnTiming> {
  const timings = new Map<number, TurnTiming>();
  const activeTurns = new Map<
    string,
    {
      assistantSeq: number | null;
      lastAt: number;
      startAt: number;
    }
  >();

  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (!event.turn_id) continue;
    const timestamp = eventMs(event);
    const current = activeTurns.get(event.turn_id);

    if (event.type === "turn.start" || !current) {
      activeTurns.set(event.turn_id, {
        assistantSeq: null,
        lastAt: timestamp,
        startAt: timestamp,
      });
      continue;
    }

    current.lastAt = Math.max(current.lastAt, timestamp);
    if (event.type === "assistant.done") {
      current.assistantSeq = event.seq;
      timings.set(event.seq, {
        complete: false,
        durationMs: Math.max(0, timestamp - current.startAt),
      });
      continue;
    }
    if (event.type === "turn.done") {
      if (current.assistantSeq !== null) {
        timings.set(current.assistantSeq, {
          complete: true,
          durationMs: Math.max(0, timestamp - current.startAt),
        });
      }
      activeTurns.delete(event.turn_id);
    }
  }

  return timings;
}

export function buildTimeline(
  events: MonitorEvent[],
  allEvents: MonitorEvent[] = events,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolIndexes = new Map<string, number>();
  const assistantIndexes = new Map<number, number>();
  const turnTimings = computeTurnTimings(allEvents);

  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (TOOL_TYPES.has(event.type) && event.group_id) {
      const existingIndex = toolIndexes.get(event.group_id);
      if (existingIndex !== undefined) {
        const existing = items[existingIndex];
        if (existing.kind === "tool") {
          existing.events.push(event);
        }
        continue;
      }
      toolIndexes.set(event.group_id, items.length);
      items.push({
        kind: "tool",
        id: `tool:${event.group_id}`,
        events: [event],
        turnId: event.turn_id,
      });
      continue;
    }
    items.push({ kind: "event", id: `event:${event.seq}`, event });
    if (event.turn_id && event.type === "assistant.done") {
      assistantIndexes.set(event.seq, items.length - 1);
    }
  }

  for (const [seq, index] of assistantIndexes) {
    const timing = turnTimings.get(seq);
    const item = items[index];
    if (!timing || timing.durationMs <= 0 || item.kind !== "event") continue;
    item.turnTiming = timing;
  }

  return items;
}

export function groupTimeline(
  items: TimelineItem[],
  allEvents: MonitorEvent[],
): TimelineGroup[] {
  const completedTurns = new Set(
    allEvents
      .filter((event) => event.type === "turn.done" && event.turn_id)
      .map((event) => event.turn_id as string),
  );
  const turnStarts = new Map<string, number>();
  for (const event of allEvents) {
    if (!event.turn_id) continue;
    const timestamp = eventMs(event);
    const current = turnStarts.get(event.turn_id);
    if (current === undefined || timestamp < current) {
      turnStarts.set(event.turn_id, timestamp);
    }
  }
  const groups: TimelineGroup[] = [];
  const groupOccurrences = new Map<string, number>();
  for (const item of items) {
    const turnId =
      item.kind === "event" ? item.event.turn_id : item.turnId;
    const baseKey = turnId || `ungrouped:${item.id}`;
    const previous = groups.at(-1);
    if (turnId !== null && previous?.turnId === turnId) {
      previous.items.push(item);
      continue;
    }
    const occurrence = groupOccurrences.get(baseKey) ?? 0;
    groupOccurrences.set(baseKey, occurrence + 1);
    groups.push({
      id: `${baseKey}:${occurrence}`,
      turnId,
      running: Boolean(turnId && !completedTurns.has(turnId)),
      startedAt: turnId ? turnStarts.get(turnId) ?? null : null,
      items: [item],
    });
  }
  return groups;
}

export function eventText(event: MonitorEvent): string {
  const message = messageContent(event);
  if (message.text) return message.text;
  for (const key of ["text", "content", "message", "summary", "caption"]) {
    const value = event.payload[key];
    if (typeof value === "string") {
      return value;
    }
  }
  const toolText = toolResultText(event);
  if (toolText) return toolText;
  return "";
}

function toolResultText(event: MonitorEvent): string {
  if (!event.type.startsWith("tool.")) return "";
  const view = buildToolView([event]);
  const streamSummary = view.streams
    .filter((stream) => stream.label !== "error")
    .map((stream) => stream.text)
    .find((text) => text.trim());
  const parts = [
    view.exitCodeLabel,
    view.isError && view.statusLabel !== "error" ? "error" : "",
    streamSummary || view.resultSummary,
  ].filter(Boolean);
  return parts.join("\n");
}

export function isDefaultExpanded(event: MonitorEvent): boolean {
  if (
    event.type === "warning" ||
    event.type === "error" ||
    event.type.endsWith(".error")
  ) {
    return false;
  }
  if (
    event.type === "user.message" ||
    event.type === "assistant.delta" ||
    event.type === "assistant.done"
  ) {
    return true;
  }
  return event.importance === "primary";
}
