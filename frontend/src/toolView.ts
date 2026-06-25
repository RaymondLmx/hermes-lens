import type { MonitorEvent } from "./types";

export interface ToolStream {
  label: string;
  text: string;
  tone: "normal" | "error" | "muted";
}

export interface ToolView {
  argsText: string;
  detail: string;
  durationLabel: string;
  exitCodeLabel: string;
  isError: boolean;
  previewTarget: string;
  resultSummary: string;
  statusLabel: string;
  streams: ToolStream[];
  subtitle: string;
  title: string;
  toolName: string;
}

const WRAPPER_KEYS = ["data", "result", "output", "response", "payload"];
const PRIORITY_KEYS = [
  "title",
  "name",
  "path",
  "file",
  "filepath",
  "url",
  "href",
  "link",
  "status",
  "id",
  "message",
  "summary",
  "description",
];
const ERROR_KEYS = ["error", "errors", "failure", "exception"];
const NON_ERROR_TEXT = new Set([
  "",
  "0",
  "false",
  "none",
  "null",
  "nil",
  "ok",
  "success",
  "n/a",
  "na",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !/^[{["]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function normalize(value: unknown): unknown {
  return typeof value === "string" ? parseMaybeJson(value) : value;
}

function titleCase(key: string): string {
  return key
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function compactPreview(value: unknown, max = 120): string {
  let raw = value;
  if (isRecord(normalize(raw))) {
    raw = (normalize(raw) as Record<string, unknown>).context;
  }
  const text =
    typeof raw === "string"
      ? raw
      : raw == null
        ? ""
        : JSON.stringify(raw);
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

function clipBlock(value: string, maxChars = 1800, maxLines = 18): string {
  const text = value.trim();
  if (!text) return "";
  const lines = text.split("\n");
  let clipped = lines.slice(0, maxLines).join("\n");
  const didClip = lines.length > maxLines || clipped.length > maxChars;
  if (clipped.length > maxChars) clipped = clipped.slice(0, maxChars).trimEnd();
  return didClip && !clipped.endsWith("...") ? `${clipped}...` : clipped;
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function orderedKeys(keys: string[]): string[] {
  const priority = PRIORITY_KEYS.filter((key) => keys.includes(key));
  return [...priority, ...keys.filter((key) => !priority.includes(key))];
}

function isWrapperKey(key: string): boolean {
  return WRAPPER_KEYS.includes(key);
}

function shouldSkipField(key: string, value: unknown): boolean {
  return isWrapperKey(key) || ((key === "success" || key === "ok") && value === true);
}

function summarizeScalar(value: unknown): string {
  const normalized = normalize(value);
  if (typeof normalized === "string") return compactPreview(normalized, 180);
  if (typeof normalized === "number" || typeof normalized === "boolean") {
    return String(normalized);
  }
  return "";
}

function summarizeRecordInline(
  record: Record<string, unknown>,
  depth: number,
): string {
  if (depth > 3) return `${Object.keys(record).length} fields`;
  const title = firstString(record, [
    "title",
    "name",
    "path",
    "file",
    "filepath",
    "url",
    "href",
    "link",
    "id",
  ]);
  const status = firstString(record, ["status", "category", "type"]);
  const message = firstString(record, ["snippet", "summary", "description", "message"]);
  if (title && status) return `${compactPreview(title, 110)} (${compactPreview(status, 54)})`;
  if (title && message && title !== message) {
    return `${compactPreview(title, 90)} - ${compactPreview(message, 84)}`;
  }
  if (title) return compactPreview(title, 150);
  const pairs = orderedKeys(Object.keys(record))
    .filter((key) => !shouldSkipField(key, record[key]))
    .map((key) => {
      const value = summarizeScalar(record[key]);
      return value ? `${titleCase(key)}: ${value}` : "";
    })
    .filter(Boolean)
    .slice(0, 2);
  return pairs.length ? pairs.join(" | ") : `${Object.keys(record).length} fields`;
}

function formatFieldValue(value: unknown, depth: number): string {
  const normalized = normalize(value);
  const scalar = summarizeScalar(normalized);
  if (scalar) return scalar;
  if (normalized == null) return "";
  if (Array.isArray(normalized)) {
    if (!normalized.length) return "";
    const scalars = normalized.map(summarizeScalar).filter(Boolean);
    if (scalars.length === normalized.length && normalized.length <= 4) {
      return compactPreview(scalars.join(", "), 180);
    }
    const first = normalized[0];
    const firstText = isRecord(normalize(first))
      ? summarizeRecordInline(normalize(first) as Record<string, unknown>, depth + 1)
      : summarizeScalar(first);
    return firstText
      ? `${normalized.length} items (${firstText})`
      : `${normalized.length} items`;
  }
  if (isRecord(normalized)) return summarizeRecordInline(normalized, depth + 1);
  return compactPreview(String(normalized), 180);
}

function unwrapPayload(value: unknown): unknown {
  let current = normalize(value);
  for (let index = 0; index < 4; index += 1) {
    if (!isRecord(current)) return current;
    const record = current;
    const key = WRAPPER_KEYS.find((candidate) => record[candidate] != null);
    if (!key) return current;
    current = normalize(record[key]);
  }
  return current;
}

function formatSummary(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  const normalized = normalize(value);
  if (typeof normalized === "string") return clipBlock(normalized);
  if (typeof normalized === "number" || typeof normalized === "boolean") {
    return String(normalized);
  }
  if (normalized == null) return "";
  if (Array.isArray(normalized)) {
    return normalized
      .slice(0, 6)
      .map((item) => formatFieldValue(item, depth + 1))
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");
  }
  if (isRecord(normalized)) {
    const keys = Object.keys(normalized);
    const direct = firstString(normalized, [
      "message",
      "summary",
      "description",
      "preview",
      "text",
      "content",
    ]);
    const meaningful = keys.filter(
      (key) => !shouldSkipField(key, normalized[key]) && !isWrapperKey(key),
    );
    if (direct && meaningful.length <= 1) return clipBlock(direct);
    const lines = orderedKeys(keys)
      .filter((key) => !shouldSkipField(key, normalized[key]))
      .map((key) => {
        const field = formatFieldValue(normalized[key], depth + 1);
        return field ? `- ${titleCase(key)}: ${field}` : "";
      })
      .filter(Boolean)
      .slice(0, 8);
    return lines.join("\n");
  }
  return compactPreview(String(normalized), 180);
}

function hasMeaningfulErrorValue(value: unknown): boolean {
  const normalized = normalize(value);
  if (normalized == null) return false;
  if (typeof normalized === "string") {
    return !NON_ERROR_TEXT.has(normalized.trim().toLowerCase());
  }
  if (typeof normalized === "boolean") return normalized;
  if (typeof normalized === "number") return normalized !== 0;
  if (Array.isArray(normalized)) return normalized.some(hasMeaningfulErrorValue);
  if (isRecord(normalized)) return Object.keys(normalized).length > 0;
  return true;
}

function errorText(result: unknown): string {
  const normalized = normalize(result);
  if (!isRecord(normalized)) {
    return typeof normalized === "string" && hasMeaningfulErrorValue(normalized)
      ? clipBlock(normalized, 700, 12)
      : "";
  }
  for (const key of ERROR_KEYS) {
    const value = normalized[key];
    if (typeof value === "string" && hasMeaningfulErrorValue(value)) {
      return clipBlock(value, 700, 12);
    }
    if (isRecord(normalize(value))) {
      const direct = firstString(normalize(value) as Record<string, unknown>, [
        "message",
        "reason",
        "detail",
      ]);
      if (direct) return clipBlock(direct, 700, 12);
    }
  }
  const status = firstString(normalized, ["status"]);
  if (/\b(error|failed|failure|fatal|exception)\b/i.test(status)) {
    return firstString(normalized, ["message", "reason", "detail"]) || `Status: ${status}`;
  }
  if (normalized.success === false || normalized.ok === false) {
    return firstString(normalized, ["message", "reason", "detail"]) || "Tool returned success=false.";
  }
  const exitCode = firstNumber(normalized, ["exit_code", "code"]);
  return exitCode !== null && exitCode !== 0
    ? `Command failed with exit code ${exitCode}.`
    : "";
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function findFirstUrl(...sources: unknown[]): string {
  const pattern = /https?:\/\/[^\s'"<>)\]]+/i;
  for (const source of sources) {
    if (typeof source === "string") {
      const match = source.match(pattern);
      if (match) return match[0];
    } else if (isRecord(normalize(source))) {
      for (const value of Object.values(normalize(source) as Record<string, unknown>)) {
        const nested = findFirstUrl(value);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function hostLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname && url.pathname !== "/" ? url.pathname : ""}`;
  } catch {
    return value;
  }
}

function commandFromArgs(args: Record<string, unknown>): string {
  return firstString(args, ["command", "code", "cmd"]) || compactPreview(args, 180);
}

function subtitleForTool(
  name: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): string {
  if (name === "terminal" || name === "execute_code") {
    return commandFromArgs(args) || firstString(result, ["command", "cmd"]);
  }
  if (name === "browser_navigate" || name === "web_extract") {
    const url = firstString(args, ["url", "target"]) || firstString(result, ["url"]) || findFirstUrl(args, result);
    return url ? hostLabel(url) : "";
  }
  if (name === "web_search") {
    return firstString(args, ["search_term", "query"]) || firstString(result, ["query"]);
  }
  if (name.endsWith("file") || name.includes("_file")) {
    return firstString(args, ["path", "file", "filepath"]) || firstString(result, ["path", "file", "filepath"]);
  }
  return firstString(result, ["summary", "message", "description"]) || firstString(args, ["summary", "message"]);
}

function prettyJson(value: unknown): string {
  const normalized = normalize(value);
  if (normalized == null || normalized === "") return "";
  if (typeof normalized === "string") return normalized;
  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
}

function streamText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function buildToolView(events: MonitorEvent[]): ToolView {
  const first = events[0];
  const last = events[events.length - 1];
  const start = events.find((event) => event.type === "tool.start") ?? first;
  let finish = last;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "tool.error" || event.type === "tool.done") {
      finish = event;
      break;
    }
  }
  const toolName =
    events
      .map((event) => event.payload.name)
      .find((value): value is string => typeof value === "string") || "tool";
  const args = isRecord(normalize(start.payload.arguments))
    ? (normalize(start.payload.arguments) as Record<string, unknown>)
    : {};
  const result = normalize(finish.payload.result);
  const resultRecord = isRecord(result) ? result : {};
  const durationMs =
    firstNumber(finish.payload, ["duration_ms"]) ??
    firstNumber(resultRecord, ["duration_ms"]) ??
    (() => {
      const seconds = firstNumber(resultRecord, ["duration_s"]);
      return seconds === null ? null : seconds * 1000;
    })();
  const exitCode = firstNumber(resultRecord, ["exit_code", "code"]);
  const error = finish.type === "tool.error" ? errorText(result) || "Tool returned an error." : errorText(result);
  const isError = Boolean(error) || finish.type === "tool.error";
  const unwrapped = unwrapPayload(result);
  const detail = formatSummary(unwrapped || result);
  const subtitle = subtitleForTool(toolName, args, resultRecord);
  const streams: ToolStream[] = [];
  const stdout = streamText(resultRecord, "stdout");
  const stderr = streamText(resultRecord, "stderr");
  const output = streamText(resultRecord, "output");
  if (stdout) streams.push({ label: "stdout", text: stdout, tone: "normal" });
  if (stderr) streams.push({ label: "stderr", text: stderr, tone: "muted" });
  if (!stdout && !stderr && output) {
    streams.push({
      label: "output",
      text: output,
      tone: isError ? "error" : "normal",
    });
  }
  if (error && !streams.some((stream) => stream.text.includes(error))) {
    streams.unshift({ label: "error", text: error, tone: "error" });
  }
  const directTarget =
    firstString(resultRecord, ["preview", "url", "target", "path", "file", "filepath"]) ||
    firstString(args, ["preview", "url", "target", "path", "file", "filepath"]) ||
    findFirstUrl(args, resultRecord);
  const resultSummary =
    error ||
    streams[0]?.text ||
    detail ||
    firstString(resultRecord, ["message", "summary", "description"]) ||
    "";

  return {
    argsText: prettyJson(start.payload.arguments),
    detail: streams.length ? "" : detail,
    durationLabel: durationMs === null ? "" : formatDuration(durationMs),
    exitCodeLabel: exitCode === null ? "" : `exit_code: ${exitCode}`,
    isError,
    previewTarget: directTarget,
    resultSummary,
    statusLabel: isError ? "error" : finish.type === "tool.done" ? "done" : "running",
    streams,
    subtitle,
    title: toolName,
    toolName,
  };
}
