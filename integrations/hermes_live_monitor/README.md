# Hermes Lens Exporter

User plugin that exports Hermes lifecycle hooks to local JSONL files without
calling or depending on the Hermes Lens WebUI.

## Install

```bash
mkdir -p ~/.hermes/plugins/live-monitor-exporter
cp integrations/hermes_live_monitor/__init__.py \
  integrations/hermes_live_monitor/plugin.yaml \
  ~/.hermes/plugins/live-monitor-exporter/
hermes plugins enable live-monitor-exporter
```

Hermes profiles are isolated. If Hermes is running with `--profile planner` or
`HERMES_HOME=~/.hermes/profiles/planner`, install and enable the plugin in that
profile instead:

```bash
export HERMES_HOME=~/.hermes/profiles/planner
mkdir -p "$HERMES_HOME/plugins/live-monitor-exporter"
cp integrations/hermes_live_monitor/__init__.py \
  integrations/hermes_live_monitor/plugin.yaml \
  "$HERMES_HOME/plugins/live-monitor-exporter/"
hermes plugins enable live-monitor-exporter
```

Restart active Hermes CLI or gateway processes after installation.

## Configuration

Optional environment variables:

```text
HERMES_MONITOR_EVENTS_DIR         default: ~/.hermes/live-events
HERMES_MONITOR_MEDIA_DIR          default: ~/.hermes/live-media
HERMES_MONITOR_MAX_MEDIA_BYTES    per-image limit, default: 10485760
HERMES_MONITOR_QUEUE_SIZE         default: 2048
HERMES_MONITOR_HEARTBEAT_SECONDS  default: 5
HERMES_MONITOR_CAPTURE_CONTENT    none | preview | full, default: preview
HERMES_MONITOR_MAX_CHARS          preview limit, default: 2000
HERMES_MONITOR_AGENT_ID           explicit stable agent identity
HERMES_MONITOR_AGENT_NAME         explicit display name
HERMES_MONITOR_PROFILE            explicit profile
HERMES_MONITOR_BOOTSTRAP_STATE_DB read current profile state.db on startup, default: 1
HERMES_MONITOR_BOOTSTRAP_WINDOW_SECONDS active-session bootstrap window, default: 3600
HERMES_MONITOR_BOOTSTRAP_LIMIT    max bootstrapped sessions, default: 10
```

`preview` truncates captured text and recursively redacts dictionary fields
whose names resemble tokens, passwords, cookies, authorization, API keys, or
secrets. Use `none` when message content must not be persisted.

The state DB bootstrap is read-only and only emits monitor events for recently
active sessions in the current profile. It does not submit prompts or call
Hermes control endpoints.
