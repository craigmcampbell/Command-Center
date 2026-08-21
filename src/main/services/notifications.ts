// OS notifications. Thin wrapper over Electron's Notification, whose whole
// job is to make failure *visible* rather than silent.
//
// Background: this app previously shipped with the linker's own signature
// (identity "Electron", Info.plist unbound), so macOS registered notification
// permissions against a generic identity shared with dev-mode Electron and
// every other ad-hoc Electron app — and notifications quietly didn't work.
// electron-builder.yml's `mac.identity: "-"` fixed that. Electron 33 still
// uses the deprecated NSUserNotification API (its framework carries no
// UNUserNotificationCenter symbols); that API is still present on macOS 26,
// but at Electron 42+ notifications move to UNNotification and *require* a
// signed app — which the signing fix already covers.
//
// Note dev vs packaged: `npm start` runs node_modules' Electron.app, whose
// identity is com.github.Electron, so notifications there appear under the
// name "Electron". Only the packaged build posts as Command Center.

import { Notification } from "electron";
import type { AppAlert, NotificationHealth } from "../../shared/types";

// Set when a notification we actually tried to show reported failure. Distinct
// from `Notification.isSupported()` returning false: that's "this platform
// can't", this is "the OS refused the one we just sent" — the case that
// previously looked like success from inside the app.
let lastFailure: string | undefined;

export function getNotificationHealth(): NotificationHealth {
  return { supported: Notification.isSupported(), lastFailure };
}

export function showAlert(alert: AppAlert, onClick: (tab?: string) => void): void {
  if (!Notification.isSupported()) {
    lastFailure = "Notifications are not supported on this system";
    return;
  }

  // Reset before each attempt so the flag always describes the most recent
  // send rather than accumulating a permanent warning from one bad one.
  lastFailure = undefined;

  const notification = new Notification({
    title: alert.title,
    body: alert.body,
  });

  notification.on("click", () => onClick(alert.tab));

  // Electron 33 emits this when the OS rejects the notification — the signal
  // that used to be missing. Surfaced through getNotificationHealth() so the
  // Settings page can say so instead of the app pretending to work.
  notification.on("failed", (_event, error) => {
    lastFailure = String(error);
  });

  notification.show();
}
