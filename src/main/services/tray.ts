// Menubar tray. The always-visible surface: it works with no permission
// prompt, no signing, and no notification centre involved at all — so if
// macOS ever refuses notifications, this is still a live status readout
// rather than nothing.

import { Menu, Tray, nativeImage } from "electron";
import type { TraySummary } from "../../shared/types";
import { TRAY_ICON_16, TRAY_ICON_32 } from "../trayIcon";

export interface TrayHandlers {
  onShow: () => void;
  onRefresh: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let handlers: TrayHandlers | null = null;
let summary: TraySummary = { ciFailures: 0, processesDown: 0, containersExited: 0 };

function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromDataURL(TRAY_ICON_16);
  // The @2x representation keeps it sharp on Retina; without it macOS scales
  // the 16pt image up and it looks soft.
  image.addRepresentation({
    scaleFactor: 2,
    dataURL: TRAY_ICON_32,
  });
  // Template = macOS owns the colour, inverting for light/dark menubars. A
  // non-template image renders as a black blob on a dark menubar.
  image.setTemplateImage(true);
  return image;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summaryLine(): string {
  const parts: string[] = [];
  if (summary.ciFailures > 0) parts.push(`${plural(summary.ciFailures, "repo", "repos")} failing CI`);
  if (summary.processesDown > 0) {
    parts.push(`${plural(summary.processesDown, "process", "processes")} down`);
  }
  if (summary.containersExited > 0) {
    parts.push(`${plural(summary.containersExited, "container", "containers")} stopped`);
  }
  return parts.length > 0 ? parts.join(" · ") : "All clear";
}

// Only CI and crashed processes are "wrong"; a stopped container is often
// deliberate, so it stays out of the menubar badge to keep it quiet.
function badgeCount(): number {
  return summary.ciFailures + summary.processesDown;
}

function render(): void {
  if (!tray || !handlers) return;

  tray.setToolTip(`Command Center — ${summaryLine()}`);
  // Empty string removes the title entirely, so the menubar shows just the
  // glyph when nothing needs attention.
  const count = badgeCount();
  tray.setTitle(count > 0 ? String(count) : "");

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: summaryLine(), enabled: false },
      { type: "separator" },
      { label: "Show Command Center", click: () => handlers?.onShow() },
      { label: "Refresh all", click: () => handlers?.onRefresh() },
      { type: "separator" },
      { label: "Quit Command Center", click: () => handlers?.onQuit() },
    ])
  );
}

export function initTray(h: TrayHandlers): void {
  if (tray) return;
  handlers = h;
  tray = new Tray(trayImage());
  // No `click` handler on purpose: with a context menu attached, macOS opens
  // that menu on left-click, and adding a click handler too made a single
  // click both open the menu *and* raise the window. "Show Command Center" in
  // the menu is the one unambiguous way in.
  render();
}

export function updateTray(next: TraySummary): void {
  summary = next;
  render();
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
