# Command Center

A personal desktop dashboard — one place to reach your services, notes, and tools.
Built with Electron, React, and TypeScript, using electron-vite for the build.

## What's here

| Widget | What it does | Source |
|---|---|---|
| **Services** | Live Docker container status, auto-refreshing | `services/docker.ts` |
| **Today's Log** | Renders today's Obsidian daily note | `services/grimoire.ts` |
| **Active Missions** | Lists notes in your `3 Missions/` folder, newest first | `services/grimoire.ts` |
| **Due & Overdue** | Todoist tasks due today or overdue | `services/todoist.ts` |
| **SillyTavern** | One-click open of each configured instance | config-driven |
| **Claude Code** | Opens a Warp tab in a project dir and runs `claude` | `services/launcher.ts` |

## First-time setup

An Electron app is basically Chrome + Node.js in one window. There are **three**
parts, and they're deliberately walled off from each other:

- **Main process** (`src/main/`) — Node.js. Full OS access. Creates the window,
  reads files, runs `docker`, launches terminals.
- **Renderer** (`src/renderer/src/`) — the UI, written in React. It's a web page,
  sandboxed. It can't touch your disk directly; it has to *ask* the main process.
- **Preload** (`src/preload/`) — the guarded doorway between them. It exposes a
  short, typed list of named functions (`window.api.docker.list()`, etc.) and
  nothing more. This is what keeps a dashboard from becoming a security hole.

### Run it

```bash
npm install       # pulls in Electron + the Vite toolchain (~a big download first time)
npm start         # launches the app (electron-vite dev)
npm run dev       # same, but opens devtools for debugging
npm run build     # production bundle → out/
npm run preview   # run the production bundle
npm run typecheck # type-check everything without emitting
```

### Configure it

Copy `config.example.json` to `config.json` (gitignored, since it can hold real API
tokens) and fill in your own paths/tokens — no code editing needed:

- `grimoire.vaultPath` — absolute path to your Grimoire vault
- `sillytavern.instances` — label + URL for each instance
- `claudeCode.projects` — label + path for each project you launch Claude in
- `todoist.apiToken` — a Todoist personal API token (Settings → Integrations → Developer)

## Notes & gotchas

- **Terminal launching targets Warp.** `services/launcher.ts` writes a Warp Tab
  Config and opens it via `warp://tab_config/...`. If you use a different terminal,
  swap that file — the win32/linux branches are already stubbed.
- **Docker widget** shells out to the `docker` CLI, so Docker Desktop (or the
  daemon) needs to be running. If it isn't, the widget says so instead of erroring.
- **TypeScript throughout.** `src/shared/types.ts` is the contract shared by main,
  preload, and renderer — `window.api` is fully typed via `src/preload/index.d.ts`.

## Where to go next

Good candidates to add, in rough order of effort:

1. **Google Calendar** — today's events. Cleanest via the Calendar MCP server
   from the main process, or the Google Calendar API with a stored OAuth token.
2. **GitHub** — open PRs / CI status via the GitHub API.
3. **Persistence** — add SQLite (e.g. `better-sqlite3`) when you want to cache
   data or track history (airfare, task completion). Not needed yet.
4. **Drag-to-rearrange** — swap the CSS grid for `react-grid-layout` now that
   the renderer is React.
