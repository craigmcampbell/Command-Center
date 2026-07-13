import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteNavItem, VaultConfig } from "../../../shared/types";
import { renderMarkdown } from "../lib/markdown";
import Panel from "./Panel";
import MarkdownEditor from "./MarkdownEditor";
import NoteBrowserModal from "./NoteBrowserModal";
import { IconPlus, IconTrash, IconX } from "./icons";

type ViewMode = "edit" | "split" | "preview";

const AUTOSAVE_MS = 500;

function groupByVault(
  vaults: VaultConfig[],
  notes: NoteNavItem[]
): { vault: VaultConfig; notes: NoteNavItem[] }[] {
  return vaults.map((vault) => ({
    vault,
    notes: notes.filter((n) => n.vaultLabel === vault.label),
  }));
}

export default function NotesWidget() {
  const [vaults, setVaults] = useState<VaultConfig[]>([]);
  const [navNotes, setNavNotes] = useState<NoteNavItem[]>([]);
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [contents, setContents] = useState<Record<number, string>>({});
  const [noteErrors, setNoteErrors] = useState<Record<number, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<ViewMode>("split");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [browserVault, setBrowserVault] = useState<string | null>(null);
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const loadNoteContent = useCallback(async (item: NoteNavItem) => {
    const result = await window.api.notes.read(item.vaultLabel, item.filePath);
    if (result.ok) {
      setContents((prev) => ({ ...prev, [item.id]: result.content }));
    } else {
      setNoteErrors((prev) => ({ ...prev, [item.id]: result.reason || "Couldn't read note" }));
    }
  }, []);

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

      setLoaded(true);
    })();
  }, [loadNoteContent]);

  // Pending debounced saves are cancelled on unmount (same tradeoff as
  // ScratchpadWidget) — switching tabs within the debounce window drops
  // that last edit rather than saving it.
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, []);

  async function openNote(item: NoteNavItem) {
    const nextOpenIds = openIds.includes(item.id) ? openIds : [...openIds, item.id];
    setOpenIds(nextOpenIds);
    setActiveId(item.id);
    await window.api.notes.session.set(nextOpenIds, item.id);
    if (!(item.id in contents) && !(item.id in noteErrors)) {
      await loadNoteContent(item);
    }
  }

  async function closeTab(id: number) {
    const remaining = openIds.filter((n) => n !== id);
    const nextActive = activeId === id ? (remaining[remaining.length - 1] ?? null) : activeId;
    setOpenIds(remaining);
    setActiveId(nextActive);
    await window.api.notes.session.set(remaining, nextActive);
  }

  async function removeFromNav(id: number) {
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

  async function handlePick(filePath: string, label: string) {
    const vaultLabel = browserVault;
    setBrowserVault(null);
    if (!vaultLabel) return;

    const updatedNav = await window.api.notes.nav.add(vaultLabel, filePath, label);
    setNavNotes(updatedNav);
    const item = updatedNav.find((n) => n.vaultLabel === vaultLabel && n.filePath === filePath);
    if (item) await openNote(item);
  }

  function handleContentChange(item: NoteNavItem, text: string) {
    setContents((prev) => ({ ...prev, [item.id]: text }));
    if (saveTimers.current[item.id]) clearTimeout(saveTimers.current[item.id]);
    saveTimers.current[item.id] = setTimeout(async () => {
      setSavingId(item.id);
      await window.api.notes.save(item.vaultLabel, item.filePath, text);
      setSavingId((cur) => (cur === item.id ? null : cur));
    }, AUTOSAVE_MS);
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
  const showEditor = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <Panel title="Notes">
      <div className="notes-layout">
        <nav className="notes-nav">
          {vaults.length === 0 ? (
            <p className="muted">No vaults configured in config.json.</p>
          ) : (
            groups.map(({ vault, notes }) => (
              <div className="notes-nav-group" key={vault.label}>
                <div className="notes-nav-group-head">
                  <h3 className="todoist-group-title">{vault.label}</h3>
                  <button
                    className="notes-nav-add"
                    title={`Add a note from ${vault.label}`}
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

              <div className="notes-toolbar">
                <div className="scratchpad-modes">
                  {(["edit", "split", "preview"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`scratchpad-mode ${mode === m ? "active" : ""}`}
                      onClick={() => setMode(m)}
                    >
                      {m === "edit" ? "Write" : m === "split" ? "Split" : "Preview"}
                    </button>
                  ))}
                </div>
                {!activeError && (
                  <span className="scratchpad-status">
                    {savingId === activeItem.id ? "Saving…" : "Saved"}
                  </span>
                )}
              </div>

              {activeError ? (
                <p className="muted notes-empty">{activeError}</p>
              ) : (
                <div className={`scratchpad ${mode}`}>
                  {showEditor && (
                    <MarkdownEditor
                      key={activeItem.id}
                      className="scratchpad-editor"
                      value={contents[activeItem.id] ?? ""}
                      onChange={(text) => handleContentChange(activeItem, text)}
                    />
                  )}
                  {showPreview && (
                    <div
                      className="scratchpad-preview note"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(contents[activeItem.id] ?? ""),
                      }}
                    />
                  )}
                </div>
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
