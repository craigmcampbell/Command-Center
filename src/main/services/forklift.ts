// Opens a local directory in ForkLift, a macOS file manager. `open -a` has
// no equivalent invoked the same way on other platforms, so this fails soft
// there rather than guessing at one — same OS-branching convention as
// services/launcher.ts's terminal launching.

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ActionResult } from "../../shared/types";

// execFile bypasses the shell entirely (deliberately — see below), so a
// leading "~" is never expanded by the OS the way it would be if a user
// typed `open ~/foo` at a real shell prompt. Expand it ourselves before
// handing the path to `open`, since users naturally type `~/...` paths.
function expandHome(dirPath: string): string {
  const trimmed = dirPath.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

// `open -a ForkLift <path>` treats the path as a new document, which
// ForkLift always opens in single-pane — there's no documented URL scheme or
// CLI flag to avoid that. The only way to get back to two-pane (and, as of
// ForkLift 4.3.3's "Enhanced Layout Memory", have the second pane's prior
// content restored automatically) is to trigger its View > "Show Two Panes"
// menu command. The `if exists` guard makes this a no-op if the window was
// already in two-pane mode, so it's safe to run unconditionally after every
// open. Needs the user to have granted this app Accessibility permission
// (System Settings > Privacy & Security > Accessibility) — best-effort: run
// fire-and-forget, since a missing grant (or ForkLift not being scriptable
// for any other reason) shouldn't turn a successful open into a failure.
const RESTORE_TWO_PANES_SCRIPT = `
tell application "ForkLift" to activate
delay 0.4
tell application "System Events"
  tell process "ForkLift"
    set viewMenu to menu "View" of menu bar item "View" of menu bar 1
    if exists menu item "Show Two Panes" of viewMenu then
      click menu item "Show Two Panes" of viewMenu
    end if
  end tell
end tell
`;

export function openInForkLift(dirPath: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, reason: "Opening in ForkLift is only supported on macOS" });
      return;
    }

    // execFile (not exec) so the path is passed as a real argv entry, never
    // interpolated into a shell string — matches docker.ts's convention.
    execFile("open", ["-a", "ForkLift", expandHome(dirPath)], (err) => {
      if (err) {
        resolve({ ok: false, reason: err.message });
        return;
      }
      resolve({ ok: true });
      execFile("osascript", ["-e", RESTORE_TWO_PANES_SCRIPT], () => {
        // Best-effort — errors (e.g. Accessibility not granted) are ignored.
      });
    });
  });
}
