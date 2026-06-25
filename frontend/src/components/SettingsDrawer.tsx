import { Bug, HeartPulse, LayoutList, Palette, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { IconButton } from "./IconButton";

export interface MonitorSettings {
  compactActivity: boolean;
  restoreAutoScrollOnSessionSwitch: boolean;
  showHeartbeatsInDebug: boolean;
  showLifecycleEventsInDebug: boolean;
  theme: ThemeKey;
}

export type ThemeKey =
  | "hermes-dark"
  | "hermes-light"
  | "vscode-dark"
  | "vscode-light";

const THEMES: Array<{
  accent: string;
  background: string;
  key: ThemeKey;
  label: string;
  text: string;
}> = [
  {
    accent: "#f6c453",
    background: "#003a35",
    key: "hermes-dark",
    label: "Hermes Dark",
    text: "#f3ead8",
  },
  {
    accent: "#b98500",
    background: "#f4efe2",
    key: "hermes-light",
    label: "Hermes Light",
    text: "#163630",
  },
  {
    accent: "#007acc",
    background: "#1e1e1e",
    key: "vscode-dark",
    label: "VS Code Dark",
    text: "#d4d4d4",
  },
  {
    accent: "#007acc",
    background: "#ffffff",
    key: "vscode-light",
    label: "VS Code Light",
    text: "#1f1f1f",
  },
];

export function SettingsDrawer({
  settings,
  onChange,
  onClose,
}: {
  settings: MonitorSettings;
  onChange: (settings: MonitorSettings) => void;
  onClose: () => void;
}) {
  return (
    <aside className="detail-drawer settings-drawer">
      <header>
        <div>
          <span>Settings</span>
          <strong>Monitor display</strong>
        </div>
        <div className="drawer-actions">
          <IconButton label="Close settings" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </header>
      <div className="settings-section">
        <section className="settings-group">
          <div className="settings-group-heading">
            <Palette size={16} />
            <span>Theme</span>
          </div>
          <div className="theme-grid">
            {THEMES.map((theme) => (
              <label
                className={`theme-option ${
                  settings.theme === theme.key ? "is-selected" : ""
                }`}
                key={theme.key}
              >
                <input
                  type="radio"
                  name="monitor-theme"
                  value={theme.key}
                  checked={settings.theme === theme.key}
                  onChange={() => onChange({ ...settings, theme: theme.key })}
                />
                <span
                  className="theme-swatch"
                  style={{
                    "--theme-accent": theme.accent,
                    "--theme-bg": theme.background,
                    "--theme-text": theme.text,
                  } as CSSProperties}
                >
                  <i />
                  <b />
                </span>
                <span>{theme.label}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="settings-group">
          <div className="settings-group-heading">
            <LayoutList size={16} />
            <span>Timeline</span>
          </div>
          <SettingsToggle
            checked={settings.compactActivity}
            icon={<LayoutList size={17} />}
            title="Compact Activity layout"
            description="Use tighter spacing and slightly narrower chat bubbles."
            onChange={(value) => onChange({ ...settings, compactActivity: value })}
          />
          <SettingsToggle
            checked={settings.restoreAutoScrollOnSessionSwitch}
            icon={<HeartPulse size={17} />}
            title="Resume auto-scroll on session switch"
            description="Jump to the newest event when opening another session."
            onChange={(value) =>
              onChange({
                ...settings,
                restoreAutoScrollOnSessionSwitch: value,
              })
            }
          />
        </section>
        <section className="settings-group">
          <div className="settings-group-heading">
            <Bug size={16} />
            <span>Debug</span>
          </div>
          <SettingsToggle
            checked={settings.showHeartbeatsInDebug}
            icon={<HeartPulse size={17} />}
            title="Show heartbeat events in Debug"
            description="Include session.heartbeat rows in the raw debug timeline."
            onChange={(value) =>
              onChange({ ...settings, showHeartbeatsInDebug: value })
            }
          />
          <SettingsToggle
            checked={settings.showLifecycleEventsInDebug}
            icon={<Bug size={17} />}
            title="Show lifecycle events in Debug"
            description="Include session.start, turn.start, status.update, and done rows."
            onChange={(value) =>
              onChange({ ...settings, showLifecycleEventsInDebug: value })
            }
          />
        </section>
      </div>
    </aside>
  );
}

function SettingsToggle({
  checked,
  description,
  icon,
  onChange,
  title,
}: {
  checked: boolean;
  description: string;
  icon: ReactNode;
  onChange: (value: boolean) => void;
  title: string;
}) {
  return (
    <label className="settings-toggle">
      <span className="settings-toggle-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
