// Opens a local directory as a project in Cursor. Same "shell out to `open
// -a`" shape as services/forklift.ts, minus that file's two-pane AppleScript
// follow-up — `open -a Cursor <path>` opens the directory as a workspace on
// its own, no extra step needed.

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ActionResult } from "../../shared/types";

// execFile bypasses the shell, so `~` isn't expanded by the OS the way it
// would be at a real prompt — expand it ourselves. Same helper as forklift.ts.
function expandHome(dirPath: string): string {
  const trimmed = dirPath.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function openInCursor(dirPath: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, reason: "Opening in Cursor is only supported on macOS" });
      return;
    }

    // execFile (not exec) so the path is passed as a real argv entry, never
    // interpolated into a shell string — matches forklift.ts's convention.
    execFile("open", ["-a", "Cursor", expandHome(dirPath)], (err) => {
      if (err) {
        resolve({ ok: false, reason: err.message });
        return;
      }
      resolve({ ok: true });
    });
  });
}
