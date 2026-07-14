import { useCallback, useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { NoteBrowseResult, TemplateEntry } from "../../../shared/types";
import { IconFolder, IconNote, IconPlus, IconX } from "./icons";

interface NoteBrowserModalProps {
  vaultLabel: string;
  onClose: () => void;
  onPick: (filePath: string, label: string) => void;
}

// Always opens at the vault root — no per-vault "last folder" memory for v1.
// Doubles as the "create a new note" flow: the same folder browser picks the
// destination, and a successful create hands off to the same onPick callback
// used for an existing file, so the caller can't tell the two apart.
export default function NoteBrowserModal({ vaultLabel, onClose, onPick }: NoteBrowserModalProps) {
  const [subPath, setSubPath] = useState("");
  const [result, setResult] = useState<NoteBrowseResult | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [templateChoice, setTemplateChoice] = useState("");

  const load = useCallback(
    async (nextPath: string) => {
      setResult(await window.api.notes.browse(vaultLabel, nextPath));
    },
    [vaultLabel]
  );

  useEffect(() => {
    load(subPath);
  }, [subPath, load]);

  // Fetched once per modal open, not tied to the browsed subPath — a chosen
  // template stays selected as the user navigates to pick a destination
  // folder.
  useEffect(() => {
    window.api.notes.templates(vaultLabel).then((result) => {
      setTemplates(result.ok ? result.templates : []);
    });
  }, [vaultLabel]);

  // Switching folders invalidates any in-progress "name already exists" error
  // and clears the draft name — a name that collided in one folder is fine
  // in another.
  useEffect(() => {
    setCreateError(null);
  }, [subPath]);

  function handleScrimClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    const result = await window.api.notes.create(vaultLabel, subPath, newName, templateChoice || null);
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.reason || "Couldn't create that note");
      return;
    }
    onPick(result.filePath, newName.trim().replace(/\.md$/i, ""));
  }

  const crumbs = subPath ? subPath.split("/") : [];

  return (
    <div className="notes-browser-scrim" onClick={handleScrimClick}>
      <div className="notes-browser" role="dialog" aria-modal="true" aria-label={`Browse ${vaultLabel}`}>
        <div className="notes-browser-head">
          <h3>{vaultLabel}</h3>
          <button className="notes-browser-close" onClick={onClose} title="Close">
            <IconX />
          </button>
        </div>

        <div className="notes-browser-crumbs">
          <button className="notes-crumb" onClick={() => setSubPath("")}>
            {vaultLabel}
          </button>
          {crumbs.map((crumb, i) => (
            <span key={i}>
              <span className="notes-crumb-sep">/</span>
              <button
                className="notes-crumb"
                onClick={() => setSubPath(crumbs.slice(0, i + 1).join("/"))}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>

        <div className="notes-browser-list">
          {!result ? (
            <p className="muted">Loading…</p>
          ) : !result.ok ? (
            <p className="muted">{result.reason}.</p>
          ) : result.folders.length === 0 && result.files.length === 0 ? (
            <p className="muted">Empty folder.</p>
          ) : (
            <>
              {result.folders.map((folder) => (
                <div
                  key={folder.path}
                  className="notes-browser-row"
                  onClick={() => setSubPath(folder.path)}
                >
                  <IconFolder />
                  {folder.name}
                </div>
              ))}
              {result.files.map((file) => (
                <div
                  key={file.path}
                  className="notes-browser-row"
                  onClick={() => onPick(file.path, file.name.replace(/\.md$/i, ""))}
                >
                  <IconNote />
                  {file.name}
                </div>
              ))}
            </>
          )}
        </div>

        <form className="notes-browser-create" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder={`New note in ${subPath || vaultLabel}…`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          {templates.length > 0 && (
            <select
              value={templateChoice}
              onChange={(e) => setTemplateChoice(e.target.value)}
              title="Start from a template"
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" disabled={!newName.trim() || creating} title="Create note here">
            <IconPlus size={12} />
          </button>
          {createError && <p className="notes-browser-create-error">{createError}</p>}
        </form>
      </div>
    </div>
  );
}
