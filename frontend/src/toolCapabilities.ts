export type ToolCapabilityKind =
  | "browser"
  | "communication"
  | "data"
  | "files"
  | "generic"
  | "mcp"
  | "memory"
  | "perception"
  | "skill"
  | "terminal";

export interface ToolCapability {
  kind: ToolCapabilityKind;
  label: string;
}

const CAPABILITIES: Record<ToolCapabilityKind, ToolCapability> = {
  browser: { kind: "browser", label: "Browser / Web" },
  communication: { kind: "communication", label: "Communication" },
  data: { kind: "data", label: "Data" },
  files: { kind: "files", label: "Files" },
  generic: { kind: "generic", label: "Tool" },
  mcp: { kind: "mcp", label: "MCP / External" },
  memory: { kind: "memory", label: "Memory" },
  perception: { kind: "perception", label: "Perception" },
  skill: { kind: "skill", label: "Skill" },
  terminal: { kind: "terminal", label: "Terminal / Code" },
};

function normalizedToolName(name: string): string {
  return name.trim().toLowerCase();
}

function hasAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function toolCapabilityForName(name: string): ToolCapability {
  const normalized = normalizedToolName(name);
  if (!normalized) return CAPABILITIES.generic;

  if (normalized.startsWith("skill") || hasAny(normalized, ["_skill", "skill_"])) {
    return CAPABILITIES.skill;
  }
  if (
    hasAny(normalized, [
      "camera",
      "frame",
      "image",
      "ocr",
      "perception",
      "screenshot",
      "vision",
      "visual",
    ])
  ) {
    return CAPABILITIES.perception;
  }
  if (normalized.startsWith("mcp") || hasAny(normalized, ["_mcp", "mcp_"])) {
    return CAPABILITIES.mcp;
  }
  if (hasAny(normalized, ["memory", "remember", "recall"])) {
    return CAPABILITIES.memory;
  }
  if (
    hasAny(normalized, [
      "browser",
      "crawl",
      "fetch",
      "navigate",
      "search",
      "url",
      "web",
    ])
  ) {
    return CAPABILITIES.browser;
  }
  if (
    hasAny(normalized, [
      "bash",
      "code",
      "command",
      "execute",
      "python",
      "shell",
      "terminal",
    ])
  ) {
    return CAPABILITIES.terminal;
  }
  if (
    hasAny(normalized, [
      "directory",
      "file",
      "glob",
      "grep",
      "list",
      "patch",
      "path",
      "read",
      "write",
    ])
  ) {
    return CAPABILITIES.files;
  }
  if (
    hasAny(normalized, ["database", "query", "sql", "store", "table", "vector"])
  ) {
    return CAPABILITIES.data;
  }
  if (
    hasAny(normalized, [
      "audio",
      "message",
      "notify",
      "slack",
      "speak",
      "speech",
      "voice",
    ])
  ) {
    return CAPABILITIES.communication;
  }
  return CAPABILITIES.generic;
}
