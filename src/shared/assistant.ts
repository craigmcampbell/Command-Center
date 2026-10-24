// Constants the Assistant's main process and its UI must agree on. Kept in one
// place because a drift here is silent: if the UI forgot a tool that changes
// data, it would offer "Regenerate" on a reply that had already changed
// something.

// Tools that change data. Everything else the assistant can call only reads.
export const ASSISTANT_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "complete_task",
  "reschedule_task",
  "create_task",
  "approve_transaction",
  "categorize_transaction",
  "reader_save_link",
  "reader_move_to_inbox",
  "forget",
]);

// The quick panel's global hotkey when the user hasn't chosen one. A hyperkey
// combo, like Quick Capture's (Q), so it is unlikely to collide with an app.
export const DEFAULT_ASSISTANT_ACCELERATOR = "Cmd+Ctrl+Alt+Shift+A";
