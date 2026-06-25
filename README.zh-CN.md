# Hermes Lens

Hermes Lens 是一个只读的 Hermes session 实时观测 WebUI。

它通过标准 JSONL event stream 观察 Hermes / planner / tool 的运行过程，不提交
prompt，不调用工具，不控制 agent，也不进入最终响应链路。

[English README](README.md)

![Hermes Lens demo](assets/demo.gif)

## 功能

- 从 JSONL 事件流主动发现 live session。
- Activity 聊天式视图，展示 user、assistant、thinking、tool、error、media。
- Debug / Tools / Errors 多视图。
- reasoning、tool detail、raw event 默认折叠。
- 通过 allowlist 保护的 `/api/media` 预览图片。
- 四套主题：Hermes Dark、Hermes Light、VS Code Dark、VS Code Light。
- 旁路只读架构，不控制 Hermes，不调用 `prompt.submit`。

## 快速开始

手动安装依赖：

```bash
git clone https://github.com/your-org/hermes-lens.git
cd hermes-lens

python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt

cd frontend
npm install
npm run build
cd ..
```

启动：

```bash
./scripts/dev.sh
```

默认地址：

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:8000`
- Events: `~/.hermes/live-events`

`scripts/dev.sh` 不会安装依赖，也不会创建运行目录。环境缺失时会直接报错并给出修复提示。

远程访问可以使用 SSH 端口转发，也可以绑定到 `0.0.0.0`：

```bash
HERMES_MONITOR_FRONTEND_HOST=0.0.0.0 \
HERMES_MONITOR_BACKEND_HOST=0.0.0.0 \
./scripts/dev.sh
```

默认启动使用已构建的前端，不启用文件 watcher。开发热更新模式：

```bash
HERMES_MONITOR_DEV_WATCH=1 ./scripts/dev.sh
```

## Hermes Exporter

Exporter 源码在 `integrations/hermes_live_monitor`。安装为 Hermes 用户插件：

```bash
mkdir -p ~/.hermes/plugins/live-monitor-exporter
cp integrations/hermes_live_monitor/__init__.py \
  integrations/hermes_live_monitor/plugin.yaml \
  ~/.hermes/plugins/live-monitor-exporter/
hermes plugins enable live-monitor-exporter
```

如果 Hermes 使用 profile，例如 `planner`，需要安装到该 profile 的 `HERMES_HOME`：

```bash
export HERMES_HOME=~/.hermes/profiles/planner
mkdir -p "$HERMES_HOME/plugins/live-monitor-exporter"
cp integrations/hermes_live_monitor/__init__.py \
  integrations/hermes_live_monitor/plugin.yaml \
  "$HERMES_HOME/plugins/live-monitor-exporter/"
hermes plugins enable live-monitor-exporter
```

安装或更新插件后需要重启 Hermes。新事件会写入：

```text
~/.hermes/live-events/<session_id>.jsonl
```

图片输入会落盘到 `~/.hermes/live-media` 并在事件里保存引用。已经被截断写入 JSONL 的旧 base64 图片无法恢复。

## 架构

```text
Hermes / planner / tools
  -> non-blocking exporter
  -> JSONL event stream
  -> FastAPI backend
  -> SSE + REST API
  -> React WebUI
```

事件流是唯一集成边界。Hermes Lens 是 viewer，不是 gateway，也不是 controller。

## 非目标

- 不替代 Hermes。
- 不作为 prompt gateway。
- 不控制工具或机器人。
- 不进入最终响应链路。
- 不暴露任意文件读取。

## 安全模型

- event payload 视为不可信输入。
- 前端只渲染文本和 JSON，不渲染 payload 中的 HTML。
- `/api/media` 只允许读取配置 allowlist 下的媒体文件。
- 图片存引用，不把 base64 大块塞进事件流。
- exporter 失败不能阻塞 Hermes / planner 主流程。

## 开发检查

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest backend/tests

cd frontend
npm run typecheck
npm test
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
