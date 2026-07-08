# Command Center

A personal desktop dashboard — one place to reach your services, notes, and tools.
Built with Electron. This is a starter scaffold with five working widgets and
room to grow.

## What's here

| Widget | What it does | Source |
|---|---|---|
| **Services** | Live Docker container status, auto-refreshing | `services/docker.js` |
| **Today's Log** | Renders today's Obsidian daily note | `services/grimoire.js` |
| **Active Missions** | Lists notes in your `3 Missions/` folder, newest first | `services/grimoire.js` |
| **SillyTavern** | One-click open of each configured instance | config-driven |
| **Claude Code** | Opens a terminal in a project dir and runs `claude` | `services/launcher.js` |

## First-time setup

You've never used Electron, so here's the one-paragraph orientation: an Electron
app is basically Chrome + Node.js in one window. There are **three** parts, and
they're deliberately walled off from each other:

- **Main process** (`src/main/`) — Node.js. Full OS access. Creates the window,
  reads files, runs `docker`, launches terminals.
- **Renderer** (`src/renderer/`) — the UI. It's a web page, sandboxed. It can't
  touch your disk directly; it has to *ask* the main process.
- **Preload** (`src/preload/`) — the guarded doorway between them. It exposes a
  short list of named functions (`window.api.docker.list()`, etc.) and nothing
  more. This is what keeps a dashboard from becoming a security hole.

### Run it

```bash
npm install     # pulls in Electron (~is a big download the first time)
npm start       # launches the app
npm run dev     # same, but opens devtools for debugging
```

### Configure it

Everything user-specific lives in **`config.json`** — no code editing needed:

- `grimoire.vaultPath` — absolute path to your Grimoire vault
- `sillytavern.instances` — label + URL for each instance
- `claudeCode.projects` — label + path for each project you launch Claude in

The paths in there now are placeholders (`/Users/craig/...`). Point them at your
real locations before first run.

## Notes & gotchas

- **Terminal launching is macOS-first.** `services/launcher.js` uses AppleScript
  to drive Terminal.app. If you use iTerm/Warp, or you're on Linux/Windows,
  tweak that file — the branches are already stubbed.
- **Docker widget** shells out to the `docker` CLI, so Docker Desktop (or the
  daemon) needs to be running. If it isn't, the widget says so instead of erroring.
- **No build step.** This is plain JS on purpose, so you can read every moving
  part. When you outgrow it, Vite + a framework (or electron-vite) is the natural
  next step.

## Where to go next

Good candidates to add, in rough order of effort:

1. **Google Calendar** — today's events. Cleanest via the Calendar MCP server
   from the main process, or the Google Calendar API with a stored OAuth token.
2. **Todoist** — due/overdue tasks. You already run the Todoist MCP; the main
   process can call it and feed a widget.
3. **GitHub** — open PRs / CI status via the GitHub API.
4. **Persistence** — add SQLite (e.g. `better-sqlite3`) when you want to cache
   data or track history (airfare, task completion). Not needed yet.
5. **Drag-to-rearrange** — swap the CSS grid for `react-grid-layout` once you
   move to React.
