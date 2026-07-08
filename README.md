# Command Center

A personal desktop dashboard — one place to reach your services, notes, and tools.

Built with Electron, React, and TypeScript (electron-vite). macOS-first today: terminal launching targets Warp, and `npm run package` produces a `.app` bundle.

## Features

The UI is split into tabs. Widget data loads and refreshes in the background regardless of which tab is active.

### Home

| Widget | What it does |
|---|---|
| **Today's Schedule** | Google Calendar events for the day (prev/next day, join links, expandable notes) |
| **Due & Overdue** | Todoist tasks due today or overdue (grouped by project, tags, subtasks) |
| **Today's Log** | Renders today's Obsidian daily note (prev/next navigation, open in Obsidian) |
| **Active Missions** | Lists notes in your missions folder, newest first |
| **Local Apps** | One-click open of local app URLs (drag-to-reorder, add/edit/delete) |
| **Learning** | Same launcher UI for course/docs links |

### Development

| Widget | What it does |
|---|---|
| **Services** | Live Docker container status with start/stop controls |
| **Claude Code** | Opens a Warp tab in a project directory and runs `claude` |

### Reader

| Widget | What it does |
|---|---|
| **Reader** | Latest Readwise Reader documents, paginated (archive/delete) |

### Scratchpad

| Widget | What it does |
|---|---|
| **Scratchpad** | Autosaved markdown scratch notes (write / split / preview modes, clear button) |

Click **Refresh** in the header to reload all remote widgets. The app also auto-refreshes on a configurable interval (default: every 10 minutes). Docker polls separately on its own interval (default: every 15 seconds).

## Requirements

- **Node.js 22 LTS** — Electron's prebuilt binary can silently fail on newer/non-LTS Node versions. If you see "Electron failed to install correctly," run `node --version`, switch to Node 22 (`nvm use 22`), and reinstall dependencies.
- **macOS** — primary target. Linux/Windows branches exist for some features but are stubs.
- **Docker** (optional) — for the Services widget. Degrades gracefully if the daemon isn't running.
- **Warp** (optional) — for Claude Code terminal launching. Swap `src/main/services/launcher.ts` for your terminal of choice.
- **Obsidian vault** (optional) — for daily log and missions widgets.
- **API tokens** (optional) — Todoist, Google Calendar OAuth, Readwise Reader.

## Quick start

```bash
git clone <repo-url>
cd command-center
npm install
cp config.example.json config.json   # then edit with your paths/tokens
npm start                            # launch dev build
```

Other scripts:

```bash
npm run dev        # launch with devtools
npm run build      # production bundle → out/
npm run preview    # run the production bundle
npm run package    # build macOS .app → dist/mac-arm64/Command Center.app
npm run typecheck  # type-check without emitting
```

## Configuration

`config.json` is gitignored (it holds real API tokens). Copy `config.example.json` to get started.

| Key | Purpose |
|---|---|
| `grimoire.vaultPath` | Absolute path to your Obsidian vault |
| `grimoire.dailyLogDir` | Relative path inside the vault for daily notes |
| `grimoire.missionsDir` | Relative path inside the vault for mission notes |
| `docker.refreshSeconds` | How often the Services widget polls Docker (default: `15`) |
| `app.refreshMinutes` | How often to auto-refresh all widgets (default: `10`; set `0` to disable) |
| `todoist.apiToken` | Todoist personal API token |
| `googleCalendar.clientId` / `clientSecret` | Google Cloud OAuth Desktop app credentials |
| `reader.apiToken` | Readwise access token from [readwise.io/access_token](https://readwise.io/access_token) |

### Google Calendar setup

1. Create a Google Cloud project and enable the Calendar API.
2. Set the OAuth consent screen to **External** and add yourself as a test user.
3. Create an OAuth client of type **Desktop app** under Credentials.
4. Paste the Client ID and Secret into `config.json`.
5. In the app, click **Connect Google Calendar** for one-time browser consent. Tokens are cached locally — never stored in `config.json` or git.

### Local Apps, Learning, and Claude Code

These lists are managed in the UI and persisted in SQLite — not in `config.json`. On first launch, if a list is empty, the app seeds it from legacy `localApps` / `learning` / `claudeCode` keys in `config.json` if present (one-time migration).

## Running without a terminal

```bash
npm run package
```

This builds `dist/mac-arm64/Command Center.app`, which you can drag into `/Applications` and launch from Spotlight or the Dock.

- **Unsigned app:** Gatekeeper blocks the first launch as "unidentified developer." Right-click → **Open** once to bypass, or run `xattr -cr "Command Center.app"`.
- **Separate config:** The packaged app can't edit `config.json` inside its bundle. It keeps a user copy at:

  `~/Library/Application Support/Command Center/config.json`

  Seeded from `config.example.json` on first launch. Edit that copy for packaged builds.

## Data storage

| What | Where |
|---|---|
| User config | `config.json` (repo root in dev; `~/Library/Application Support/Command Center/` when packaged) |
| Google OAuth tokens | `~/Library/Application Support/Command Center/google-tokens.json` |
| SQLite database | `~/Library/Application Support/Command Center/command-center.db` |

The database holds Local Apps, Learning, Claude Code project lists, and the Scratchpad note.

## Architecture

An Electron app has three deliberately walled-off parts:

- **Main process** (`src/main/`) — Node.js with full OS access. Window creation, IPC handlers, file I/O, shell commands, API calls.
- **Preload** (`src/preload/`) — the only bridge. Exposes a small typed API (`window.api.*`) via `contextBridge`.
- **Renderer** (`src/renderer/src/`) — sandboxed React UI. Talks to main only through `window.api`.

Shared types in `src/shared/types.ts` define the contract used by all three.

```
UI event → window.api.x() → ipcRenderer.invoke → ipcMain.handle → service → result
```

Services fail soft: they return `{ ok: false, reason }` instead of throwing, so a broken widget shows a message instead of crashing the app.

## Notes

- **Docker** shells out to the `docker` CLI — Docker Desktop (or the daemon) must be running.
- **Terminal launching** writes a Warp Tab Config to `~/.warp/tab_configs/` and opens it via `warp://tab_config/...`.
- **Reader** without a token shows "No Readwise API token configured" instead of erroring.
- Widgets without configured credentials degrade gracefully with a friendly message.

## Roadmap

1. **GitHub** — open PRs / CI status via the GitHub API.
2. **Drag-to-rearrange grid** — swap the CSS grid for something like `react-grid-layout`.

## License

MIT
