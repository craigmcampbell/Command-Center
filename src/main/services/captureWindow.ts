// The quick-capture panel: a small frameless window summoned by a global
// hotkey from anywhere on the system.
//
// Created once and hidden/shown rather than built per invocation — the entire
// point is that it appears instantly, and constructing a BrowserWindow plus
// loading a renderer takes long enough to feel like a lag every single time.

import { app, BrowserWindow, globalShortcut, screen } from "electron";
import path from "node:path";
import type { CaptureHotkeyStatus } from "../../shared/types";
import { validateAccelerator } from "../../shared/accelerator";

const WIDTH = 620;
const HEIGHT = 148;

let win: BrowserWindow | null = null;
let currentAccelerator = "";
let registered = false;

function createCaptureWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Keeps the panel out of the window/app switchers — it's a transient
    // overlay, not a document window.
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    // On macOS this makes it an NSPanel, which can take keyboard focus
    // WITHOUT activating the whole app. A plain window shows on top but the
    // previously-active app keeps key focus, so everything you type goes to
    // that app instead — the panel just sits there looking focused.
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // "floating" (rather than plain true) keeps it above normal windows without
  // fighting menus and system UI for the very top layer.
  w.setAlwaysOnTop(true, "floating");
  // Without this the panel is stuck on the desktop it was created on, and
  // summoning it while a fullscreen app is frontmost would appear to do
  // nothing — which is exactly when quick capture is most useful.
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env.ELECTRON_RENDERER_URL) {
    w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/capture.html`);
  } else {
    w.loadFile(path.join(__dirname, "..", "renderer", "capture.html"));
  }

  // Clicking away dismisses, like any other system panel. Losing the text on
  // blur is deliberate: capture is meant to be committed or abandoned, and a
  // half-typed thought lingering invisibly is worse than losing it.
  w.on("blur", () => w.hide());

  return w;
}

export function initCaptureWindow(): void {
  if (!win) win = createCaptureWindow();
}

function positionNearTop(w: BrowserWindow): void {
  // Follows the cursor's display, so on a multi-monitor setup the panel opens
  // where the user is actually looking rather than always on the primary.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  w.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * 0.22),
    width: WIDTH,
    height: HEIGHT,
  });
}

export function toggleCaptureWindow(): void {
  if (!win) win = createCaptureWindow();
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionNearTop(win);
  // The app has to become active, not just the window focused. As a
  // nonactivating NSPanel the window reports isFocused() === true while macOS
  // still delivers keystrokes to whichever app was active — so the panel
  // looks focused, shows a caret, and silently drops everything typed into it
  // (worse: that typing lands in the app behind). Activating first is what
  // makes the panel actually key.
  if (process.platform === "darwin") app.focus({ steal: true });
  win.show();
  win.focus();
}

export function hideCaptureWindow(): void {
  win?.hide();
}

export function captureWindowContents(): Electron.WebContents | null {
  return win && !win.isDestroyed() ? win.webContents : null;
}

// globalShortcut.register returns false when another app already owns the
// combo — it does not throw. Swallowing that is how a hotkey silently does
// nothing forever, so the result is kept and surfaced in Settings.
export function registerCaptureHotkey(accelerator: string): CaptureHotkeyStatus {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator);
    registered = false;
  }
  currentAccelerator = accelerator;

  // Validate ourselves: on macOS globalShortcut.register() returns true even
  // for a malformed string (verified — "NotAReal+Key+Q" registers "fine"), so
  // without this a typo would look accepted and simply never fire.
  if (!accelerator || validateAccelerator(accelerator)) {
    return { accelerator, registered: false };
  }

  try {
    registered = globalShortcut.register(accelerator, toggleCaptureWindow);
  } catch {
    registered = false;
  }
  return { accelerator, registered };
}

export function captureHotkeyStatus(): CaptureHotkeyStatus {
  return { accelerator: currentAccelerator, registered };
}

export function destroyCaptureWindow(): void {
  globalShortcut.unregisterAll();
  win?.destroy();
  win = null;
}
