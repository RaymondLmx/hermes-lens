import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "HERMES_MONITOR_");
  const backendHost =
    env.HERMES_MONITOR_BACKEND_HOST === "0.0.0.0"
      ? "127.0.0.1"
      : (env.HERMES_MONITOR_BACKEND_HOST ?? "127.0.0.1");
  const backendPort = env.HERMES_MONITOR_BACKEND_PORT ?? "8000";
  const backendTarget = `http://${backendHost}:${backendPort}`;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": backendTarget,
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": backendTarget,
      },
    },
  };
});
