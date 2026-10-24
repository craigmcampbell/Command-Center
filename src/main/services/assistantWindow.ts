// The quick Assistant panel: a small frameless window summoned by a global
// hotkey from anywhere on the system. Same shape as services/captureWindow.ts
// (and for the same macOS reasons — read the comments there before changing
// the window flags), with three differences:
//
//  - It is created only when a hotkey is enabled, and lazily on the first press
//    otherwise, so an unused feature doesn't hold a renderer's worth of memory.
//  - Blur hides it but does NOT clear it. A reply can still be streaming (or a
//    confirmation card waiting) when you click away; the request lives in main,
//    and re-summoning shows where it got to. The renderer starts a fresh chat on
//    each summon only when nothing is in flight.
//  - It can ask main to hand its chat to the dashboard ("Open in dashboard").

import { app, BrowserWindow, globalShortcut, screen } from "electron";
import path from "node:path";
import type { AppCommand, CaptureHotkeyStatus } from "../../shared/types";
import { validateAccelerator } from "../../shared/accelerator";

const WIDTH = 700;
const HEIGHT = 560;

let win: BrowserWindow | null = null;
let currentAccelerator = "";
let registered = false;

function createAssistantWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    // See captureWindow.ts: as a plain window the panel shows on top but the
    // previously-active app keeps keyboard focus and swallows what you type.
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  w.setAlwaysOnTop(true, "floating");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env.ELECTRON_RENDERER_URL) {
    w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/assistant-quick.html`);
  } else {
    w.loadFile(path.join(__dirname, "..", "renderer", "assistant-quick.html"));
  }

  w.on("blur", () => w.hide());
  return w;
}

export function initAssistantWindow(): void {
  if (!win) win = createAssistantWindow();
}

function positionNearTop(w: BrowserWindow): void {
  // Follows the cursor's display, so on a multi-monitor setup the panel opens
  // where the user is actually looking.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  w.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * 0.14),
    width: WIDTH,
    height: HEIGHT,
  });
}

export function toggleAssistantWindow(): void {
  if (!win || win.isDestroyed()) win = createAssistantWindow();
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionNearTop(win);
  // The app has to become active, not just the window focused — see
  // captureWindow.ts's toggleCaptureWindow for why isFocused() lies here.
  if (process.platform === "darwin") app.focus({ steal: true });
  win.show();
  win.focus();
  const command: AppCommand = { type: "assistantPanelShown" };
  win.webContents.send("app:command", command);
}

export function hideAssistantWindow(): void {
  win?.hide();
}

// An empty or invalid accelerator just leaves the hotkey off. Validated here
// as well as in Settings because globalShortcut.register() returns true on
// macOS for a malformed string — see shared/accelerator.ts.
export function registerAssistantHotkey(accelerator: string): CaptureHotkeyStatus {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator);
    registered = false;
  }
  currentAccelerator = accelerator;
  if (!accelerator || validateAccelerator(accelerator)) {
    return { accelerator, registered: false };
  }
  try {
    registered = globalShortcut.register(accelerator, toggleAssistantWindow);
  } catch {
    registered = false;
  }
  return { accelerator, registered };
}

export function assistantHotkeyStatus(): CaptureHotkeyStatus {
  return { accelerator: currentAccelerator, registered };
}

export function destroyAssistantWindow(): void {
  win?.destroy();
  win = null;
}
