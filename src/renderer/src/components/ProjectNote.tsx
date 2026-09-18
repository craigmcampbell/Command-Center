import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectInput } from "../../../shared/types";
import { useAutosave } from "../hooks/useAutosave";
import MarkdownPane, { MarkdownPaneToolbar, type ViewMode } from "./MarkdownPane";

export default function ProjectNote({ note, visible }: { note: NonNullable<ProjectInput["note"]>; visible: boolean }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [mode, setMode] = useState<ViewMode>("preview");
  const [expanded, setExpanded] = useState(false);
  const mtime = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const version = useRef(0);
  const queue = useRef(Promise.resolve());
  const currentContent = useRef("");
  const blocked = useRef(false);
  const key = `${note.vaultLabel}/${note.filePath}`;
  const load = useCallback(async () => {
    const result = await window.api.notes.read(note.vaultLabel, note.filePath);
    if (result.ok) {
      setContent(result.content); currentContent.current = result.content;
      mtime.current = result.mtimeMs; dirty.current = false; blocked.current = false; setError(""); setConflict(false);
    } else setError(result.reason || "Unable to read note.");
  }, [note.vaultLabel, note.filePath]);
  const save = (text: string, force = false) => {
    const savingVersion = version.current;
    queue.current = queue.current.then(async () => {
      if (blocked.current && !force) return;
      try {
        const result = await window.api.notes.save(note.vaultLabel, note.filePath, text, force ? undefined : mtime.current);
        if (result.ok) {
          mtime.current = result.mtimeMs;
          if (version.current === savingVersion) dirty.current = false;
          blocked.current = false; setError(""); setConflict(false);
        } else {
          blocked.current = true; setError(result.reason || "Unable to save note."); setConflict(!!result.conflict);
        }
      } catch (e) { blocked.current = true; setError(String(e)); }
    });
    return queue.current;
  };
  const autosave = useAutosave<string>((_, text) => save(text));
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!visible) { void autosave.flush(); setExpanded(false); return; }
    const check = async () => {
      await queue.current;
      const result = await window.api.notes.statMany([note]);
      const modified = result.ok ? result.entries[0]?.mtimeMs : null;
      if (modified != null && mtime.current != null && modified !== mtime.current) {
        if (dirty.current) { blocked.current = true; setConflict(true); setError("This note changed on disk. Your edits are preserved here."); }
        else await load();
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [visible, load, note, autosave.flush]);
  const close = useCallback(() => { void autosave.flush(); setExpanded(false); }, [autosave.flush]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [expanded, close]);
  const change = (text: string) => { version.current++; dirty.current = true; currentContent.current = text; setContent(text); autosave.schedule(key, text); };
  const openInObsidian = async () => {
    try {
      const vault = (await window.api.notes.vaults()).find(v => v.label === note.vaultLabel);
      if (!vault) throw new Error("This vault is no longer configured.");
      const vaultName = vault.path.split(/[\\/]/).filter(Boolean).at(-1)!;
      await window.api.openUrl(`obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(note.filePath)}`);
    } catch (e) { setError(String(e)); }
  };
  const body = <>
    <div className="project-note-heading"><div><h3 className="project-section-title">Project note</h3><span className="project-note-path muted">{note.filePath}</span></div><button onClick={() => void openInObsidian()}>Open in Obsidian</button>{expanded && <button onClick={close}>Close</button>}</div>
    {error && <p role="alert" className="error">{error}{!conflict && <button onClick={() => dirty.current ? (blocked.current = false, void save(currentContent.current, false)) : void load()}>Retry</button>}</p>}
    {content === null ? <p className="muted">{error ? "Note unavailable." : "Loading note…"}</p> : <>
      <MarkdownPaneToolbar mode={mode} onModeChange={setMode} saving={autosave.savingKey !== null} showStatus={!error} onExpand={expanded ? undefined : () => setExpanded(true)} />
      <MarkdownPane mode={mode} value={content} onChange={change} docKey={key} conflict={conflict ? {
        message: error,
        onReload: () => { autosave.cancel(); void queue.current.then(load); },
        onOverwrite: () => { autosave.cancel(); void save(currentContent.current, true); },
      } : null} />
    </>}
  </>;
  return <div hidden={!visible && !error} className="project-note">
    {expanded ? <div className="settings-scrim" onClick={e => { if (e.currentTarget === e.target) close(); }}><div className="md-expand-panel project-note-expanded" role="dialog" aria-modal="true" aria-label={note.filePath}>{body}</div></div> : body}
  </div>;
}
