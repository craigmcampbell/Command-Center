# Command Center

Personal desktop dashboard — one place to reach services, notes, and tools.
Electron app, plain JS, no build step (intentional, for readability while learning Electron).

## Stack

- **Electron** (^33) — desktop shell. No framework, no bundler yet.
- **Plain JS** — main process (Node/CommonJS), preload bridge, vanilla-JS renderer.
- **Node 22 (LTS)** — pinned. See gotcha below.
- No database yet. Config lives in `config.json`; SQLite planned when persistence is needed.

## Requirements

- **Node 22 LTS.** Do NOT use Node 26+ — Electron's prebuilt binary download silently
  no-ops on too-new/non-LTS Node lines, producing a stub `node_modules/electron/dist/`
  with no `path.txt` and the runtime error "Electron failed to install correctly."
  If you hit that: check `node --version` first. `nvm use 22` and reinstall.

## Architecture

Three walled-off parts — this separation is the security model, keep it intact:

- **Main process** (`src/main/`) — Node.js, full OS access. Window creation + IPC handlers.
  - `index.js` — app entry, window setup, registers all `ipcMain.handle` channels.
  - `services/docker.js` — shells out to `docker ps`, parses JSON-lines output.
  - `services/grimoire.js` — reads Obsidian vault markdown directly from disk.
  - `services/launcher.js` — opens a terminal at a dir and runs a command (macOS AppleScript; Linux/Windows stubbed).
- **Preload** (`src/preload/index.js`) — the ONLY bridge. Exposes a small named API
  (`window.api.*`) via `contextBridge`. Renderer can't reach Node except through this.
- **Renderer** (`src/renderer/`) — sandboxed UI (html/css/vanilla JS). Talks to main
  only through `window.api`. No `fs`, no `exec`, no `require` here.

### Data flow

UI click → `window.api.x()` (preload) → `ipcRenderer.invoke("channel")` →
`ipcMain.handle("channel")` (main) → service does the work → result returns up the chain.

## Conventions

- **Config over code.** Anything user-specific (paths, ports, instances, projects) goes
  in `config.json`, never hardcoded. Widgets read config at boot.
- **Adding a widget** = four touch points, in order:
  1. Service function in `src/main/services/` (if it needs OS access).
  2. `ipcMain.handle("thing:action", ...)` in `src/main/index.js`.
  3. Expose it in `src/preload/index.js` under `window.api`.
  4. Render it in `src/renderer/renderer.js` + markup in `index.html`.
- **Fail soft.** Services return `{ ok: false, reason }` instead of throwing, so a widget
  shows a friendly message (e.g. "Docker isn't running") rather than blanking the app.
- **OS-specific code is branched on `process.platform`** (`darwin` / `win32` / else).
  `launcher.js` is macOS-first; the other branches are stubs to fill in.

## Current widgets

Docker status (auto-refresh) · today's Grimoire daily note · active missions ·
SillyTavern launcher · Claude Code launcher.

## Roadmap (rough effort order)

1. Google Calendar — today's events (Calendar MCP from main, or Google API + stored token).
2. Todoist — due/overdue tasks (Todoist MCP already in use).
3. GitHub — open PRs / CI status via GitHub API.
4. Persistence — `better-sqlite3` for caching + history (airfare, task completion).
5. Drag-to-rearrange grid — likely alongside a move to React + electron-vite.

## Run

```bash
npm install    # first time — Electron is a large download
npm start      # launch
npm run dev    # launch with detached devtools
```

## Notes

- Docker widget needs the Docker daemon running; degrades gracefully if not.
- Terminal launching is macOS-first (AppleScript / Terminal.app). Swap for iTerm/Warp
  or fill in Linux/Windows branches in `services/launcher.js` as needed.
- Paths in `config.json` are placeholders — point them at real locations before running.