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
  - `services/ynab.ts` — YNAB REST API (api.ynab.com/v1): account balances,
    unapproved transactions, this month's scheduled transactions, categories,
    and the approve/clear/categorise/memo mutations behind the Finances tab.
    Fails soft like the other API services.
  - `services/bills.ts` / `services/cards.ts` — manually-tracked recurring bills
    and credit cards for the Finances tab. Plain SQLite CRUD, same shape as
    `links.ts`. Deliberately independent of YNAB's own scheduled transactions:
    not everything recurring is set up as a YNAB schedule (a bill paid from an
    external account, say), so this is a parallel list rather than a mirror.
    `bills.ts` also carries the additive-`ALTER TABLE`-in-a-try/catch migration
    pattern that `settings.ts`'s `local_path` column later copied.
  - `services/timeTracking.ts` — cumulative time logged against Todoist tasks,
    for client billing, plus the monthly report. A row is only written once time
    is actually logged, so there's no shadow row per Todoist task.
    `task_content`/`project_name` are **snapshotted per entry** rather than
    looked up live, so a monthly report still reads correctly after the upstream
    task is completed or deleted. Only one timer runs at a time — starting one
    auto-stops whichever was running.
  - `services/claudeUsage.ts` + `services/claudePricing.ts` — token and cost
    accounting for Claude Code, read from the transcripts it already writes to
    `~/.claude/projects`. See "Claude Code usage" below — the three correctness
    constraints there are easy to break and produce plausible-looking numbers
    when broken.
  - `services/windowState.ts` — remembers the dashboard window's size, position
    and maximized/fullscreen state in a `window` settings blob. Uses
    `getNormalBounds()`, **not** `getBounds()`: while maximized or fullscreen the
    latter returns the expanded rectangle, so persisting it would make
    un-maximizing later snap to a screen-sized window instead of whatever the
    user actually had. Saved bounds are checked against the current displays
    before use — a window restored onto a since-disconnected monitor is
    invisible and reads as a failed launch. Saves are debounced (`resize` fires
    continuously through a drag and each save is a synchronous SQLite write),
    with a flush in `before-quit` since close hides rather than destroys and
    there's no close event to save on.
  - `services/dailyTemplate.ts` — renders an Obsidian template into the content
    for a daily note that doesn't exist yet. See "Daily note template" below.
  - `services/backup.ts` — daily rotating backups + manual export of the SQLite
    file. See "Backups" below; the `db.backup()`-not-`fs.copyFile` detail there
    is the important part.
  - `services/capture.ts` + `services/captureWindow.ts` — global-hotkey quick
    capture. See "Quick capture" below.
  - `services/notifications.ts` — OS notifications, given an already-decided
    alert (transition detection happens in the renderer, where the polled state
    lives — see "Notifications + tray" below). Exists mainly to make failure
    *visible*: it reports `Notification.isSupported()` and captures the `failed`
    event, so Settings can say macOS rejected a notification instead of the app
    silently appearing to work.
  - `services/tray.ts` — the menubar status item: a summary line, Show /
    Refresh all / Quit, plus a count badge via `setTitle` only when something is
    actually wrong. Its icon comes from `trayIcon.ts` (embedded base64 template
    PNGs) rather than from disk — see that file for why. No `click` handler:
    with a context menu attached, macOS opens the menu on left-click, and a
    click handler on top of that made one click both open the menu and raise
    the window.
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

The dashboard is split into tabs so lesser-used widgets don't crowd the main
view. All widget data still loads and polls in the background regardless of
which tab is active — only the JSX rendered under `<main>` is tab-gated, state
lives in `App.tsx` same as always.

- **Home** — Due & Overdue, Today's Log, Today's Schedule (Google Calendar), Active
  Missions, Local Apps, Learning, File Links.
- **Development** — GitHub (CI + PRs), Git (local working-tree status),
  Services (Docker), Claude Code, Processes (managed local processes).
- **Reader** — latest Readwise Reader documents, paginated.
- **Finances** — YNAB accounts + scheduled transactions, manually-tracked Bills
  and Cards, the Finance Review Log (a markdown note), and YNAB's unapproved
  transactions with inline category/memo editing.
- **Claude** — Claude Code token/cost usage (today, 7d, 30d, with a per-day bar
  strip), by-project and by-model breakdowns, and recent sessions with Resume.
  See "Claude Code usage" below.
- **Scratchpad**, **Habits**, **Notes** — custom full-tab layouts rather than a grid
  of widgets (see below); each gets one full-bleed `.slot` instead of the
  five-touch-point widget pattern.

**Tab order and labels are DB-backed**, not hardcoded: they live in the `tabs`
table (`services/settings.ts`), and `TabBar` supports drag-to-reorder plus
double-click-to-rename via `settings:tabs:reorder` / `settings:tabs:rename`.
The set of tabs is still fixed in code — those handlers only reorder and
relabel existing rows, they never add or remove one.

Adding a new tab therefore means: an entry in `DEFAULT_TABS` in **both**
`App.tsx` and `services/settings.ts` (they're separate constants that must stay
in sync — `ensureTabDefaults()` seeds any missing row every boot, so a tab
added to only one of them silently won't appear), a new `.grid-<name>` CSS
block (grid-template-columns/areas), and a new
`{activeTab === "..." && <main>...}` block.

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

## Claude Code usage

The **Claude** tab reads `~/.claude/projects/**/*.jsonl` — the transcripts
Claude Code writes anyway — and reports tokens and estimated cost by day,
project and model, plus a list of recent sessions with a Resume action.
Entirely local: no API token, no network. Resume reuses `launcher.ts`'s
`openInTerminal(cwd, "claude -r <id>")`; the session id is the transcript's
filename.

**Three things are load-bearing correctness, not optimizations.** Each one
produces believable-but-wrong numbers if broken, which is why the verification
below checks them by size rather than by eye:

- **Dedupe on `(requestId, message.id)`.** Resuming or forking a session copies
  earlier messages into the new transcript, so the same request appears in
  several files — 46.7% of usage records here are duplicates. Skipping this
  roughly **doubles** every figure ($340 → $688 on the same window).
- **Walk recursively.** Subagent turns live one level deeper, in
  `<project>/<session-id>/subagents/agent-*.jsonl` (`isSidechain: true`). They
  are real spend; a one-level scan silently understates cost. Those files are
  attributed to the parent session named by their directory and are never
  listed as sessions of their own.
- **Resolve rates from each message's own date.** `claudePricing.ts` carries
  intro pricing with a cutoff; Sonnet 5's intro period covers essentially all
  existing history, and pricing it at standard rates overstated a real month by
  ~26%.

Two further details worth not "simplifying":

- **Cache creation is split by TTL** (`ephemeral_5m` / `ephemeral_1h`) because
  they're priced differently — 1.25× vs 2× the input rate — and the 1h bucket
  dominates. Cache *reads* are ~99% of all tokens, so the cache split is
  basically the whole cost story.
- **An unknown model is not free.** Anything without a rate keeps its tokens
  counted and renders as `unpriced` with no cost, rather than contributing $0
  and quietly deflating the total. `<synthetic>` records legitimately carry
  zero tokens; that's not the same thing.

Performance: transcripts here are ~390MB across 43 files, but a full scan takes
well under two seconds because `line.includes('"usage"')` skips the enormous
attachment lines before `JSON.parse` runs. That's why there's no worker process
and no persistent cache. Files are append-only, so results memoize per file on
`(size, mtimeMs)`; a refresh re-parses only what changed (~1.4s cold, ~270ms
warm). `fs.promises.glob` is deliberately not used — it needs Node 22 and
Electron 33 ships Node 20.

**Tokens lead; dollars are a value figure, not spend.** This is a deliberate
reframe, not a styling choice — leading with cost on a subscription implies a
bill that never existed. Token volume is what's actually consumed, so it's the
headline; the dollar figure is labelled *API-equivalent* and expressed as a
multiple of the plan price ("$357 in 30 days — about 18× a $20/mo Pro plan"),
which is the one genuinely useful thing it says to a subscriber. Don't promote
cost back to the headline.

Keep the dollar figure rather than dropping it, though: it's what weights Opus
against Sonnet. Raw token counts invert the picture — Opus used *fewer* tokens
than Sonnet last month but represents more value, because its input rate is 5×.

The plan is detected from `~/.claude.json`'s `oauthAccount.organizationType`,
and the price used is printed inline so a stale entry in `PLAN_PRICES` is
visible rather than silently skewing the multiple. An unrecognised plan is
named but gets no multiple.

**There is no local record of quota remaining**, so this cannot show how much
of a subscription is used up — checked: `rateLimits` appears in transcripts
only inside a 429 error payload, after the fact. Don't imply otherwise in the
UI.

## Daily note template

Settings → Grimoire takes a vault-relative `dailyTemplatePath`. When a daily
note doesn't exist yet, `readDailyNote` returns the rendered template in
`templateContent` — **separately from `content`, which stays empty**. The
template is applied at the moment of creation, not previewed:

- **Typing** — `DailyNoteWidget`'s first keystroke into a missing note swaps the
  buffer for `template + "\n" + typed` and marks the note no longer missing, so
  the header stops saying "Start typing to create …" and the save status
  appears. A `seeded` ref keyed by date stops a second copy being prepended if
  the editor is cleared and typed into again (`data.missing` stays true until a
  reload).
- **Quick capture** — `captureToDailyNote` uses `templateContent` as its base
  when the note is missing, so the captured line lands beneath the template.

The first version returned the template *as* `content`, which pre-filled the
editor. Don't go back to that: a file that doesn't exist then looks exactly
like one that does — complete with a "Saved" label — and reads as some other
day's note. `showStatus={!creating}` keeps that label off an uncreated note.

**Applied on read, not in `saveDailyNote`.** Writing it there would mean
guessing whether the incoming content already contains the template — the
ambiguity that produces duplicated headings.

Seeding on the first keystroke depends on `MarkdownEditor`'s external-sync
effect shifting the caret when the new value *ends with* the old one: content
was prepended, so holding the caret at its absolute offset would drop it inside
the template instead of after what was just typed.

**Templater blocks are stripped, `{{date}}` placeholders are filled.** This is
the opposite of `services/notes.ts`'s `createNote`, which copies templates raw
and lets Templater evaluate them — and both are correct for their case.
Templater only processes files *it* creates, so a note written by the dashboard
would keep a literal `<%* … %>` code block forever. The cost, accepted
knowingly: anything the Templater JavaScript would have generated is absent.

Placeholders resolve against **that note's own date**, not today, so an older
empty day still renders coherently.

Two details in `dailyTemplate.ts` worth not "fixing":

- **`ww` is the ISO week** (Monday-start, zero-padded), verified against this
  vault's own convention: `5 Logs/Weekly Notes/2026-W24.md` covers June 8-12
  2026, which is exactly ISO week 24. Locale-based numbering drifts from that
  at Sunday boundaries and would generate links to week notes that don't exist.
- **`YYYY` is the calendar year, not the ISO week-year** (moment calls the
  latter `GGGG`). So 2027-01-01 renders as `2027-W53` even though that date is
  ISO week 53 of *2026*. It looks wrong; it's what Obsidian would produce for
  the same template, which is the point.

## Backups

Everything the app owns is in one SQLite file — including every API token, in
plaintext. `services/backup.ts` writes
`userData/backups/command-center-YYYY-MM-DD.db` on launch, keeps the newest
`backup.keep` (default 7), and Settings → Data offers a manual export via a
save dialog.

**Use `db.backup()`, never `fs.copyFile`.** The database runs in WAL mode
(`db.ts:17`), so recent commits can still live in the `-wal` sidecar; a plain
copy of the `.db` produces a backup that looks valid and silently omits them.
`db.backup()` is SQLite's online backup API and accounts for both the WAL and
concurrent writes.

Two details that are easy to lose:

- **One backup per calendar day**, guarded by the filename itself rather than
  stored state — so ten launches in a day produce one file, and the guard
  survives restarts for free. The stamp is local-time, not `toISOString()`,
  which would file an evening backup under tomorrow.
- **The copy is consolidated to a single file** afterwards
  (`wal_checkpoint(TRUNCATE)` + `journal_mode = DELETE`). Without that step the
  backup inherits WAL mode and drags `-wal`/`-shm` sidecars along, so an export
  hands the user three files when they'll only think to copy one.

The export card states that the file contains tokens in plaintext. Keep that
warning — it's the difference between an informed export and a leak.

## Quick capture

A global hotkey (default `Cmd+Ctrl+Alt+Shift+Q`, the hyperkey combo) opens a
small frameless panel from any app, appending a timestamped line to today's
daily note (default) or the scratchpad. `services/capture.ts` composes the
existing grimoire/scratchpad services; `services/captureWindow.ts` owns the
window and the shortcut. The panel is a second renderer entry
(`src/renderer/capture.html`, wired in `electron.vite.config.ts`).

Three macOS specifics, each found by it going wrong:

- **`type: "panel"` is required, and is not sufficient on its own.** As a plain
  window the panel shows on top but the previously-active app keeps keyboard
  focus, so everything typed goes *into that app* — the panel shows a caret and
  silently drops input. As an NSPanel it can take key focus without activating
  the app, but macOS still won't give it focus unless the app becomes active:
  hence `app.focus({ steal: true })` in `toggleCaptureWindow`. Electron reports
  `isFocused() === true` throughout, so this failure is invisible from inside.
  Hidden windows stay hidden through the activation, so summoning the panel
  does not drag the dashboard forward.
- **`globalShortcut.register()` is not a validator on macOS.** It returns
  `true` for a malformed string like `"NotAReal+Key+Q"` and for combos another
  app already owns (verified with `Cmd+Space`, which Spotlight holds). So
  `shared/accelerator.ts` validates the string itself — that catches a typo,
  the failure a user typing into the field will actually hit. A genuine
  conflict with another app is **not detectable**; the Settings copy says so
  rather than implying a check exists. Don't "improve" this by trusting the
  return value.
- **The panel hides on blur and clears its buffer**, so a half-typed thought
  never lingers invisibly.

**Capture writes can clobber the UI's buffer.** Both targets are also edited by
autosaving widgets holding the *entire* document in renderer memory, so an
append behind their back would be overwritten by their next save. Main
broadcasts `{ type: "captured", target }` over `app:command`; the owning widget
calls `autosave.cancel(...)` and reloads. `cancel` (not `flush`) is the right
one — flushing would write the pre-capture buffer over the captured line.

## Notifications + tray

Desktop notifications for three transitions — CI turning red, a managed process
crashing, a Docker container stopping — plus a menubar tray that always shows
current status. Toggled per-trigger in Settings → General → Notifications.

**Detection lives in the renderer, in `renderer/src/lib/alerts.ts`.** That's
where the polled state already is, so no new polling was added: an effect in
`App.tsx` keyed on `[github, processStatuses, docker]` diffs the current
snapshot against the previous one. The module is pure (no React, no IPC, no
clock) so the rules can be tested directly. Main's only job is turning a
decided alert into an OS notification.

Two rules that matter, and are easy to regress:

- **Edge-triggered, never level-triggered.** Alerts fire when something
  *changes into* a bad state. Level-triggering would re-notify about the same
  red build every poll — Docker's is every 15s.
- **The first poll seeds the baseline and fires nothing**, so launching with CI
  already red doesn't produce a burst about things you already knew. A key
  absent from the previous snapshot is likewise skipped, so a newly-configured
  repo that's already failing stays quiet.

A deliberate process stop needs no special-casing: `services/processes.ts`
records `null` when a child dies by signal, and a crash is `exitCode` non-null
and non-zero — so SIGTERM stops can't reach the crash rule.

**Close hides the window instead of destroying it** (`main/index.ts`'s `close`
handler). Every poller lives in the renderer, so a destroyed window would mean
no polling, no notifications, and a tray frozen at its last value. `quitting`
distinguishes a real quit, which falls through to the existing `before-quit` →
`stopAllProcesses()` → `app.exit()` path.

**`app:command` is the only main→renderer channel** in the app; everything else
is renderer→main `invoke`. It exists because the tray menu and notification
clicks originate in main. The preload exposes a single subscription returning
an unsubscribe — the raw `IpcRendererEvent` never crosses the bridge, since it
carries `sender`.

### macOS gotchas (all found the hard way)

- **A menu bar manager can swallow the tray icon entirely.** This machine runs
  [Ice](https://github.com/jordanbaird/Ice), which hides new status items into
  a collapsed section by default (`AutoRehide`), re-hiding after 15s. `new
  Tray()` succeeds, no error is raised, and nothing is visible. If the icon
  seems missing, expand the hidden section before suspecting the code — this is
  the most likely explanation for a "the tray doesn't work" report.
- **Notifications need a LaunchServices launch.** Running the binary directly
  (`Contents/MacOS/Command Center`) makes `show()` silently do nothing — no
  banner and no `failed` event. Launch with `open path/to/Command Center.app`.
  This bites when testing from a terminal.
- **Test notifications against the packaged app, not `npm start`.** Dev runs
  `node_modules`' Electron, identity `com.github.Electron`, so notifications
  appear under the name "Electron" and register separately. Only the packaged,
  ad-hoc-signed bundle posts as Command Center (see the packaging note below).

## Settings

The gear icon in the header (`.refresh-control`, next to Refresh) opens
`components/SettingsPage.tsx` — a full-screen overlay (same scrim+panel visual
language as `CommandPalette`/`NoteBrowserModal`, closes via scrim-click/Escape/X)
with a left section-nav (General, Grimoire, Integrations, Vaults, Repositories,
Processes, Data) and a scrollable content pane. It's app-wide config management, not a
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
