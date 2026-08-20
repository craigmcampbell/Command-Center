import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteNavItem, VaultConfig, VaultNoteIndexEntry } from "../../../shared/types";
import type { ResolvedWikilink } from "../lib/markdown";
import { useAutosave } from "../hooks/useAutosave";
import Panel from "./Panel";
import MarkdownPane, { MarkdownPaneToolbar } from "./MarkdownPane";
import type { ViewMode } from "./MarkdownPane";
import NoteBrowserModal from "./NoteBrowserModal";
import { IconPlus, IconTrash, IconX } from "./icons";

// How long a vault index stays usable before a refresh is worth doing. Only
// ever checked when the window regains focus, so this is "was it fetched
// recently enough that re-walking the vault would be wasted work", not a
// polling interval.
const INDEX_TTL_MS = 60_000;

function groupByVault(
  vaults: VaultConfig[],
  notes: NoteNavItem[]
): { vault: VaultConfig; notes: NoteNavItem[] }[] {
  return vaults.map((vault) => ({
    vault,
    notes: notes.filter((n) => n.vaultLabel === vault.label),
  }));
}

interface NotesWidgetProps {
  // Pushed up to App.tsx so the command palette can list pinned notes
  // without lifting this widget's whole state — same pattern SettingsPage
  // uses for processConfigs.
  onNavChange?: (notes: NoteNavItem[]) => void;
  // A note the palette asked to open. Cleared via onPendingOpenHandled once
  // acted on, so asking twice for the same note still works.
  pendingOpen?: NoteNavItem | null;
  onPendingOpenHandled?: () => void;
}

export default function NotesWidget({
  onNavChange,
  pendingOpen,
  onPendingOpenHandled,
}: NotesWidgetProps = {}) {
  const [vaults, setVaults] = useState<VaultConfig[]>([]);
  const [navNotes, setNavNotesState] = useState<NoteNavItem[]>([]);
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [contents, setContents] = useState<Record<number, string>>({});
  const [noteErrors, setNoteErrors] = useState<Record<number, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<ViewMode>("edit");
  const [browserVault, setBrowserVault] = useState<string | null>(null);
  const [vaultIndexes, setVaultIndexes] = useState<Record<string, VaultNoteIndexEntry[]>>({});
  // Last-modified time each open note was last read or written at, keyed by
  // nav id. This is the baseline saveNoteFile compares against, which is what
  // stops an autosave silently overwriting an edit made in Obsidian.
  const mtimes = useRef<Record<number, number | undefined>>({});
  const [conflicts, setConflicts] = useState<Record<number, string>>({});
  // vaultLabel → when its index was last fetched, so it can go stale and be
  // refreshed rather than being cached for the whole session.
  const indexFetchedAt = useRef<Map<string, number>>(new Map());

  // Every nav mutation goes through here so App.tsx (and therefore the
  // command palette) never sees a stale list.
  const onNavChangeRef = useRef(onNavChange);
  onNavChangeRef.current = onNavChange;
  const setNavNotes = useCallback((notes: NoteNavItem[]) => {
    setNavNotesState(notes);
    onNavChangeRef.current?.(notes);
  }, []);

  // Keyed by nav id, so each open note debounces independently. The lookup
  // reads `navNotes` fresh on every save (useAutosave keeps this callback in
  // a ref) — a note removed from the nav mid-debounce just no-ops rather than
  // writing through a stale vault/path pair.
  const autosave = useAutosave<number>(async (id, text) => {
    const item = navNotes.find((n) => n.id === id);
    if (!item) return;
    const result = await window.api.notes.save(
      item.vaultLabel,
      item.filePath,
      text,
      mtimes.current[id]
    );
    if (result.ok) {
      mtimes.current[id] = result.mtimeMs;
      setConflicts((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else if (result.conflict) {
      // Nothing was written. The buffer keeps the user's text; the banner
      // lets them reload or force the write.
      setConflicts((prev) => ({ ...prev, [id]: result.reason || "That note changed on disk" }));
    }
  });

  const loadNoteContent = useCallback(async (item: NoteNavItem) => {
    const result = await window.api.notes.read(item.vaultLabel, item.filePath);
    if (result.ok) {
      mtimes.current[item.id] = result.mtimeMs;
      setContents((prev) => ({ ...prev, [item.id]: result.content }));
    } else {
      setNoteErrors((prev) => ({ ...prev, [item.id]: result.reason || "Couldn't read note" }));
    }
  }, []);

  const ensureVaultIndex = useCallback((vaultLabel: string, force = false) => {
    const last = indexFetchedAt.current.get(vaultLabel);
    if (!force && last !== undefined) return;
    if (force && last !== undefined && Date.now() - last < INDEX_TTL_MS) return;
    indexFetchedAt.current.set(vaultLabel, Date.now());
    window.api.notes.index(vaultLabel).then((result) => {
      setVaultIndexes((prev) => ({ ...prev, [vaultLabel]: result.ok ? result.entries : [] }));
    });
  }, []);

  // Resolves a [[wikilink]] target against the given vault's index — tries
  // an exact path match first (lets "[[Folder/Note]]" disambiguate by hand),
  // then falls back to a basename match. Entries come back sorted by path
  // from buildVaultIndex, so "first match" is a deterministic tie-break for
  // duplicate basenames in different folders, not just filesystem order.
  const resolveWikilink = useCallback(
    (vaultLabel: string, target: string): ResolvedWikilink | null => {
      const entries = vaultIndexes[vaultLabel];
      if (!entries) return null;
      const normalized = target.replace(/\.md$/i, "").toLowerCase();
      const byPath = entries.find((e) => e.path.replace(/\.md$/i, "").toLowerCase() === normalized);
      if (byPath) return { filePath: byPath.path, label: byPath.basename };
      const byName = entries.find((e) => e.basename.toLowerCase() === normalized);
      if (byName) return { filePath: byName.path, label: byName.basename };
      return null;
    },
    [vaultIndexes]
  );

  useEffect(() => {
    (async () => {
      const [vaultList, nav, session] = await Promise.all([
        window.api.notes.vaults(),
        window.api.notes.nav.list(),
        window.api.notes.session.get(),
      ]);
      setVaults(vaultList);
      setNavNotes(nav);

      const validOpenIds = session.openNoteIds.filter((id) => nav.some((n) => n.id === id));
      setOpenIds(validOpenIds);
      const initialActiveId =
        session.activeNoteId && validOpenIds.includes(session.activeNoteId)
          ? session.activeNoteId
          : (validOpenIds[validOpenIds.length - 1] ?? null);
      setActiveId(initialActiveId);

      const openItems = validOpenIds
        .map((id) => nav.find((n) => n.id === id))
        .filter((n): n is NoteNavItem => !!n);
      await Promise.all(openItems.map(loadNoteContent));
      openItems.forEach((item) => ensureVaultIndex(item.vaultLabel));

      setLoaded(true);
    })();
  }, [loadNoteContent, ensureVaultIndex, setNavNotes]);

  // The command palette asks to open a note by handing one down rather than
  // reaching into this widget's state, which stays deliberately unlifted.
  // Only runs once the widget has loaded, so a palette action taken before
  // then still lands rather than being dropped.
  useEffect(() => {
    if (!pendingOpen || !loaded) return;
    void openNote(pendingOpen);
    onPendingOpenHandled?.();
    // openNote is redefined each render but always closes over current
    // state; keying on the request itself is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, loaded]);

  // These files are edited in real Obsidian too, so the app has to notice
  // when that happens. Checking on window focus rather than watching the
  // filesystem: the realistic sequence is that you tab away to Obsidian and
  // come back, so refocus is the right granularity — and fs.watch on macOS
  // is FSEvents-backed and directory-granular, so Obsidian's atomic
  // write-temp-then-rename saves leave the watched inode stale and need
  // re-arming on every event. The mtime guard in saveNoteFile is what
  // actually prevents data loss; this only controls how soon you find out.
  // Depend on the individual callback rather than the whole handle: the hook
  // returns a fresh object each render, so `autosave` as a dep would tear
  // down and re-add these listeners on every keystroke. isPending is
  // useCallback-stable.
  const { isPending } = autosave;
  useEffect(() => {
    async function checkForExternalChanges() {
      const open = openIds
        .map((id) => navNotes.find((n) => n.id === id))
        .filter((n): n is NoteNavItem => !!n);
      if (open.length === 0) return;

      open.forEach((item) => ensureVaultIndex(item.vaultLabel, true));

      const result = await window.api.notes.statMany(
        open.map(({ vaultLabel, filePath }) => ({ vaultLabel, filePath }))
      );
      if (!result.ok) return;

      for (const entry of result.entries) {
        const item = open.find(
          (n) => n.vaultLabel === entry.vaultLabel && n.filePath === entry.filePath
        );
        if (!item || entry.mtimeMs === null) continue;
        const known = mtimes.current[item.id];
        if (known === undefined || entry.mtimeMs <= known) continue;

        if (isPending(item.id)) {
          // Local edits not yet written — reloading would throw them away,
          // so surface the choice instead of picking one.
          setConflicts((prev) => ({ ...prev, [item.id]: "That note changed on disk" }));
        } else {
          // Buffer is clean, so there's nothing to lose: just take the newer
          // version. MarkdownEditor's externalSync annotation keeps this from
          // echoing straight back out as a save.
          void loadNoteContent(item);
        }
      }
    }

    const onFocus = () => void checkForExternalChanges();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [openIds, navNotes, ensureVaultIndex, loadNoteContent, isPending]);

  // "Reload from disk" — drop the local buffer and take the file's version.
  async function resolveConflictByReload(item: NoteNavItem) {
    autosave.cancel(item.id);
    setConflicts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    await loadNoteContent(item);
  }

  // "Keep mine" — write the buffer over whatever's on disk. Saves without a
  // baseline, which is what makes saveNoteFile skip the mtime check.
  async function resolveConflictByOverwrite(item: NoteNavItem) {
    autosave.cancel(item.id);
    const result = await window.api.notes.save(
      item.vaultLabel,
      item.filePath,
      contents[item.id] ?? ""
    );
    if (result.ok) mtimes.current[item.id] = result.mtimeMs;
    setConflicts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }

  async function openNote(item: NoteNavItem) {
    const nextOpenIds = openIds.includes(item.id) ? openIds : [...openIds, item.id];
    setOpenIds(nextOpenIds);
    setActiveId(item.id);
    ensureVaultIndex(item.vaultLabel);
    await window.api.notes.session.set(nextOpenIds, item.id);
    if (!(item.id in contents) && !(item.id in noteErrors)) {
      await loadNoteContent(item);
    }
  }

  async function closeTab(id: number) {
    // Write any queued edit before the tab goes away, so closing a tab
    // straight after typing can't lose the last keystrokes.
    await autosave.flush(id);
    const remaining = openIds.filter((n) => n !== id);
    const nextActive = activeId === id ? (remaining[remaining.length - 1] ?? null) : activeId;
    setOpenIds(remaining);
    setActiveId(nextActive);
    await window.api.notes.session.set(remaining, nextActive);
  }

  async function removeFromNav(id: number) {
    // Same as closeTab — the file stays on disk, so a queued edit still
    // belongs in it. Flush before the nav row (and its vault/path) is gone.
    await autosave.flush(id);
    const updatedNav = await window.api.notes.nav.remove(id);
    setNavNotes(updatedNav);

    const remaining = openIds.filter((n) => n !== id);
    setOpenIds(remaining);
    if (activeId === id) setActiveId(remaining[remaining.length - 1] ?? null);

    setContents((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setNoteErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // Pins (if not already pinned) and opens a note by vault+path — shared by
  // the file-browser "pick" flow and clicking a resolved wikilink.
  async function openByPath(vaultLabel: string, filePath: string, label: string) {
    const updatedNav = await window.api.notes.nav.add(vaultLabel, filePath, label);
    setNavNotes(updatedNav);
    const item = updatedNav.find((n) => n.vaultLabel === vaultLabel && n.filePath === filePath);
    if (item) await openNote(item);
  }

  async function handlePick(filePath: string, label: string) {
    const vaultLabel = browserVault;
    setBrowserVault(null);
    if (!vaultLabel) return;
    await openByPath(vaultLabel, filePath, label);
  }

  function handleContentChange(item: NoteNavItem, text: string) {
    setContents((prev) => ({ ...prev, [item.id]: text }));
    autosave.schedule(item.id, text);
  }

  if (!loaded) {
    return (
      <Panel title="Notes">
        <p className="muted">Loading notes…</p>
      </Panel>
    );
  }

  const groups = groupByVault(vaults, navNotes);
  const activeItem = navNotes.find((n) => n.id === activeId) ?? null;
  const activeError = activeItem ? noteErrors[activeItem.id] : undefined;

  return (
    <Panel title="Notes">
      <div className="notes-layout">
        <nav className="notes-nav">
          {vaults.length === 0 ? (
            <p className="muted">No vaults configured. Add one in Settings.</p>
          ) : (
            groups.map(({ vault, notes }) => (
              <div className="notes-nav-group" key={vault.label}>
                <div className="notes-nav-group-head">
                  <h3 className="todoist-group-title">{vault.label}</h3>
                  <button
                    className="notes-nav-add"
                    title={`Add or create a note in ${vault.label}`}
                    onClick={() => setBrowserVault(vault.label)}
                  >
                    <IconPlus size={11} />
                  </button>
                </div>
                {notes.length === 0 ? (
                  <p className="muted notes-nav-empty">No notes added.</p>
                ) : (
                  notes.map((item) => (
                    <div
                      key={item.id}
                      className={`notes-nav-item ${item.id === activeId ? "active" : ""}`}
                      onClick={() => openNote(item)}
                    >
                      <span className="notes-nav-item-label">{item.label}</span>
                      <div className="row-actions">
                        <button
                          className="row-action danger"
                          title="Remove from nav (keeps the file)"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromNav(item.id);
                          }}
                        >
                          <IconTrash size={11} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </nav>

        <div className="notes-main">
          {!activeItem ? (
            <p className="muted notes-empty">Pick a note from the left to get started.</p>
          ) : (
            <>
              <div className="notes-tabstrip">
                {openIds.map((id) => {
                  const item = navNotes.find((n) => n.id === id);
                  if (!item) return null;
                  return (
                    <div
                      key={id}
                      className={`notes-tab ${id === activeId ? "active" : ""}`}
                      onClick={() => {
                        setActiveId(id);
                        window.api.notes.session.set(openIds, id);
                      }}
                    >
                      <span>{item.label}</span>
                      <button
                        className="notes-tab-close"
                        title="Close tab"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(id);
                        }}
                      >
                        <IconX size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <MarkdownPaneToolbar
                mode={mode}
                onModeChange={setMode}
                saving={autosave.savingKey === activeItem.id}
                value={contents[activeItem.id] ?? ""}
                showStatus={!activeError}
                className="notes-toolbar"
              />

              {activeError ? (
                <p className="muted notes-empty">{activeError}</p>
              ) : (
                <MarkdownPane
                  mode={mode}
                  value={contents[activeItem.id] ?? ""}
                  onChange={(text) => handleContentChange(activeItem, text)}
                  docKey={activeItem.id}
                  vaultIndex={vaultIndexes[activeItem.vaultLabel]}
                  conflict={
                    conflicts[activeItem.id]
                      ? {
                          message: conflicts[activeItem.id],
                          onReload: () => void resolveConflictByReload(activeItem),
                          onOverwrite: () => void resolveConflictByOverwrite(activeItem),
                        }
                      : null
                  }
                  resolveWikilink={(target) => resolveWikilink(activeItem.vaultLabel, target)}
                  onOpenWikilink={(filePath, label) =>
                    openByPath(activeItem.vaultLabel, filePath, label)
                  }
                />
              )}
            </>
          )}
        </div>
      </div>

      {browserVault && (
        <NoteBrowserModal
          vaultLabel={browserVault}
          onClose={() => setBrowserVault(null)}
          onPick={handlePick}
        />
      )}
    </Panel>
  );
}
