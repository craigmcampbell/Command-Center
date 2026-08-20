// Debounced autosave shared by every markdown editor consumer (Scratchpad,
// Notes, Daily Note, Finance Review Log). Each of those used to hold its own
// `AUTOSAVE_MS` + timer ref + cleanup effect, and each of those cleanups
// called clearTimeout WITHOUT saving first — so switching tabs inside the
// debounce window silently dropped the last edit. That's the bug this hook
// exists to fix: unmount flushes instead of cancelling.
//
// The API is keyed rather than single-document because NotesWidget genuinely
// needs it (several notes open at once, each with its own pending save), and
// DailyNoteWidget benefits (keying by date means a pending save for yesterday
// and a fresh edit to today can't race one shared timer). Single-document
// consumers just pass a constant key.

import { useCallback, useEffect, useRef, useState } from "react";

export interface AutosaveHandle<K extends string | number> {
  // Queue `value` to be written under `key` after the debounce delay.
  // Replaces any save already queued for that key.
  schedule: (key: K, value: string) => void;
  // Write a queued value immediately. No key = every queued value.
  flush: (key?: K) => Promise<void>;
  // Drop a queued value without writing it. No key = all of them.
  cancel: (key?: K) => void;
  // Whether `key` has an edit queued but not yet written. Note this goes
  // false the moment the write *starts*, not when it lands — a caller asking
  // "are there unsaved local edits?" (see NotesWidget's on-focus reload) wants
  // exactly that, since an in-flight write means the file is about to match.
  isPending: (key: K) => boolean;
  // The key currently being written, for a "Saving…"/"Saved" label.
  savingKey: K | null;
}

const DEFAULT_DELAY_MS = 500;

export function useAutosave<K extends string | number>(
  save: (key: K, value: string) => Promise<unknown>,
  delayMs: number = DEFAULT_DELAY_MS
): AutosaveHandle<K> {
  // `save` lives in a ref so consumers don't have to useCallback it — same
  // trick components/MarkdownEditor.tsx uses for onChange. Without it, an
  // inline arrow at the call site would change identity every render and
  // reset every timer through the dep arrays below.
  const saveRef = useRef(save);
  saveRef.current = save;

  const timers = useRef(new Map<K, ReturnType<typeof setTimeout>>());
  const queued = useRef(new Map<K, string>());
  // Counts writes that have been started but not yet resolved. `savingKey`
  // clears only when this hits zero, so a fast save finishing while a slower
  // one is still in flight doesn't blank the label early. (NotesWidget had a
  // hand-rolled version of this guard; it lives here now.)
  const inFlight = useRef(0);
  const mounted = useRef(true);
  const [savingKey, setSavingKey] = useState<K | null>(null);

  const writeNow = useCallback(async (key: K): Promise<void> => {
    const timer = timers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(key);
    }

    const value = queued.current.get(key);
    if (value === undefined) return;
    queued.current.delete(key);

    inFlight.current += 1;
    if (mounted.current) setSavingKey(key);
    try {
      await saveRef.current(key, value);
    } finally {
      inFlight.current -= 1;
      if (mounted.current && inFlight.current === 0) setSavingKey(null);
    }
  }, []);

  const schedule = useCallback(
    (key: K, value: string) => {
      queued.current.set(key, value);
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => void writeNow(key), delayMs)
      );
    },
    [delayMs, writeNow]
  );

  const flush = useCallback(
    async (key?: K): Promise<void> => {
      if (key !== undefined) {
        await writeNow(key);
        return;
      }
      await Promise.all([...queued.current.keys()].map((k) => writeNow(k)));
    },
    [writeNow]
  );

  const cancel = useCallback((key?: K) => {
    const keys = key !== undefined ? [key] : [...timers.current.keys()];
    for (const k of keys) {
      const timer = timers.current.get(k);
      if (timer) clearTimeout(timer);
      timers.current.delete(k);
      queued.current.delete(k);
    }
  }, []);

  const isPending = useCallback((key: K) => queued.current.has(key), []);

  useEffect(() => {
    // Reset on (re)mount, not just at ref creation — React StrictMode runs
    // effects mount/unmount/mount in dev, and the cleanup below sets this
    // false. Without this line the second mount would never update state.
    mounted.current = true;

    // Quitting the app inside the debounce window would otherwise lose the
    // edit the same way a tab switch used to. Honest caveat: this dispatches
    // the save but can't await it, so a hard quit still races the write — it
    // narrows the window from `delayMs` to ~0 rather than closing it.
    const flushAll = (): void => void flush();
    window.addEventListener("beforeunload", flushAll);

    return () => {
      window.removeEventListener("beforeunload", flushAll);
      // Set before flushing: a React cleanup can't await, so writeNow's
      // `finally` lands after the component is gone and must not setState.
      // The write itself still happens — window.api.* reaches
      // ipcRenderer.invoke synchronously, and main handles the message
      // whether or not the renderer component still exists.
      mounted.current = false;
      void flush();
    };
  }, [flush]);

  return { schedule, flush, cancel, isPending, savingKey };
}
