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
- **CodeMirror 6** — the markdown editor behind Scratchpad/Notes/Daily Note/
  Finance Review Log, plus `@lezer/markdown` as the parser shared by both the
  editor and the static preview renderer. See "Markdown editor" below.
- **better-sqlite3** — persists everything: the Local Apps / Learning / Claude Code
  lists (display order + CRUD), the Notes tab's nav list + open-tabs session, Habits,
  the Scratchpad, and — as of the Settings page — all app configuration (API tokens,
  vault paths, GitHub repos, managed processes, refresh intervals). `config.json` is
  no longer read at runtime; see "Settings" below.

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
    server URL, production loads the built `out/renderer/index.html`. Holds no
    module-level config state — every handler reads settings fresh per call via
    `services/settings.ts`, so a Settings edit takes effect on the next call, no
    restart needed.
  - `services/db.ts` — owns the single shared `better-sqlite3` connection
    (`app.getPath("userData")/command-center.db`, WAL mode). `initDatabase()` opens
    it; every other DB-backed service imports `getDatabase()` from here and creates
    its own tables in its own `init*()`.
  - `services/settings.ts` — all app configuration, SQLite-backed. Scalar sections
    (`grimoire`, `docker`, `app`, `todoist`, `googleCalendar`, `reader`, `github`'s
    non-array fields) are JSON blobs in a generic `settings(key, value)` table — no
    schema migration needed when a section's shape changes, only the TS type. The
    three array sections (`vaults`, `github_repos`, `processes`) get their own
    tables with full list/add/update/remove/reorder CRUD, same shape as
    `services/links.ts`. `readLegacyConfigFile()` + `seedSettingsFromLegacyConfig()`
    run once at boot: read `config.json` if present (dev: repo root; packaged: an
    existing install's userData copy) or fall back to bundled `config.example.json`
    defaults, and seed any table/row that's still empty — idempotent, safe every
    boot, and this app never writes to `config.json` again afterward. See
    "Settings" below for the full migration story.
  - `services/docker.ts` — shells out to `docker ps`, parses JSON-lines output.
  - `services/grimoire.ts` — reads Obsidian vault markdown directly from disk, given
    the current `grimoire` settings section. `readDailyNote` distinguishes "no
    note for this day yet" (`missing: true`, by statting the daily-log folder)
    from a real failure like a bad vault path, so the widget can offer an empty
    editable note in the first case — `saveDailyNote` writes unconditionally
    and creates the file, so nothing else is needed to start today's log from
    the dashboard. Deliberately never mkdir's the folder itself; inventing
    vault structure out from under Obsidian isn't this app's business.
  - `services/todoist.ts` — calls the Todoist REST API for due/overdue tasks, given
    the current `todoist` settings section.
  - `services/launcher.ts` — opens a terminal at a dir and runs a command (macOS:
    writes a Warp Tab Config and opens it via `warp://tab_config/...`; Linux/Windows stubbed).
  - `services/forklift.ts` — opens a local directory in ForkLift via `open -a
    ForkLift <path>` (macOS-only, fails soft elsewhere). Backs the File Links widget.
  - `services/googleCalendar.ts` — Google Calendar API v3 via OAuth (loopback + PKCE,
    no dependency beyond `node:http`/`node:crypto`), given the current `googleCalendar`
    settings section. Tokens cache to `app.getPath("userData")/google-tokens.json` —
    never in git, never in the settings DB.
  - `services/links.ts` — SQLite CRUD + reorder for the Local Apps / Learning /
    Claude Code lists, one table per list (imports its DB connection from `db.ts`).
    One-time migration seeds it from `config.json`'s old `localApps`/`learning`/
    `claudeCode` arrays if a table is empty — independent of and unrelated to the
    `settings.ts` migration above, since these arrays left `AppConfig` earlier.
  - `services/reader.ts` — Readwise Reader API v3 for the latest saved documents,
    given the current `reader` settings section. Cursor-paginated upstream, so this
    keeps a small in-memory cache and does the sort-by-saved-date + 15-per-page
    slicing itself.
  - `services/github.ts` — GitHub REST API for latest Actions run + open PR count
    per configured repo, plus a cross-repo review-requested search, given the
    current `github` scalar settings + `github_repos` table combined. Skips rows
    with no `owner`/`repo` (see `git.ts` below) so a local-only repo never
    produces an API call.
  - `services/git.ts` — local working-tree status (`git status --porcelain=v2
    --branch` + a one-line `git log`) for every `github_repos` row that has a
    `localPath`. The counterpart to `github.ts`: that one asks the API about CI
    and PRs, this one answers "do I have uncommitted work, and am I behind?"
    from disk, for free. Parses porcelain **v2** deliberately — v1 is ambiguous
    around renames and spaces in paths. A file that's both staged and further
    edited counts toward `staged` *and* `unstaged`; those are independent
    counters, not an either/or. Fails soft per repo (`ok: false` + reason on the
    row) so one bad path doesn't blank the widget. Note it does **not** copy
    `docker.ts`'s PATH widening: that exists because Docker Desktop installs
    outside launchd's bare PATH, whereas `git` is at `/usr/bin/git` and resolves
    fine from a GUI-launched app.
  - `services/notes.ts` — browses/reads/writes markdown files directly in
    configured Obsidian vaults (`settings.ts`'s `vaults` table, looked up by label
    via `listVaultSettings()`) for the Notes tab. All paths are resolved and
    checked against the vault root before any read/write, so a stray `../` can't
    escape the vault. The left-nav pin list and open-tabs session live in SQLite
    (`notes` / `notes_session` tables) — they only ever reference a file by
    `(vaultLabel, filePath)`, never copy its content, so the file on disk stays the
    single source of truth. Writes are mtime-guarded and `statNotes` batches
    freshness checks — see "Notes tab" below for the conflict model.
  - `services/processes.ts` — starts/stops/tails arbitrary long-running local
    processes configured in Settings' Processes section (dev servers, watchers,
    tools like `opencode`). In-memory only (no writes back to the `processes`
    table beyond what Settings already does) — a `Map<id, { child, logs, exitCode }>`
    is the sole source of runtime truth, keyed by the same `id` used in Settings; a
    process that's never been started this session just has no entry. Not a
    terminal emulator — no PTY/`node-pty`/`xterm.js`, no interactive stdin, just
    spawn + capped log-tail + a reliable kill. Spawns with `detached: true` on
    macOS/Linux so the child is its own process group leader, and stops it
    with `process.kill(-pid, "SIGTERM")` (escalating to `SIGKILL` after 3s)
    — a plain `child.kill()` only hits the parent and would orphan a dev
    server's own forked children. Windows has no such group signaling, so it
    uses `taskkill /pid <pid> /T /F` instead, which walks the real process
    tree; no `tree-kill` dependency needed for either path. Killed en masse
    via `stopAll()` on `app`'s `before-quit` (main/index.ts holds quitting up
    until the kills resolve) so closing the dashboard never leaves an
    orphaned server running.
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

- **Settings over config files.** Anything user-specific (paths, ports, instances,
  tokens, projects) lives in the SQLite-backed settings store, edited through the
  Settings page (gear icon) — never hardcoded, and no longer hand-edited in a JSON
  file at runtime. See "Settings" below for the full model and the one-time
  `config.json` migration.
- **Adding a widget** = five touch points, in order:
  1. Shared types in `src/shared/types.ts`, if the data shape is new.
  2. Service function in `src/main/services/*.ts` (if it needs OS access).
  3. `ipcMain.handle("thing:action", ...)` in `src/main/index.ts`.
  4. Expose it in `src/preload/index.ts` under `window.api` (+ add to `CommandCenterApi`).
  5. Component in `src/renderer/src/components/*.tsx`, wired into `App.tsx`'s state.
  If the widget needs new user-editable config, add a matching scalar section or
  array table to `services/settings.ts` and a section to `SettingsPage.tsx` rather
  than a new `config.json` field.
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
- **Development** — GitHub (CI + PRs), Git (local working-tree status),
  Services (Docker), Claude Code, Processes (managed local
  processes), GitHub (CI status + PRs).
- **Reader** — latest Readwise Reader documents, paginated.
- **Scratchpad**, **Habits**, **Notes** — custom full-tab layouts rather than a grid
  of widgets (see below); each gets one full-bleed `.slot` instead of the
  five-touch-point widget pattern.

Add a new tab by adding an entry to `TABS`, a new `.grid-<name>` CSS block
(grid-template-columns/areas), and a new `{activeTab === "..." && <main>...}` block.

## Current widgets

Docker status (auto-refresh) · today's Grimoire daily note (editable, created
on first keystroke if it doesn't exist yet; prev/next navigation between
existing notes, deep link to open in Obsidian) · Google Calendar schedule
(prev/next day pagination, join-meeting link, expandable notes) · active missions ·
Todoist due/overdue tasks (grouped by project, with tags/subtasks) · Local Apps
launcher (SillyTavern, Open WebUI, OpenCode, etc.) · Learning launcher (courses/docs
links) · File Links launcher (opens a local folder in ForkLift) · Claude Code
launcher (opens in Warp) · Reader (latest Readwise Reader documents, paginated 15
at a time) · GitHub (per-repo latest CI run + open PR count, cross-repo
review-requested PRs, auto-refresh on `github.refreshSeconds`) · Git (local
working-tree status per configured repo path — branch, ahead/behind, staged/
unstaged/untracked/conflict counts, last commit; click to open in ForkLift) ·
Managed Processes (start/stop/tail arbitrary local tools, see below).

Local Apps, Learning, and File Links all render via the generic
`LinkLauncherWidget` (`components/LinkLauncherWidget.tsx`) — a SQLite-backed
`LinkItem[]` list (`{ id, label, link, sortOrder }`, see `services/links.ts`)
with drag-to-reorder (`@dnd-kit`), inline add/edit/delete, and click-to-open.
Two optional props change what "open" means per list: `onLaunch` (defaults to
`window.api.openUrl`; File Links passes `window.api.forklift.open`, which
shells out to `open -a ForkLift <path>` via `services/forklift.ts`, macOS-only)
and `formatDisplay` (defaults to `toDisplayHost`, showing a URL's host; File
Links passes `toDisplayBasename`, showing a path's last segment instead).
`ClaudeLauncherWidget` is the same underlying idea rendered as a horizontal
chip row instead, launching a terminal rather than reusing `LinkLauncherWidget`
— its click behavior needed richer opening/opened/failed state feedback than
a plain launch button. All four talk to `window.api.links.*` (one more DB
table each, added to the `TABLES` map in `services/links.ts`) via the shared
`useLinkList` hook (`renderer/src/hooks/useLinkList.ts`).

## Notes tab

Browses into one or more configured Obsidian vaults (Settings' Vaults section —
separate from Grimoire's vault path in Settings, which only backs the Home tab's
daily note/missions), pins specific notes into a left nav grouped by vault,
opens several at once as tabs, and edits them with the same autosave pattern
as Scratchpad — no explicit save. Deleting a nav entry only removes that row,
never the file.

**Conflict safety.** Writes are mtime-guarded: `readNoteFile` returns the
file's `mtimeMs`, the renderer keeps it as a per-note baseline, and
`saveNoteFile` refuses to write (returning `{ conflict: true }`) if the file
changed underneath it — so editing a note in real Obsidian while it's open
here can no longer be silently overwritten. On window focus the widget
`notes:statMany`s every open note: a clean buffer silently reloads, a dirty
one gets a non-blocking Reload / Keep-mine bar. Passing no `expectedMtimeMs`
writes unconditionally, which is the first-save and "Keep mine" path. Same
trigger re-fetches vault indexes older than 60s, so a note created in
Obsidian resolves as a wikilink without a restart.

`components/NotesWidget.tsx` owns all the state itself (nav list, which notes
are open, per-note content cache, per-note debounced autosave, mtimes) — same
self-contained pattern as `ScratchpadWidget`/`HabitsWidget`. The one exception
is the nav list, mirrored up to `App.tsx` via `onNavChange` so the command
palette can offer pinned notes, with palette-initiated opens coming back down
as `pendingOpen` (same push-up/hand-down shape `SettingsPage` uses for
`processConfigs`). `components/NoteBrowserModal.tsx` is the "+" file-tree
browser (always opens at the vault root, lazy per-folder fetches via
`notes:browse`, no recursive walk). The editor pane is `MarkdownPane` (see
"Markdown editor" below); the Notes-specific CSS only covers the
nav/tab-strip/browser-modal chrome around it.

Open tabs + the active tab persist across restarts in a `notes_session`
singleton row (same shape as `services/scratchpad.ts`'s single-row table), so
relaunching the app restores where you left off.

## Markdown editor

CodeMirror 6 with Obsidian-style live preview, shared by four consumers:
Scratchpad, Notes, Daily Note (Home), and Finance Review Log. **Anything that
would otherwise be copied into all four belongs in one of the shared pieces
below** — they were byte-identical copies once and had already drifted in
three places before being extracted.

- `components/MarkdownPane.tsx` — the editing surface. Two exports, because
  consumers disagree about where the toolbar goes: `MarkdownPaneToolbar`
  (Write/Preview pills + word count + Saving…/Saved + a `children` slot) is
  placed by the consumer (Panel `headerRight` for Scratchpad/Finance, an
  in-body toolbar for Notes/Daily Note), while the default export renders the
  formatting toolbar, the editor, and the rendered-preview pane. It owns the
  task-toggle splice, the `includeFrontmatter: false` + `<FrontmatterBlock>`
  pairing, and the bridging between the editor's `[[target]]` wikilink
  callback and the preview's resolved `(filePath, label)` one. `docKey` is
  **required**: it's the editor's React key, and frontmatter-collapsed-by-
  default only applies at `EditorState` creation, so reusing one instance
  across two documents would carry fold state over.
- `hooks/useAutosave.ts` — keyed debounced save. **Unmount flushes rather than
  cancelling**; the previous per-widget copies all `clearTimeout`'d on unmount,
  so switching tabs inside the 500ms window silently dropped the last edit.
  Also flushes on `beforeunload`. `isPending(key)` backs the conflict check
  above; `cancel(key)` is for callers about to write something else themselves
  (Scratchpad's Clear).
- `lib/markdownEditor.ts` — extension assembly plus every editing command
  (`toggleBold`, `setHeadingLevel(n)`, `toggleBulletList`, `insertTable`, …),
  exported so `components/MarkdownToolbar.tsx` can dispatch them. Line-prefix
  commands go through `editSelectedLines`, **not** `state.changeByRange` — a
  multi-line selection needs one change per *line*, not per range. List
  toggles reuse `matchListLine`, the single definition of what counts as a
  list, shared with `continueList` and kept in step with the preview renderer.
- `lib/markdownCompletions.ts` — `[[` vault-note picker and `/` block
  snippets. The wikilink source is vault-dependent, so `NotesWidget` supplies
  it and the other three get slash commands only. `completionKeymap` is
  registered at `Prec.highest`, which is safe because `acceptCompletion`
  returns false with no popup open and falls through to `continueList`.
- `lib/clickableLinks.ts` + `lib/linkDestination.ts` — Mod+click to follow a
  link, with a Mod-held hover underline so the gesture is discoverable at all.
  `linkDestination` is the shared answer to "what does this node point at",
  used both by the click handler and by the decoration that marks it, so the
  thing that *looks* followable and the thing that *is* can't diverge. Covers
  bare `URL` nodes (a pasted `https://…`, which has no wrapper node) as well
  as `Link`/`Image`/`Autolink`/`WikiLink`.
- `lib/urls.ts` — `safeUrl` scheme allowlist applied to every emitted
  `href`/`src`, and `normalizeBareUrl` for GFM autolinks. C0 control
  characters are stripped before the scheme test, because browsers strip them
  while parsing and `java\nscript:` would otherwise pass.
- `lib/editorSearch.ts`, `lib/markdownPaste.ts`, `lib/outline.ts` — Mod-F
  find/replace, paste-URL-over-selection → `[text](url)`, and the heading
  outline behind `components/OutlineButton.tsx`.

**Two compartments** (`completionCompartment`, `placeholderCompartment`) let
those change after mount without recreating the view and losing undo history —
the vault index arrives asynchronously. Nothing else gets one; a compartment
per extension is ceremony. `MarkdownEditor` reports its view via an
`onViewReady` callback rather than an imperative handle, because
`useImperativeHandle` is a *layout* effect and fires before the passive effect
that creates the view.

All CodeMirror styling lives in `EditorView.theme()` next to the feature it
belongs to, never in `styles.css` — which holds only the React chrome around
the editor (`.md-toolbar`, `.md-conflict`, `.md-outline-*`, `.scratchpad-*`).

## Managed Processes (Development tab)

Settings-driven start/stop/log-tail for arbitrary long-running local processes
(dev servers, watchers, tools like `opencode`) — a generic "local services
control panel" rather than a one-off per tool. Adding a new entry via Settings'
Processes section is the entire integration; no code changes needed.
Deliberately NOT a terminal emulator — the user interacts with the
process's own web UI (opened via `url`/`autoOpenUrl`, reusing the existing
`open:url` → `shell.openExternal` path), not a console, so there's no PTY,
no `node-pty`, no `xterm.js`, no interactive stdin. See `services/processes.ts`
above for the tree-kill approach.

`components/ManagedProcessesWidget.tsx` follows the standard five-touch-point
widget pattern — `App.tsx` owns `processConfigs` (from `settings.getAll()` at
boot, then kept live: `SettingsPage`'s Processes section pushes the freshly
CRUD'd list back up via an `onProcessConfigsChange` prop every time it changes,
so adding/editing/removing a process in Settings updates this widget
immediately, no restart) and `processStatuses` (live, `process:statusAll`
polled every ~3s alongside Docker/GitHub's own intervals, plus on "Refresh
all"). The widget itself additionally self-polls `process:status` for
whichever row's log panel is expanded on a faster ~1.5s cadence, merged over
the App-fed status for just that row — pips don't need low latency, a log
tail you're actively watching does. A process that's never been started this
session has no entry in `processStatuses`; the widget falls back to an empty
"stopped" status for it, using `processConfigs` as the source of truth for
what rows exist at all.

## Command Palette

`⌘P`/`Ctrl+P` opens a global fuzzy-filter launcher over tabs, Claude Code
projects, Local Apps/Learning links, pinned Notes, Docker start/stop, and a
couple of quick actions ("Refresh all", "New scratchpad note"). It's app-wide navigation, not
a per-tab widget, so it skips the five-touch-point pattern above:
`src/renderer/src/palette.ts` holds the action registry (`buildActions()`
rebuilds the list fresh every time the palette opens, from whatever state
`App.tsx` already has — no new IPC), and
`components/CommandPalette.tsx` is the overlay itself. The global keydown
listener lives in `App.tsx`; it's renderer-only (no Electron `globalShortcut`),
so it only fires while a Command Center window is focused.

**Why `⌘P` and not the more usual `⌘K`:** this listener is on `window` and
calls `preventDefault()`, so it wins against any CodeMirror binding no matter
what the editor asks for — and `⌘K` is the near-universal "insert link"
shortcut, which the markdown editor now uses. Anything bound here is
effectively taken away from every editor in the app, so keep that in mind
before adding more.

## Settings

The gear icon in the header (`.refresh-control`, next to Refresh) opens
`components/SettingsPage.tsx` — a full-screen overlay (same scrim+panel visual
language as `CommandPalette`/`NoteBrowserModal`, closes via scrim-click/Escape/X)
with a left section-nav (General, Grimoire, Integrations, Vaults, Repositories,
Processes) and a scrollable content pane. It's app-wide config management, not a
per-tab widget, so it skips the five-touch-point pattern — its data model is
`services/settings.ts` end to end (see Architecture above), exposed through a
`window.api.settings.*` namespace mirroring the `links`/`habits` CRUD shape.

Scalar sections (API tokens, refresh intervals, vault path) each render as their
own card with an explicit **Save** button and a dirty-state check — no
autosave-per-keystroke, so a half-typed token never gets persisted mid-edit and
picked up by a background poll. Secrets (Todoist token, Google Calendar client
secret, Readwise token, GitHub token) render as masked `type="password"` fields
with an eye-icon reveal toggle (`IconEye`/`IconEyeOff` in `components/icons.tsx`);
stored in plaintext in the settings DB, same trust level as the old gitignored
`config.json`. Array sections (Vaults, GitHub Repos, Processes) save immediately
per row-action instead, matching `LinkLauncherWidget`'s inline add/edit/delete +
`@dnd-kit` reorder convention — each backed by a small dedicated hook in
`renderer/src/hooks/useSettingsLists.ts` (`useVaultSettingsList`,
`useGithubRepoSettingsList`, `useProcessSettingsList`), same shape as
`useLinkList.ts`.

Four values `App.tsx` already caches reactively — `processConfigs`,
`appRefreshMinutes`, `dockerRefreshSeconds`, `githubRefreshSeconds` — get pushed
back up via callback props on save, so editing an interval in Settings changes
the live polling cadence immediately (Docker's and GitHub's refresh intervals
each run in their own `useEffect` keyed on the corresponding state, not a
one-shot `setInterval` from boot). Everything else the page shows is read fresh
via IPC on next use, no client-side cache to reconcile.

**`config.json` migration.** `config.json`/`config.example.json` are legacy
inputs now, not a runtime dependency — `services/settings.ts`'s
`readLegacyConfigFile()` + `seedSettingsFromLegacyConfig()` run once at boot,
seed any settings row/table that's still empty from `config.json` (or, absent
that, from bundled `config.example.json` defaults), and never touch the file
again. A packaged app no longer auto-creates a `userData/config.json` on first
launch either — a brand-new install seeds straight from the bundled defaults in
memory. `config.json` is still gitignored and `config.example.json` still
committed, purely as that one-time seed source / first-run default reference.

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
- All settings below are edited via the Settings page (gear icon), not a config
  file. `config.json` is gitignored and only used as a one-time migration source for
  an existing install (see "Settings" above); `config.example.json` is the committed
  reference for first-run defaults on a brand-new install.
- **Reader widget** needs a Readwise access token (`https://readwise.io/access_token`)
  in Settings → Integrations → Readwise Reader — without one it fails soft with "No
  Readwise API token configured".
- **Google Calendar setup**: create a Google Cloud project, enable the Calendar API,
  set the OAuth consent screen to External with yourself as a test user (skips Google's
  app-verification process entirely), then create an OAuth client of type **Desktop app**
  under Credentials. Paste the Client ID/Secret into Settings → Integrations → Google
  Calendar, then click "Connect Google Calendar" in the widget — it opens your browser
  for one-time consent and caches tokens after that.
- **GitHub widget setup**: put a personal access token (repo + read:org scope) and your
  review username into Settings → Integrations → GitHub, and list repos to track under
  Settings → Repositories. Without a token the widget fails soft with "No GitHub token
  configured".
- **Git widget setup**: give a row under Settings → Repositories a **local path**. That
  section backs both widgets: `owner`/`repo` put a row in the GitHub widget, a local
  path puts it in the Git widget, and either alone is valid — so a local-only scratch
  repo with no GitHub counterpart is fine, as is a GitHub repo you haven't cloned.
  Clicking a row opens it in ForkLift. Its poll interval is Settings → General → Git
  (default 30s), deliberately separate from GitHub's 300s: local git costs no API quota.
- **Notes tab setup**: add vault roots to browse under Settings → Vaults (a label +
  the vault's root folder path, each). Without any configured, the nav shows "No
  vaults configured"; with none yet pinned for a given vault, its group still shows
  so you can click "+" to add the first one.
- **Managed Processes setup**: add processes under Settings → Processes (label,
  command, args, optional working dir/URL/auto-open-delay each — the process id is
  auto-generated from the label, editable before first save, immutable after since
  `services/processes.ts`'s runtime tracking keys off it). Without any configured,
  the widget shows "No processes configured". Prefer an explicit args list over a
  shell string where possible (matches `docker.ts`'s `execFile`-over-`exec`
  preference elsewhere in this codebase).
- **Packaged app is ad-hoc signed, not Gatekeeper-trusted** (no Apple Developer cert
  configured). First launch is still blocked as "unidentified developer" — right-click
  the app → Open once to bypass, or `xattr -cr "Command Center.app"`.
  `electron-builder.yml` sets `mac.identity: "-"` deliberately: leaving it unset means
  "auto-discover a certificate", which finds none and **skips signing entirely**,
  shipping the bundle with the linker's own signature whose identifier is the literal
  string `Electron` and which doesn't cover Info.plist. macOS then treats the app's
  identity as generic Electron — shared with dev-mode Electron and every other ad-hoc
  Electron app on the machine — which breaks notification permissions. (Electron 42+
  makes that fatal rather than flaky: macOS notifications moved to `UNNotification`,
  which refuses to display for an unsigned app.) `hardenedRuntime: false` accompanies
  it, since hardened runtime enforces library validation that an ad-hoc bundle fails at
  launch without a `disable-library-validation` entitlement.

  Signing is electron-builder's job, **not** the `package` script's — don't add a
  manual `codesign` step. electron-builder signs the bundle inside-out (every helper,
  framework, and `.dylib` in dependency order); a post-hoc `codesign --force --deep`
  would overwrite that with a blunter signature, and Apple treats `--deep` as a
  repair tool rather than a build step. What the script *does* add is
  `npm run verify:signing`, chained onto `package`, because both regressions here are
  silent: removing `mac.identity` makes electron-builder skip signing with only a
  warning, and on a non-macOS host it skips unconditionally. The check asserts the
  Identifier is `com.craig.command-center` and exits non-zero otherwise. Its path is
  hardcoded to `dist/mac-arm64/` — update it if you ever build universal or x64. All settings live in the packaged
  app's SQLite DB at `~/Library/Application Support/Command Center/command-center.db`,
  editable via the Settings page — not a file to hand-edit.
