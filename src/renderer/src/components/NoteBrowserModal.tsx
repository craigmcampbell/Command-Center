import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { NoteBrowseResult } from "../../../shared/types";
import { IconFolder, IconNote, IconX } from "./icons";

interface NoteBrowserModalProps {
  vaultLabel: string;
  onClose: () => void;
  onPick: (filePath: string, label: string) => void;
}

// Always opens at the vault root — no per-vault "last folder" memory for v1.
export default function NoteBrowserModal({ vaultLabel, onClose, onPick }: NoteBrowserModalProps) {
  const [subPath, setSubPath] = useState("");
  const [result, setResult] = useState<NoteBrowseResult | null>(null);

  const load = useCallback(
    async (nextPath: string) => {
      setResult(await window.api.notes.browse(vaultLabel, nextPath));
    },
    [vaultLabel]
  );

  useEffect(() => {
    load(subPath);
  }, [subPath, load]);

  function handleScrimClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
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
      </div>
    </div>
  );
}
