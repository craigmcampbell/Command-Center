// Remembers the dashboard window's size and position across launches.
//
// Persisted to the settings DB rather than a JSON file so it travels with the
// rest of the app's state (and gets picked up by services/backup.ts for free).

import { BrowserWindow, screen } from "electron";
import { getWindowSettings, updateWindowSettings } from "./settings";
import type { WindowState } from "../../shared/types";

const SAVE_DEBOUNCE_MS = 400;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 860;

let timer: ReturnType<typeof setTimeout> | undefined;
let tracked: BrowserWindow | null = null;

// A saved rectangle is only usable if it still overlaps a display that exists
// now. Restoring onto a monitor that's since been disconnected puts the window
// somewhere invisible, which reads as "the app didn't launch".
function isOnSomeDisplay(state: WindowState): boolean {
  if (state.x == null || state.y == null || state.width == null || state.height == null) {
    return false;
  }
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapsX = state.x! < a.x + a.width && state.x! + state.width! > a.x;
    const overlapsY = state.y! < a.y + a.height && state.y! + state.height! > a.y;
    return overlapsX && overlapsY;
  });
}

export function restoreBounds(): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
  fullscreen: boolean;
} {
  const saved = getWindowSettings();

  // Clamped, so a hand-edited or corrupted row can't produce a window too
  // small to use.
  const width = Math.max(MIN_WIDTH, saved.width ?? DEFAULT_WIDTH);
  const height = Math.max(MIN_HEIGHT, saved.height ?? DEFAULT_HEIGHT);

  // Dropping x/y lets Electron centre the window, which is the right fallback
  // for both "never saved" and "saved off-screen".
  const position = isOnSomeDisplay(saved) ? { x: saved.x, y: saved.y } : {};

  return {
    width,
    height,
    ...position,
    maximized: saved.maximized === true,
    fullscreen: saved.fullscreen === true,
  };
}

function persist(): void {
  if (!tracked || tracked.isDestroyed()) return;
  // getNormalBounds(), NOT getBounds(): while maximized the latter returns the
  // maximized rectangle, so we'd persist that as the restore size and
  // un-maximizing later would snap to a full-screen-sized window instead of
  // whatever the user had actually chosen.
  const { x, y, width, height } = tracked.getNormalBounds();
  updateWindowSettings({
    x,
    y,
    width,
    height,
    maximized: tracked.isMaximized(),
    fullscreen: tracked.isFullScreen(),
  });
}

export function trackWindow(win: BrowserWindow): void {
  tracked = win;
  // `resize` fires continuously through a drag and each save is a synchronous
  // SQLite write, so coalesce them.
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, SAVE_DEBOUNCE_MS);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("enter-full-screen", schedule);
  win.on("leave-full-screen", schedule);
}

// Called from before-quit: close hides rather than destroys, so there's no
// reliable close event to save on, and a pending debounce would be lost.
export function flushWindowState(): void {
  clearTimeout(timer);
  persist();
}
