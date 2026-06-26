import {
  AlertCircle,
  Bot,
  BrainCircuit,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  MessageSquare,
  Radio,
  User,
  Wrench,
  X,
  ZoomIn,
} from "lucide-react";
import { useEffect, useState } from "react";

import { messageContent } from "../messageContent";
import type { MessageMedia } from "../messageContent";
import { eventText, formatTurnDuration, isDefaultExpanded } from "../timeline";
import { buildToolView } from "../toolView";
import type { MonitorEvent } from "../types";

interface BlockProps {
  event: MonitorEvent;
  onInspect: (event: MonitorEvent) => void;
  expansionCommand: { expanded: boolean; id: number } | null;
  turnTiming?: { durationMs: number; complete: boolean };
  debugDetails?: boolean;
  embedded?: boolean;
}

function formatTime(ts: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

function iconFor(event: MonitorEvent) {
  if (event.type === "user.message") return User;
  if (event.type.startsWith("assistant.")) return Bot;
  if (event.type.includes("reasoning") || event.type.includes("thinking")) {
    return BrainCircuit;
  }
  if (event.type.startsWith("vision.")) return Camera;
  if (event.type === "error" || event.type.endsWith(".error")) return AlertCircle;
  if (event.type === "warning") return AlertCircle;
  if (event.type === "session.heartbeat") return Radio;
  if (event.type.endsWith(".done")) return CheckCircle2;
  if (event.type.startsWith("status.")) return Clock3;
  return CircleDot;
}

function displayTitle(event: MonitorEvent, debugDetails: boolean): string {
  if (debugDetails) return event.type;
  if (event.type === "user.message") return "User";
  if (event.type === "assistant.done" || event.type === "assistant.delta") {
    return "Assistant";
  }
  if (event.type.includes("reasoning") || event.type.includes("thinking")) {
    return "Thinking";
  }
  if (event.type.startsWith("vision.")) return "Vision";
  if (event.type.includes("error")) return "Error";
  if (event.type === "warning") return "Warning";
  if (event.type.startsWith("robot.")) return "Robot";
  return event.type;
}

function MediaGallery({ media }: { media: MessageMedia[] }) {
  const [failedMedia, setFailedMedia] = useState<Set<string>>(new Set());
  const [selectedMedia, setSelectedMedia] = useState<MessageMedia | null>(null);
  const [mediaDimensions, setMediaDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});

  useEffect(() => {
    if (!selectedMedia) return;
    const close = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") setSelectedMedia(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedMedia]);

  if (media.length === 0) return null;

  return (
    <>
      <div className="media-gallery">
        {media.map((item) =>
          item.unavailableReason || !item.src || failedMedia.has(item.src) ? (
            <div
              className="media-unavailable"
              key={`${item.alt}:${item.src ?? item.unavailableReason}`}
            >
              <Camera size={17} />
              <span>
                {item.unavailableReason || "Unavailable · blocked or missing"}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="media-thumbnail"
              key={item.src}
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                setSelectedMedia(item);
              }}
            >
              <img
                src={item.src}
                alt={item.alt}
                loading="lazy"
                onLoad={(loadEvent) => {
                  const image = loadEvent.currentTarget;
                  setMediaDimensions((current) => ({
                    ...current,
                    [item.src as string]: {
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    },
                  }));
                }}
                onError={() =>
                  setFailedMedia((current) =>
                    new Set(current).add(item.src as string),
                  )
                }
              />
              <span>
                <ZoomIn size={13} />
                {item.mime || "image"}
                {(item.width && item.height
                  ? `${item.width}x${item.height}`
                  : mediaDimensions[item.src]
                    ? `${mediaDimensions[item.src].width}x${mediaDimensions[item.src].height}`
                    : "")}
              </span>
            </button>
          ),
        )}
      </div>
      {selectedMedia?.src && (
        <div
          className="media-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setSelectedMedia(null)}
        >
          <button
            type="button"
            className="media-lightbox-close"
            aria-label="Close image preview"
            onClick={() => setSelectedMedia(null)}
          >
            <X size={20} />
          </button>
          <figure onClick={(clickEvent) => clickEvent.stopPropagation()}>
            <img src={selectedMedia.src} alt={selectedMedia.alt} />
            <figcaption>
              <span>{selectedMedia.alt}</span>
              <code>
                {selectedMedia.mime || "image"}
                {selectedMedia.src && mediaDimensions[selectedMedia.src]
                  ? ` · ${mediaDimensions[selectedMedia.src].width}x${mediaDimensions[selectedMedia.src].height}`
                  : ""}
              </code>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

function uniqueMedia(media: MessageMedia[]): MessageMedia[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    const key = item.src ?? `${item.alt}:${item.unavailableReason ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function EventBlock({
  event,
  onInspect,
  expansionCommand,
  turnTiming,
  debugDetails = false,
  embedded = false,
}: BlockProps) {
  const [expanded, setExpanded] = useState(isDefaultExpanded(event));
  const Icon = iconFor(event);
  const text = eventText(event);
  const content = messageContent(event);
  const collapsible =
    event.type.includes("reasoning") ||
    event.type.includes("thinking") ||
    event.importance === "detail" ||
    event.importance === "debug";

  useEffect(() => {
    if (expansionCommand) {
      setExpanded(expansionCommand.expanded);
    }
  }, [expansionCommand]);

  return (
    <article
      className={`event-block event-${event.type.replaceAll(".", "-")} importance-${event.importance} ${embedded ? "is-embedded" : ""}`}
    >
      {!(embedded && (event.type === "user.message" || event.type.startsWith("assistant."))) && (
        <button
          type="button"
          className="event-header"
          onClick={() => (collapsible ? setExpanded(!expanded) : onInspect(event))}
        >
          <span className="event-icon">
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className="event-title">{displayTitle(event, debugDetails)}</span>
          {debugDetails &&
            event.type !== "user.message" &&
            !event.type.startsWith("assistant.") && (
              <span className="event-source">{event.source}</span>
            )}
          {turnTiming && !embedded && (
            <span className="event-duration">
              {formatTurnDuration(turnTiming.durationMs)}
            </span>
          )}
          <time>{formatTime(event.ts)}</time>
          {collapsible &&
            (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
        </button>
      )}
      {expanded && (
        <div className="event-body" onClick={() => onInspect(event)}>
          {text && <p>{text}</p>}
          <MediaGallery media={content.media} />
          {!text && content.media.length === 0 && (
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          )}
        </div>
      )}
    </article>
  );
}

export function ToolBlock({
  events,
  onInspect,
  expansionCommand,
  debugDetails = false,
  embedded = false,
}: {
  events: MonitorEvent[];
  onInspect: (event: MonitorEvent) => void;
  expansionCommand: { expanded: boolean; id: number } | null;
  debugDetails?: boolean;
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const first = events[0];
  const last = events[events.length - 1];
  const name =
    events
      .map((event) => event.payload.name)
      .find((value): value is string => typeof value === "string") || "tool";
  const failed = events.some((event) => event.type === "tool.error");
  const done = events.some((event) => event.type === "tool.done");
  const state = failed ? "error" : done ? "done" : "running";
  const view = buildToolView(events);
  const media = uniqueMedia(events.flatMap((event) => messageContent(event).media));

  useEffect(() => {
    if (expansionCommand) {
      setExpanded(expansionCommand.expanded);
    }
  }, [expansionCommand]);

  return (
    <article
      className={`tool-block tool-${state} ${embedded ? "is-embedded" : ""}`}
    >
      <button
        className="tool-header"
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="event-icon">
          <Wrench size={16} aria-hidden="true" />
        </span>
        <span className="tool-title-stack">
          <strong>{view.title || name}</strong>
          {!expanded && view.subtitle && !failed && (
            <span className="tool-inline-summary">{view.subtitle}</span>
          )}
        </span>
        <span className="tool-header-meta">
          {view.durationLabel && (
            <span className="tool-inline-duration">{view.durationLabel}</span>
          )}
          {debugDetails && <code>{first.group_id}</code>}
          <span className={`tool-state state-${state}`}>
            {state === "done" ? (
              <CheckCircle2 size={13} />
            ) : state === "error" ? (
              <AlertCircle size={13} />
            ) : (
              <Radio size={13} />
            )}
            {state}
          </span>
        </span>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {expanded && (
        <div className="tool-panel">
          <div className="tool-summary">
            {view.subtitle && <p>{view.subtitle}</p>}
            <div className="tool-meta-row">
              {view.exitCodeLabel && <span>{view.exitCodeLabel}</span>}
              {view.previewTarget && <span>{view.previewTarget}</span>}
            </div>
          </div>
          {view.argsText && (
            <section className="tool-section">
              <span>Arguments</span>
              <pre>{view.argsText}</pre>
            </section>
          )}
          {view.streams.map((stream) => (
            <section
              className={`tool-section tool-stream-${stream.tone}`}
              key={stream.label}
            >
              <span>{stream.label}</span>
              <pre>{stream.text}</pre>
            </section>
          ))}
          {view.detail && (
            <section className="tool-section">
              <span>Result</span>
              <pre>{view.detail}</pre>
            </section>
          )}
          <MediaGallery media={media} />
          <div className="tool-events">
          {events.map((event) => {
            const summary = eventText(event);
            return (
              <button
                type="button"
                key={event.seq}
                className={event.type === "tool.error" ? "tool-event-error" : ""}
                onClick={() => onInspect(event)}
              >
                <span>{event.type.replace("tool.", "")}</span>
                <time>{formatTime(event.ts)}</time>
                <Code2 size={14} />
                {summary && <p>{summary}</p>}
              </button>
            );
          })}
          </div>
        </div>
      )}
    </article>
  );
}

export function EmptyTimeline() {
  return (
    <div className="empty-timeline">
      <MessageSquare size={24} />
      <strong>Select a session</strong>
      <span>Live events will appear here.</span>
    </div>
  );
}
