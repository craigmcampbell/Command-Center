import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconX } from "./icons";

// A larger view of an image from the transcript: a dimmed overlay with the
// picture fitted to the window. Closes on Escape, a click on the backdrop, or
// the close button. "Save image…" only appears for a stored attachment (its id
// is the file's content hash); a picture just sent from this window is still
// keyed locally until the chat is reopened.

const STORED_ID = /^[a-f0-9]{64}$/;

interface ImageViewerProps {
  src: string;
  name: string;
  id: string;
  onClose: () => void;
}

export default function ImageViewer({
  src,
  name,
  id,
  onClose,
}: ImageViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    // Capture phase, so Escape closes the viewer rather than something under it.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  async function save() {
    const result = await window.api.assistant.saveAttachment(id, name);
    setNote(
      result.ok
        ? "Saved"
        : result.cancelled
          ? null
          : (result.reason ?? "Couldn't save"),
    );
  }

  return createPortal(
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onMouseDown={onClose}
    >
      <div
        className="image-viewer-bar"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="image-viewer-name" title={name}>
          {name}
        </span>
        {note && <span className="muted">{note}</span>}
        {STORED_ID.test(id) && (
          <button
            type="button"
            className="image-viewer-button"
            onClick={() => void save()}
          >
            Save image…
          </button>
        )}
        <button
          ref={closeRef}
          type="button"
          className="image-viewer-button"
          onClick={onClose}
          aria-label="Close image"
        >
          <IconX size={13} />
        </button>
      </div>
      <img
        className="image-viewer-image"
        src={src}
        alt={name}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
