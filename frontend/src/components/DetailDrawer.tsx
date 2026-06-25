import { Copy, X } from "lucide-react";

import type { MonitorEvent } from "../types";
import { IconButton } from "./IconButton";

export function DetailDrawer({
  event,
  onClose,
}: {
  event: MonitorEvent | null;
  onClose: () => void;
}) {
  if (!event) return null;

  const copy = () => {
    void navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  };

  return (
    <aside className="detail-drawer">
      <header>
        <div>
          <span>Event detail</span>
          <strong>{event.type}</strong>
        </div>
        <div className="drawer-actions">
          <IconButton label="Copy raw event" onClick={copy}>
            <Copy size={17} />
          </IconButton>
          <IconButton label="Close event detail" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </header>
      <dl className="event-metadata">
        <div>
          <dt>Sequence</dt>
          <dd>{event.seq}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{event.source}</dd>
        </div>
        <div>
          <dt>Turn</dt>
          <dd>{event.turn_id || "none"}</dd>
        </div>
        <div>
          <dt>Group</dt>
          <dd>{event.group_id || "none"}</dd>
        </div>
      </dl>
      <div className="raw-section">
        <span>Raw JSON</span>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </div>
    </aside>
  );
}

