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
- **better-sqlite3** — persists the Local Apps / Learning / Claude Code lists (display
  order + CRUD). Everything else still lives in `config.json`.

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
  - `services/googleCalendar.ts` — Google Calendar API v3 via OAuth (loopback + PKCE,
    no dependency beyond `node:http`/`node:crypto`). Tokens cache to
    `app.getPath("userData")/google-tokens.json` — never in git, never in `config.json`.
  - `services/links.ts` — SQLite (`better-sqlite3`) CRUD + reorder for the Local Apps /
    Learning / Claude Code lists, one table per list. DB lives at
    `app.getPath("userData")/command-center.db`; one-time migration seeds it from
    `config.json`'s old `localApps`/`learning`/`claudeCode` arrays if a table is empty.
  - `services/reader.ts` — Readwise Reader API v3 for the latest saved documents.
    Cursor-paginated upstream, so this keeps a small in-memory cache and does the
    sort-by-saved-date + 15-per-page slicing itself.
  - `services/github.ts` — GitHub REST API for latest Actions run + open PR count
    per configured repo, plus a cross-repo review-requested search. Personal
    access token lives in `config.json`'s `github.token`.
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

## Tabs

The dashboard is split into tabs (`App.tsx`'s `activeTab` state, `TABS` array) so
lesser-used widgets don't crowd the main view. All widget data still loads and
polls in the background regardless of which tab is active — only the JSX rendered
under `<main>` is tab-gated, state lives in `App.tsx` same as always.

- **Home** — Due & Overdue, Today's Log, Today's Schedule (Google Calendar), Active
  Missions, Local Apps, Learning.
- **Development** — Services (Docker), Claude Code, GitHub (CI status + PRs).
- **Reader** — latest Readwise Reader documents, paginated.

Add a new tab by adding an entry to `TABS`, a new `.grid-<name>` CSS block
(grid-template-columns/areas), and a new `{activeTab === "..." && <main>...}` block.

## Current widgets

Docker status (auto-refresh) · today's Grimoire daily note (prev/next navigation
between existing notes, deep link to open in Obsidian) · Google Calendar schedule
(prev/next day pagination, join-meeting link, expandable notes) · active missions ·
Todoist due/overdue tasks (grouped by project, with tags/subtasks) · Local Apps
launcher (SillyTavern, Open WebUI, OpenCode, etc.) · Learning launcher (courses/docs
links) · Claude Code launcher (opens in Warp) · Reader (latest Readwise Reader
documents, paginated 15 at a time) · GitHub (per-repo latest CI run + open PR
count, cross-repo review-requested PRs, auto-refresh on `github.refreshSeconds`).

Local Apps and Learning both render via the generic `LinkLauncherWidget`
(`components/LinkLauncherWidget.tsx`) — a SQLite-backed `LinkItem[]` list
(`{ id, label, link, sortOrder }`, see `services/links.ts`) with drag-to-reorder
(`@dnd-kit`), inline add/edit/delete, and click-to-open. `ClaudeLauncherWidget`
is the same idea rendered as a horizontal chip row, launching a terminal instead
of opening a URL. Both talk to `window.api.links.*` via the shared
`useLinkList` hook (`renderer/src/hooks/useLinkList.ts`).

## Command Palette

`⌘K`/`Ctrl+K` opens a global fuzzy-filter launcher over tabs, Claude Code
projects, Local Apps/Learning links, Docker start/stop, and a couple of quick
actions ("Refresh all", "New scratchpad note"). It's app-wide navigation, not
a per-tab widget, so it skips the five-touch-point pattern above:
`src/renderer/src/palette.ts` holds the action registry (`buildActions()`
rebuilds the list fresh every time the palette opens, from whatever state
`App.tsx` already has — no new IPC), and
`components/CommandPalette.tsx` is the overlay itself. The global keydown
listener lives in `App.tsx`; it's renderer-only (no Electron `globalShortcut`),
so it only fires while a Command Center window is focused.

## Roadmap (rough effort order)

1. Drag-to-rearrange grid — now that the renderer is React, `react-grid-layout` or similar.

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
- **Reader widget** needs a Readwise access token (`https://readwise.io/access_token`)
  in `config.json`'s `reader.apiToken` — without one it fails soft with "No Readwise
  API token configured".
- **Google Calendar setup**: create a Google Cloud project, enable the Calendar API,
  set the OAuth consent screen to External with yourself as a test user (skips Google's
  app-verification process entirely), then create an OAuth client of type **Desktop app**
  under Credentials. Paste the Client ID/Secret into `config.json`'s `googleCalendar`
  section, then click "Connect Google Calendar" in the widget — it opens your browser
  for one-time consent and caches tokens after that.
- **GitHub widget setup**: put a personal access token (repo + read:org scope) in
  `config.json`'s `github.token`, list repos to track under `github.repos`
  (`{ label, owner, repo, branch }` each), and set `github.reviewUser` to your GitHub
  username for the "Needs your review" section. Without a token the widget fails soft
  with "No GitHub token configured".
- **Packaged app is unsigned** (no Apple Developer cert configured). First launch will
  be blocked by Gatekeeper as "unidentified developer" — right-click the app → Open once
  to bypass, or `xattr -cr "Command Center.app"`. The packaged app's config lives at
  `~/Library/Application Support/Command Center/config.json`, seeded from
  `config.example.json` on first launch — edit that copy, not the repo's.
