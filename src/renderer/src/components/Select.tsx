// Themed replacement for native <select>. On macOS, Chromium hands the open
// <select> popup off to the OS to render — no amount of CSS reskins it, only
// the closed box. This renders its own portaled popup instead, sharing the
// .dropdown-menu/.dropdown-option visual language (and the portal +
// outside-click/scroll-close mechanics) that YNAB's CategoryPicker/
// PayeePicker comboboxes already established in YnabUnapprovedWidget.tsx.
// Unlike those, this is a plain pick-one control with no search input, so
// the trigger is a button rather than a text field.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "./icons";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  // Shown on the trigger when `value` matches no option. Shouldn't come up
  // in practice — every call site's options list includes the current
  // value — but keeps the trigger from silently rendering blank if it ever
  // doesn't, rather than failing invisibly.
  placeholder?: string;
}

export default function Select({
  value,
  options,
  onChange,
  className,
  disabled,
  title,
  placeholder = "Select…",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : placeholder;

  function openDropdown() {
    if (disabled || options.length === 0) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setHighlighted(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  // Same portal + outside-click/scroll-close mechanics as CategoryPicker/
  // PayeePicker: rendered outside any scrolling ancestor via a portal, so a
  // fixed-position rect is invalidated by closing on scroll rather than
  // tracked through it.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  // Keeps the keyboard-highlighted option in view without needing a ref per
  // row — a single querySelector off the (small) open dropdown is cheap.
  useEffect(() => {
    if (!open) return;
    dropdownRef.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function commit(index: number) {
    const opt = options[index];
    if (!opt) return;
    setOpen(false);
    if (opt.value !== value) onChange(opt.value);
    triggerRef.current?.focus();
  }

  // Mirrors native <select> keyboard behavior: closed + Down/Up/Enter/Space
  // opens it; open, those same keys move the highlight or commit it, Escape
  // backs out without changing the value.
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(highlighted);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger ${open ? "open" : ""} ${className ?? ""}`}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dropdown-trigger-label">{selectedLabel}</span>
        <IconChevronDown size={12} className="dropdown-trigger-chevron" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            className="dropdown-menu"
            ref={dropdownRef}
            role="listbox"
            style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
          >
            {options.length === 0 ? (
              <div className="dropdown-empty">No options</div>
            ) : (
              options.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  data-index={i}
                  className={`dropdown-option ${opt.value === value ? "selected" : ""} ${
                    i === highlighted ? "highlighted" : ""
                  }`}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => commit(i)}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>,
          document.body
        )}
    </>
  );
}
