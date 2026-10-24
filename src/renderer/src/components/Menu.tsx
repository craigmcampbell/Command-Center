import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown } from "./icons";

// A small dropdown menu: a trigger button and a popover list. Used by the
// Assistant header and its "save to" actions.
//
// The popover is `position: fixed`, placed from the trigger's rectangle, so no
// scrolling or overflow-hidden ancestor (the chat log, the panel) can clip it,
// and it flips above the trigger when there is no room below. It closes on an
// outside press, Escape, a selection, or any scroll/resize (a fixed popover
// would otherwise be left floating where the trigger used to be).

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  // A toggle: shows a check when on.
  checked?: boolean;
  disabled?: boolean;
  // Drawn as a divider above this item.
  separatorBefore?: boolean;
}

interface MenuProps {
  // The trigger's content. A caret is added unless `bare`.
  label: ReactNode;
  items: MenuItem[];
  // Which edge of the trigger the menu lines up with.
  align?: "left" | "right";
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
  // Icon-only triggers drop the caret.
  bare?: boolean;
}

const GAP = 4;
const EDGE = 8;

export default function Menu({
  label,
  items,
  align = "left",
  disabled,
  title,
  ariaLabel,
  className,
  bare,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const close = useCallback(() => setOpen(false), []);

  // Positioned before paint so the menu never flashes in the wrong place.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = listRef.current?.offsetHeight ?? 160;
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const vertical =
      below >= menuHeight || rect.top < menuHeight
        ? { top: rect.bottom + GAP }
        : { bottom: window.innerHeight - rect.top + GAP };
    setPos({
      ...vertical,
      ...(align === "right"
        ? { right: Math.max(EDGE, window.innerWidth - rect.right) }
        : { left: Math.max(EDGE, rect.left) }),
    });
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) return;
    const onPress = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !listRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  // Focus the first usable item when opened from the keyboard or mouse.
  useEffect(() => {
    if (open && pos)
      listRef.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }, [open, pos]);

  function onListKeyDown(e: React.KeyboardEvent) {
    if (
      e.key !== "ArrowDown" &&
      e.key !== "ArrowUp" &&
      e.key !== "Home" &&
      e.key !== "End"
    )
      return;
    e.preventDefault();
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next].focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`menu-trigger${className ? ` ${className}` : ""}${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setPos(null);
            setOpen(true);
          }
        }}
      >
        {label}
        {!bare && <IconChevronDown size={11} />}
      </button>
      {open &&
        // In a portal on <body>, so an ancestor with a transform or filter can
        // never turn `position: fixed` into something relative to itself.
        createPortal(
          <ul
            ref={listRef}
            id={id}
            role="menu"
            className="menu-list"
            style={{ ...(pos ?? {}), visibility: pos ? "visible" : "hidden" }}
            onKeyDown={onListKeyDown}
          >
            {items.map((item) => (
              <li
                key={item.key}
                role="none"
                className={
                  item.separatorBefore ? "menu-separator-before" : undefined
                }
              >
                <button
                  type="button"
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                  }
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  className="menu-item"
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  <span className="menu-check">
                    {item.checked ? <IconCheck size={11} /> : null}
                  </span>
                  <span className="menu-label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
