import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// The CSP meta tags in the html entries are written for the build. The dev
// server needs two holes in them: React Refresh's preamble is an inline script,
// and HMR talks over a websocket. Dev only (`apply: "serve"`), so a build ships
// the tags exactly as written.
function devCsp(): Plugin {
  return {
    name: "dev-csp",
    apply: "serve",
    transformIndexHtml: (html) =>
      html.replace(/(http-equiv="Content-Security-Policy"\s+content=")([^"]*)/, (_, head: string, policy: string) =>
        head +
        policy
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace(/connect-src [^;]*/, "connect-src 'self' ws://localhost:*")
      ),
  };
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: "src/main/index.ts", "usage-worker": "src/main/usage-worker.ts" } } },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        // Three windows, three entries: the dashboard and the two frameless
        // panels (quick capture, quick assistant). Named inputs (rather than a bare string) so
        // each emits its own html next to the other in out/renderer.
        input: {
          index: "src/renderer/index.html",
          capture: "src/renderer/capture.html",
          assistantQuick: "src/renderer/assistant-quick.html",
        },
      },
    },
    plugins: [react(), devCsp()],
  },
});
