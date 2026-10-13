import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

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
    plugins: [react()],
  },
});
