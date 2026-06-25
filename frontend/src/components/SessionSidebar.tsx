import {
  Activity,
  AlertTriangle,
  Menu,
  Search,
  Wrench,
  X,
} from "lucide-react";

import type { SessionStatus, SessionSummary } from "../types";
import { IconButton } from "./IconButton";
import { StatusBadge } from "./StatusBadge";

type StatusFilter = "all" | Exclude<SessionStatus, "done" | "unknown">;

interface SessionSidebarProps {
  sessions: SessionSummary[];
  selectedId: string | null;
  statusFilter: StatusFilter;
  search: string;
  open: boolean;
  loading: boolean;
  onSearch: (value: string) => void;
  onStatusFilter: (value: StatusFilter) => void;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

const filters: StatusFilter[] = [
  "all",
  "running",
  "idle",
  "stale",
  "error",
];

const filterLabels: Record<StatusFilter, string> = {
  all: "All",
  running: "Running",
  idle: "Idle",
  stale: "Offline",
  error: "Error",
};

function relativeAge(value: string | null): string {
  if (!value) return "No activity";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function SessionSidebar({
  sessions,
  selectedId,
  statusFilter,
  search,
  open,
  loading,
  onSearch,
  onStatusFilter,
  onSelect,
  onClose,
}: SessionSidebarProps) {
  return (
    <>
      <aside className={`session-sidebar ${open ? "is-open" : ""}`}>
        <header className="brand-header">
          <div className="brand-mark" aria-hidden="true">
            <Activity size={18} />
          </div>
          <div>
            <strong>Hermes Lens</strong>
            <span>Live event observer</span>
          </div>
          <IconButton label="Close sessions" className="mobile-only" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>

        <div className="sidebar-controls">
          <label className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
            />
          </label>
          <div className="filter-row" aria-label="Session status filters">
            {filters.map((filter) => (
              <button
                key={filter}
                className={statusFilter === filter ? "is-selected" : ""}
                onClick={() => onStatusFilter(filter)}
                type="button"
              >
                {filterLabels[filter]}
              </button>
            ))}
          </div>
        </div>

        <div className="session-list" aria-busy={loading}>
          {sessions.map((session) => (
            <button
              key={session.session_id}
              type="button"
              className={`session-row ${
                selectedId === session.session_id ? "is-selected" : ""
              }`}
              onClick={() => onSelect(session.session_id)}
            >
              <div className="session-row-top">
                <strong>{session.agent_name || "Unknown agent"}</strong>
                <StatusBadge status={session.status} />
              </div>
              <code>{session.session_id}</code>
              <p>
                {session.last_user_preview ||
                  session.last_assistant_preview ||
                  "No message preview"}
              </p>
              <div className="session-row-meta">
                <span>{session.profile}</span>
                {session.running_tools.length > 0 && (
                  <span className="tool-count">
                    <Wrench size={12} />
                    {session.running_tools.length}
                  </span>
                )}
                {session.error_count > 0 && (
                  <span className="error-count">
                    <AlertTriangle size={12} />
                    {session.error_count}
                  </span>
                )}
                <time>{relativeAge(session.last_activity_seen || session.last_seen)}</time>
              </div>
            </button>
          ))}
          {!loading && sessions.length === 0 && (
            <div className="empty-sidebar">
              <Menu size={18} />
              <span>No matching sessions</span>
            </div>
          )}
        </div>
      </aside>
      {open && <button className="mobile-scrim" onClick={onClose} aria-label="Close sessions" />}
    </>
  );
}
