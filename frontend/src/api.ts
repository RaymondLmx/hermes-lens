import type { EventsResponse, MonitorEvent, SessionSummary } from "./types";

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchSessions(
  signal?: AbortSignal,
): Promise<SessionSummary[]> {
  const result = await requestJson<{ sessions: SessionSummary[] }>(
    "/api/sessions",
    signal,
  );
  return result.sessions;
}

export function fetchEvents(
  sessionId: string,
  signal?: AbortSignal,
): Promise<EventsResponse> {
  return requestJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/events`,
    signal,
  );
}

export function subscribeToEvents(
  sessionId: string,
  afterSeq: number,
  onEvent: (event: MonitorEvent) => void,
  onState: (state: "connected" | "reconnecting") => void,
): () => void {
  const stream = new EventSource(
    `/api/sessions/${encodeURIComponent(sessionId)}/stream?after_seq=${afterSeq}`,
  );
  stream.addEventListener("open", () => onState("connected"));
  stream.addEventListener("error", () => onState("reconnecting"));
  stream.addEventListener("monitor-event", (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent<string>).data) as MonitorEvent);
    } catch {
      // Invalid stream events are ignored; the JSONL replay remains authoritative.
    }
  });
  return () => stream.close();
}

export function mediaUrl(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`;
}
