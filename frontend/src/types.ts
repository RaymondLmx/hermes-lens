export type SessionStatus =
  | "running"
  | "idle"
  | "stale"
  | "done"
  | "error"
  | "unknown";

export interface SessionSummary {
  session_id: string;
  status: SessionStatus;
  active: boolean;
  agent_id: string;
  agent_name: string;
  profile: string;
  sources: string[];
  first_seen: string | null;
  last_seen: string | null;
  last_activity_seen?: string | null;
  last_heartbeat: string | null;
  heartbeat_age_seconds: number | null;
  current_turn_id: string | null;
  running_tools: string[];
  last_user_preview: string | null;
  last_assistant_preview: string | null;
  error_count: number;
  event_count: number;
  last_seq: number;
  invalid_line_count: number;
}

export interface MonitorEvent {
  schema_version: number;
  session_id: string;
  turn_id: string | null;
  seq: number;
  ts: string;
  source: string;
  type: string;
  importance: "primary" | "normal" | "detail" | "debug";
  group_id: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  profile?: string | null;
  payload: Record<string, unknown>;
}

export interface EventsResponse {
  session_id: string;
  events: MonitorEvent[];
  warnings: Array<{ line: number; error: string }>;
}

export type TimelineItem =
  | {
      kind: "event";
      id: string;
      event: MonitorEvent;
      turnTiming?: { durationMs: number; complete: boolean };
    }
  | {
      kind: "tool";
      id: string;
      events: MonitorEvent[];
      turnId: string | null;
    };

export interface TimelineGroup {
  id: string;
  turnId: string | null;
  running: boolean;
  startedAt: number | null;
  items: TimelineItem[];
}
