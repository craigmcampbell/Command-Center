// Validation for Electron accelerator strings, shared by the renderer (for
// inline feedback while typing) and main (as a guard before registering).
//
// This exists because globalShortcut.register() is not a usable validator on
// macOS: it returns `true` for a garbage string like "NotAReal+Key+Q" and for
// combos another app already owns (verified against Cmd+Space, which Spotlight
// holds). So the only failure we can actually detect is a malformed string —
// which is also the one a user typing into a text field will actually hit.
// A genuine conflict with another app stays undetectable; the Settings copy
// says so rather than implying we check.

const MODIFIERS = new Set([
  "command",
  "cmd",
  "control",
  "ctrl",
  "commandorcontrol",
  "cmdorctrl",
  "alt",
  "option",
  "altgr",
  "shift",
  "super",
  "meta",
]);

const NAMED_KEYS = new Set([
  "plus", "space", "tab", "capslock", "numlock", "scrolllock", "backspace",
  "delete", "insert", "return", "enter", "up", "down", "left", "right",
  "home", "end", "pageup", "pagedown", "escape", "esc", "printscreen",
  "volumeup", "volumedown", "volumemute", "medianexttrack",
  "mediaprevioustrack", "mediastop", "mediaplaypause",
  "numdec", "numadd", "numsub", "numdiv", "nummult",
]);

function isKey(token: string): boolean {
  const t = token.toLowerCase();
  if (NAMED_KEYS.has(t)) return true;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(t)) return true; // F1–F24
  if (/^num[0-9]$/.test(t)) return true;
  // Single character: letters, digits, and the punctuation Electron accepts.
  return t.length === 1;
}

export function validateAccelerator(accelerator: string): string | null {
  const value = accelerator.trim();
  if (!value) return "Enter a hotkey.";

  const parts = value.split("+").map((p) => p.trim());
  if (parts.some((p) => p === "")) return "Remove the empty section around a “+”.";

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  const badModifier = modifiers.find((m) => !MODIFIERS.has(m.toLowerCase()));
  if (badModifier) return `“${badModifier}” isn’t a modifier (use Cmd, Ctrl, Alt, Option or Shift).`;

  if (!isKey(key)) return `“${key}” isn’t a key Electron recognises.`;

  // A global shortcut with no modifier would swallow that key system-wide.
  if (modifiers.length === 0) return "Include at least one modifier, e.g. Cmd+Shift+K.";

  return null;
}
