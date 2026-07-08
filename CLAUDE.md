# Command Center

Personal desktop dashboard — one place to reach services, notes, and tools.
Electron app, React + TypeScript, built with electron-vite.

## Stack

- **Electron** (^33) — desktop shell.
- **electron-vite** + **Vite** — build tooling for main/preload/renderer.
- **React 19 + TypeScript** — renderer UI; main/preload are TS too.
- **Node 22 (LTS)** — pinned. See gotcha below.
- **electron-builder** — packages the app into a real macOS `.app` (`npm run package`),
  so it can run without a terminal attached at all.
- No database yet. Config lives in `config.json`; SQLite planned when persistence is needed.

## Requirements

- **Node 22 LTS.** Do NOT use Node 26+ — Electron's prebuilt binary download silently
  no-ops on too-new/non-LTS Node lines, producing a stub `node_modules/electron/dist/`
  with no `path.txt` and the runtime error "Electron failed to install correctly."
  If you hit that: check `node --version` first. `nvm use 22` and reinstall.

## Architecture

Three walled-off parts — this separation is the security model, keep it intact:

- **Main process** (`src/main/`) — Node.js, full OS access. Window creation + IPC handlers.
  - `index.ts` — app entry, window setup, registers all `ipcMain.handle` channels.
    Branches on `process.env.ELECTRON_RENDERER_URL`: dev mode loads the Vite dev
    server URL, production loads the built `out/renderer/index.html`.
  - `services/docker.ts` — shells out to `docker ps`, parses JSON-lines output.
  - `services/grimoire.ts` — reads Obsidian vault markdown directly from disk.
  - `services/todoist.ts` — calls the Todoist REST API for due/overdue tasks.
  - `services/launcher.ts` — opens a terminal at a dir and runs a command (macOS:
    writes a Warp Tab Config and opens it via `warp://tab_config/...`; Linux/Windows stubbed).
- **Preload** (`src/preload/index.ts`) — the ONLY bridge. Exposes a small named API
  (`window.api.*`) via `contextBridge`, typed as `CommandCenterApi`. Renderer can't
  reach Node except through this. `index.d.ts` augments `Window` so every component
  gets `window.api` typing for free.
- **Renderer** (`src/renderer/src/`) — sandboxed React UI. Talks to main only through
  `window.api`. No `fs`, no `exec`, no `require` here.
- **Shared** (`src/shared/types.ts`) — the typed contract (`AppConfig`, each service's
  result shape, `CommandCenterApi`) used by main, preload, and renderer alike.

### Data flow

UI event → `window.api.x()` (preload, typed) → `ipcRenderer.invoke("channel")` →
`ipcMain.handle("channel")` (main) → service does the work → result returns up the chain.

## Conventions

- **Config over code.** Anything user-specific (paths, ports, instances, projects) goes
  in `config.json` (gitignored — copy `config.example.json` to get started), never
  hardcoded. Widgets read config at boot. Where `config.json` actually lives depends on
  `app.isPackaged` (see `loadConfig()` in `main/index.ts`): dev reads it straight from
  the repo root; a packaged app's bundle is immutable, so it instead keeps a user-editable
  copy in `app.getPath("userData")`, seeded on first launch from the bundled
  `config.example.json`.
- **Adding a widget** = five touch points, in order:
  1. Shared types in `src/shared/types.ts`, if the data shape is new.
  2. Service function in `src/main/services/*.ts` (if it needs OS access).
  3. `ipcMain.handle("thing:action", ...)` in `src/main/index.ts`.
  4. Expose it in `src/preload/index.ts` under `window.api` (+ add to `CommandCenterApi`).
  5. Component in `src/renderer/src/components/*.tsx`, wired into `App.tsx`'s state.
- **Fail soft.** Services return `{ ok: false, reason }` instead of throwing, so a widget
  shows a friendly message (e.g. "Docker isn't running") rather than blanking the app.
  This is enforced by the shared TS result types, not just convention.
- **OS-specific code is branched on `process.platform`** (`darwin` / `win32` / else).
  `launcher.ts` is macOS-first (Warp); the other branches are stubs to fill in.
- **State lives in `App.tsx`.** Widgets are presentational components that take their
  data slice as props; no state-management library, mirrors the old `boot()`/`load*()`
  orchestration directly.

## Current widgets

Docker status (auto-refresh) · today's Grimoire daily note · active missions ·
Todoist due/overdue tasks · Local Apps launcher (SillyTavern, Open WebUI, OpenCode, etc.) ·
Learning launcher (courses/docs links) · Claude Code launcher (opens in Warp).

Local Apps and Learning both render via the generic `LinkLauncherWidget`
(`components/LinkLauncherWidget.tsx`) — a `{ label, url }[]` list that opens a URL on
click. Add a new quick-launch panel by adding a config section shaped like
`{ instances: LinkInstance[] }` and one more `<LinkLauncherWidget title=... instances=.../>`
in `App.tsx`, no new component needed.

## Roadmap (rough effort order)

1. Google Calendar — today's events (Calendar MCP from main, or Google API + stored token).
2. GitHub — open PRs / CI status via GitHub API.
3. Persistence — `better-sqlite3` for caching + history (airfare, task completion).
4. Drag-to-rearrange grid — now that the renderer is React, `react-grid-layout` or similar.

## Run

```bash
npm install          # first time — pulls in Electron + the Vite toolchain
npm start            # launch (electron-vite dev)
npm run dev          # launch with detached devtools
npm run build         # production bundle → out/
npm run preview       # run the production bundle
npm run package       # build a real macOS .app → dist/mac-arm64/Command Center.app
npm run typecheck     # tsc --noEmit across main+preload and renderer configs
```

## Notes

- Docker widget needs the Docker daemon running; degrades gracefully if not.
- Terminal launching targets Warp via a generated Tab Config (`~/.warp/tab_configs/`).
  Swap `services/launcher.ts` for your terminal of choice, or fill in Linux/Windows
  branches, as needed.
- `config.json` is gitignored (it can hold real API tokens); `config.example.json` is
  the committed placeholder template — copy it and fill in real paths/tokens.
- **Packaged app is unsigned** (no Apple Developer cert configured). First launch will
  be blocked by Gatekeeper as "unidentified developer" — right-click the app → Open once
  to bypass, or `xattr -cr "Command Center.app"`. The packaged app's config lives at
  `~/Library/Application Support/Command Center/config.json`, seeded from
  `config.example.json` on first launch — edit that copy, not the repo's.
