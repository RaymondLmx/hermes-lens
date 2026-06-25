import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronsDownUp,
  ChevronsUpDown,
  LoaderCircle,
  Menu,
  Pause,
  PanelRightOpen,
  Play,
  Radio,
  RefreshCw,
  SearchX,
  Settings2,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchEvents, fetchSessions, subscribeToEvents } from "./api";
import { DetailDrawer } from "./components/DetailDrawer";
import {
  EmptyTimeline,
  EventBlock,
  ToolBlock,
} from "./components/EventBlocks";
import { IconButton } from "./components/IconButton";
import { SettingsDrawer } from "./components/SettingsDrawer";
import type { MonitorSettings } from "./components/SettingsDrawer";
import type { ThemeKey } from "./components/SettingsDrawer";
import { SessionSidebar } from "./components/SessionSidebar";
import { StatusBadge } from "./components/StatusBadge";
import {
  buildTimeline,
  filterEvents,
  formatTurnDuration,
  groupTimeline,
  mergeEvent,
} from "./timeline";
import type { EventFilter } from "./timeline";
import type {
  MonitorEvent,
  SessionStatus,
  SessionSummary,
} from "./types";

type StatusFilter = "all" | Exclude<SessionStatus, "done" | "unknown">;
const SETTINGS_STORAGE_KEY = "hermes-lens-settings";
const DEFAULT_SETTINGS: MonitorSettings = {
  compactActivity: false,
  restoreAutoScrollOnSessionSwitch: true,
  showHeartbeatsInDebug: false,
  showLifecycleEventsInDebug: true,
  theme: "hermes-dark",
};
const THEME_KEYS = new Set<ThemeKey>([
  "hermes-dark",
  "hermes-light",
  "vscode-dark",
  "vscode-light",
]);

function formatTime(ts: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

function App() {
  const [settings, setSettings] = useState<MonitorSettings>(() => {
    try {
      const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!stored) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(stored) as Partial<MonitorSettings>;
      const theme = parsed.theme && THEME_KEYS.has(parsed.theme)
        ? parsed.theme
        : DEFAULT_SETTINGS.theme;
      return {
        compactActivity: parsed.compactActivity === true,
        restoreAutoScrollOnSessionSwitch:
          parsed.restoreAutoScrollOnSessionSwitch !== false,
        showHeartbeatsInDebug: parsed.showHeartbeatsInDebug === true,
        showLifecycleEventsInDebug:
          parsed.showLifecycleEventsInDebug !== false,
        theme,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [warnings, setWarnings] = useState<Array<{ line: number; error: string }>>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [eventFilter, setEventFilter] = useState<EventFilter>("activity");
  const [streamState, setStreamState] = useState<"connected" | "reconnecting">(
    "reconnecting",
  );
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [detailEvent, setDetailEvent] = useState<MonitorEvent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expansionCommand, setExpansionCommand] = useState<{
    expanded: boolean;
    id: number;
  } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  const refreshSessions = async () => {
    try {
      const next = await fetchSessions();
      setSessions(next);
      setSelectedId((current) => current || next[0]?.session_id || null);
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    void refreshSessions();
    const timer = window.setInterval(() => void refreshSessions(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    const controller = new AbortController();
    setLoadingEvents(true);
    setEvents([]);
    setWarnings([]);
    setDetailEvent(null);
    setStreamState("reconnecting");
    void fetchEvents(selectedId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setEvents(response.events);
        setWarnings(response.warnings);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setWarnings([{ line: 0, error: "Failed to load session events" }]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingEvents(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || loadingEvents) return;
    const afterSeq = events.at(-1)?.seq ?? -1;
    return subscribeToEvents(
      selectedId,
      afterSeq,
      (event) => setEvents((current) => mergeEvent(current, event)),
      setStreamState,
    );
  }, [selectedId, loadingEvents]);

  useEffect(() => {
    const scrollElement = timelineScrollRef.current;
    if (autoScroll && scrollElement) {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [events, autoScroll]);

  useEffect(() => {
    if (settings.restoreAutoScrollOnSessionSwitch) setAutoScroll(true);
  }, [selectedId, settings.restoreAutoScrollOnSessionSwitch]);

  useEffect(() => {
    setExpansionCommand(null);
  }, [eventFilter]);

  const handleTimelineScroll = () => {
    const scrollElement = timelineScrollRef.current;
    if (!scrollElement) return;
    const distanceFromBottom =
      scrollElement.scrollHeight -
      scrollElement.scrollTop -
      scrollElement.clientHeight;
    const nearBottom = distanceFromBottom < 96;
    setAutoScroll((current) => (current === nearBottom ? current : nearBottom));
  };

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sessions.filter((session) => {
      const statusMatches =
        statusFilter === "all" || session.status === statusFilter;
      const text = [
        session.session_id,
        session.agent_id,
        session.agent_name,
        session.profile,
        session.last_user_preview,
        session.last_assistant_preview,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return statusMatches && (!query || text.includes(query));
    });
  }, [sessions, search, statusFilter]);

  const selectedSession =
    sessions.find((session) => session.session_id === selectedId) || null;

  const visibleEvents = useMemo(() => {
    let filtered = filterEvents(events, eventFilter);
    if (eventFilter !== "debug") return filtered;
    if (!settings.showHeartbeatsInDebug) {
      filtered = filtered.filter((event) => event.type !== "session.heartbeat");
    }
    if (!settings.showLifecycleEventsInDebug) {
      filtered = filtered.filter(
        (event) =>
          ![
            "session.start",
            "session.done",
            "turn.start",
            "turn.done",
            "status.update",
          ].includes(event.type),
      );
    }
    return filtered;
  }, [
    events,
    eventFilter,
    settings.showHeartbeatsInDebug,
    settings.showLifecycleEventsInDebug,
  ]);

  const hiddenDebugEventCount = useMemo(() => {
    if (eventFilter !== "debug") return 0;
    return filterEvents(events, eventFilter).length - visibleEvents.length;
  }, [events, eventFilter, visibleEvents.length]);

  const timeline = useMemo(() => {
    return buildTimeline(visibleEvents, events);
  }, [events, visibleEvents]);
  const timelineGroups = useMemo(
    () => groupTimeline(timeline, events),
    [timeline, events],
  );

  useEffect(() => {
    if (!timelineGroups.some((group) => group.running)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timelineGroups]);

  const scrollToTurn = (direction: "previous" | "next") => {
    const scrollElement = timelineScrollRef.current;
    if (!scrollElement) return;
    const groups = Array.from(
      scrollElement.querySelectorAll<HTMLElement>(".turn-group[data-turn]"),
    );
    if (groups.length === 0) return;
    const viewportTop = scrollElement.getBoundingClientRect().top;
    const currentIndex = groups.findIndex(
      (group) => group.getBoundingClientRect().bottom > viewportTop + 48,
    );
    const targetIndex =
      direction === "previous"
        ? Math.max(0, (currentIndex < 0 ? groups.length : currentIndex) - 1)
        : Math.min(groups.length - 1, Math.max(0, currentIndex + 1));
    groups[targetIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAutoScroll(false);
  };

  const jumpToLatest = () => {
    const scrollElement = timelineScrollRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTo({
      top: scrollElement.scrollHeight,
      behavior: "smooth",
    });
    setAutoScroll(true);
  };

  const openDetail = (event: MonitorEvent) => {
    setSettingsOpen(false);
    setDetailEvent(event);
  };

  return (
    <main
      className={`app-shell ${detailEvent || settingsOpen ? "has-drawer" : ""} ${
        settings.compactActivity ? "compact-activity" : ""
      }`}
    >
      <SessionSidebar
        sessions={filteredSessions}
        selectedId={selectedId}
        statusFilter={statusFilter}
        search={search}
        open={sidebarOpen}
        loading={loadingSessions}
        onSearch={setSearch}
        onStatusFilter={setStatusFilter}
        onSelect={(sessionId) => {
          if (sessionId !== selectedId) {
            setEvents([]);
            setWarnings([]);
            setLoadingEvents(true);
          }
          setSelectedId(sessionId);
          setSettingsOpen(false);
          setSidebarOpen(false);
        }}
        onClose={() => setSidebarOpen(false)}
      />

      <section className="timeline-pane">
        <header className="timeline-header">
          <IconButton
            label="Open sessions"
            className="mobile-only"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={19} />
          </IconButton>
          <div className="session-heading">
            <span>Live session</span>
            <strong>{selectedSession?.agent_name || "No session selected"}</strong>
            {selectedSession && <code>{selectedSession.session_id}</code>}
          </div>
          <div className="header-status">
            {selectedSession && <StatusBadge status={selectedSession.status} />}
            {selectedSession && (
              <span className={`stream-state stream-${streamState}`}>
                <Radio size={13} />
                <span>
                  {streamState === "connected" ? "Live" : "Reconnecting"}
                </span>
              </span>
            )}
          </div>
          <div className="header-actions">
            <IconButton label="Refresh sessions" onClick={() => void refreshSessions()}>
              <RefreshCw size={17} />
            </IconButton>
            <IconButton
              label="Open settings"
              onClick={() => {
                setDetailEvent(null);
                setSettingsOpen(true);
              }}
            >
              <Settings2 size={17} />
            </IconButton>
            <IconButton
              label={autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"}
              onClick={() => setAutoScroll(!autoScroll)}
            >
              {autoScroll ? <Pause size={17} /> : <Play size={17} />}
            </IconButton>
          </div>
        </header>

        <div className="timeline-toolbar">
          <div className="segmented-control" aria-label="Event filter">
            {(["activity", "errors", "tools", "debug"] as const).map((filter) => (
              <button
                type="button"
                key={filter}
                className={eventFilter === filter ? "is-selected" : ""}
                onClick={() => setEventFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <span>
            {timeline.length} shown / {events.length} events
          </span>
          {hiddenDebugEventCount > 0 && (
            <span className="muted-summary">
              {hiddenDebugEventCount} debug events hidden
            </span>
          )}
          {warnings.length > 0 && (
            <span className="warning-summary">
              <AlertTriangle size={14} />
              {warnings.length} invalid lines
            </span>
          )}
          <span className="toolbar-spacer" />
          <IconButton label="Previous turn" onClick={() => scrollToTurn("previous")}>
            <ArrowUp size={17} />
          </IconButton>
          <IconButton label="Next turn" onClick={() => scrollToTurn("next")}>
            <ArrowDown size={17} />
          </IconButton>
          <IconButton
            label="Expand visible blocks"
            onClick={() =>
              setExpansionCommand((current) => ({
                expanded: true,
                id: (current?.id ?? 0) + 1,
              }))
            }
          >
            <ChevronsUpDown size={17} />
          </IconButton>
          <IconButton
            label="Collapse visible blocks"
            onClick={() =>
              setExpansionCommand((current) => ({
                expanded: false,
                id: (current?.id ?? 0) + 1,
              }))
            }
          >
            <ChevronsDownUp size={17} />
          </IconButton>
        </div>

        <div
          className="timeline-scroll"
          ref={timelineScrollRef}
          onScroll={handleTimelineScroll}
        >
          <div
            className="timeline-content"
            aria-busy={loadingEvents}
            key={`${selectedId || "none"}:${eventFilter}`}
          >
            {!selectedSession && <EmptyTimeline />}
            {selectedSession && loadingEvents && timeline.length === 0 && (
              <div className="timeline-loading">
                <LoaderCircle size={21} />
                <span>Loading session</span>
              </div>
            )}
            {selectedSession && timeline.length === 0 && !loadingEvents && (
              <div className="empty-timeline">
                <SearchX size={24} />
                <strong>No visible events</strong>
                <span>Switch to Debug to inspect system events.</span>
              </div>
            )}
            {timelineGroups.map((group) => {
              const chatLayout = eventFilter === "activity" && group.turnId;
              const userItems = chatLayout
                ? group.items.filter(
                    (item) =>
                      item.kind === "event" &&
                      item.event.type === "user.message",
                  )
                : [];
              const assistantItems = chatLayout
                ? group.items.filter(
                    (item) =>
                      item.kind !== "event" ||
                      item.event.type !== "user.message",
                  )
                : [];
              const assistantEvent = assistantItems.find(
                (item) =>
                  item.kind === "event" &&
                  item.event.type === "assistant.done",
              );
              const turnTiming =
                assistantEvent?.kind === "event"
                  ? assistantEvent.turnTiming
                  : undefined;
              const assistantTimestamp =
                assistantEvent?.kind === "event"
                  ? assistantEvent.event.ts
                  : null;

              return (
                <section
                  className={`turn-group ${group.running ? "is-running" : ""} ${chatLayout ? "is-chat-turn" : ""}`}
                  data-turn={group.turnId || undefined}
                  key={group.id}
                >
                  {chatLayout ? (
                    <>
                      {userItems.map((item) =>
                        item.kind === "event" ? (
                          <div className="chat-user-row" key={item.id}>
                            <div className="chat-user-column">
                              <div className="chat-user-bubble">
                                <header className="chat-bubble-meta">
                                  <span />
                                  <span className="chat-meta-actions">
                                    <time>{formatTime(item.event.ts)}</time>
                                    <button
                                      type="button"
                                      className="event-detail-trigger"
                                      aria-label="Open user event detail"
                                      title="Open event detail"
                                      onClick={() => openDetail(item.event)}
                                    >
                                      <PanelRightOpen size={13} />
                                    </button>
                                  </span>
                                </header>
                                <EventBlock
                                  event={item.event}
                                  onInspect={openDetail}
                                  expansionCommand={expansionCommand}
                                  embedded
                                />
                              </div>
                            </div>
                            <div className="chat-identity chat-user-identity">
                              <span className="event-icon">
                                <User size={21} aria-hidden="true" />
                              </span>
                            </div>
                          </div>
                        ) : null,
                      )}
                      {(assistantItems.length > 0 || group.running) && (
                        <div className="chat-assistant-row">
                          <div className="chat-identity chat-assistant-identity">
                            <span className="event-icon">
                              <Bot size={21} aria-hidden="true" />
                            </span>
                          </div>
                          <div className="chat-assistant-column">
                            <div className="chat-assistant-bubble">
                              <header className="chat-bubble-meta">
                                {group.running ? (
                                  <span className="chat-running">
                                    Running
                                    {group.startedAt
                                      ? ` · ${formatTurnDuration(clock - group.startedAt)}`
                                      : ""}
                                  </span>
                                ) : turnTiming ? (
                                  <span className="event-duration">
                                    {formatTurnDuration(turnTiming.durationMs)}
                                  </span>
                                ) : <span />}
                              {assistantTimestamp && (
                                <span className="chat-meta-actions">
                                  <time>{formatTime(assistantTimestamp)}</time>
                                  {assistantEvent?.kind === "event" && (
                                    <button
                                      type="button"
                                      className="event-detail-trigger"
                                      aria-label="Open assistant event detail"
                                      title="Open event detail"
                                      onClick={() => openDetail(assistantEvent.event)}
                                    >
                                      <PanelRightOpen size={13} />
                                    </button>
                                  )}
                                </span>
                              )}
                              </header>
                              <div className="chat-assistant-content">
                                {assistantItems.map((item) =>
                                  item.kind === "tool" ? (
                                    <ToolBlock
                                      key={item.id}
                                      events={item.events}
                                      onInspect={openDetail}
                                      expansionCommand={expansionCommand}
                                      embedded
                                    />
                                  ) : (
                                    <EventBlock
                                      key={item.id}
                                      event={item.event}
                                      onInspect={openDetail}
                                      expansionCommand={expansionCommand}
                                      turnTiming={item.turnTiming}
                                      embedded
                                    />
                                  ),
                                )}
                                {assistantItems.length === 0 && group.running && (
                                  <div className="chat-waiting">
                                    <span />
                                    <span />
                                    <span />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {group.turnId && (
                        <div className="turn-group-status" aria-hidden="true">
                          <span />
                          {group.running && (
                            <em>
                              Running
                              {group.startedAt
                                ? ` · ${formatTurnDuration(clock - group.startedAt)}`
                                : ""}
                            </em>
                          )}
                        </div>
                      )}
                      {group.items.map((item) =>
                        item.kind === "tool" ? (
                          <ToolBlock
                            key={item.id}
                            events={item.events}
                            onInspect={openDetail}
                            expansionCommand={expansionCommand}
                            debugDetails={eventFilter === "debug"}
                          />
                        ) : (
                          <EventBlock
                            key={item.id}
                            event={item.event}
                            onInspect={openDetail}
                            expansionCommand={expansionCommand}
                            turnTiming={item.turnTiming}
                            debugDetails={eventFilter === "debug"}
                          />
                        ),
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
          {!autoScroll && (
            <button
              type="button"
              className="jump-latest"
              onClick={jumpToLatest}
            >
              <ArrowDown size={15} />
              Latest
            </button>
          )}
        </div>
      </section>

      {settingsOpen ? (
        <SettingsDrawer
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : (
        <DetailDrawer event={detailEvent} onClose={() => setDetailEvent(null)} />
      )}
    </main>
  );
}

export default App;
