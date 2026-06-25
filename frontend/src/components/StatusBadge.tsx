import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  PauseCircle,
  PlayCircle,
} from "lucide-react";

import type { SessionStatus } from "../types";

const statusLabels: Record<SessionStatus, string> = {
  running: "Running",
  idle: "Idle",
  stale: "Offline",
  done: "Done",
  error: "Error",
  unknown: "Unknown",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const Icon =
    status === "running"
      ? PlayCircle
      : status === "idle"
        ? PauseCircle
        : status === "stale"
          ? Clock3
          : status === "done"
            ? CheckCircle2
            : status === "error"
              ? AlertCircle
              : CircleDashed;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}
