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
| **Today's Schedule** | Google Calendar events for the day, with prev/next pagination | `services/googleCalendar.ts` |
| **Local Apps** | One-click open of each configured local app/instance (SillyTavern, Open WebUI, OpenCode, etc.) | config-driven |
| **Learning** | One-click open of each configured course/docs link | config-driven |
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
npm run package   # build a real macOS .app → dist/mac-arm64/Command Center.app
npm run typecheck # type-check everything without emitting
```

### Running it without a terminal

`npm run package` builds an actual `Command Center.app` you can drag into
`/Applications` and launch from Spotlight, Dock, or Finder — no terminal window
tied to it. Two things to know:

- It's unsigned (no Apple Developer cert), so Gatekeeper blocks the first launch
  as "unidentified developer." Right-click the app → **Open** once to bypass it,
  or run `xattr -cr "Command Center.app"`.
- The packaged app can't read `config.json` out of its own (immutable) bundle, so
  it keeps its own copy at `~/Library/Application Support/Command Center/config.json`,
  seeded from `config.example.json` on first launch. Edit that copy — not the one
  in the repo — to configure a packaged build.

### Configure it

Copy `config.example.json` to `config.json` (gitignored, since it can hold real API
tokens) and fill in your own paths/tokens — no code editing needed:

- `grimoire.vaultPath` — absolute path to your Grimoire vault
- `localApps.instances` — label + URL for each local app/instance
- `learning.instances` — label + URL for each course/docs link
- `claudeCode.projects` — label + path for each project you launch Claude in
- `todoist.apiToken` — a Todoist personal API token (Settings → Integrations → Developer)
- `googleCalendar.clientId` / `clientSecret` — from a Google Cloud OAuth "Desktop app"
  client (Calendar API enabled, OAuth consent screen set to External with yourself as
  a test user). Then click "Connect Google Calendar" in the app for one-time browser
  consent — tokens cache after that, never in `config.json` or git.

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

1. **GitHub** — open PRs / CI status via the GitHub API.
2. **Persistence** — add SQLite (e.g. `better-sqlite3`) when you want to cache
   data or track history (airfare, task completion). Not needed yet.
3. **Drag-to-rearrange** — swap the CSS grid for `react-grid-layout` now that
   the renderer is React.
