import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        // Two windows, two entries: the dashboard and the frameless
        // quick-capture panel. Named inputs (rather than a bare string) so
        // each emits its own html next to the other in out/renderer.
        input: {
          index: "src/renderer/index.html",
          capture: "src/renderer/capture.html",
        },
      },
    },
    plugins: [react()],
  },
});
