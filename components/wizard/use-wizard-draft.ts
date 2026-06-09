"use client";

import * as React from "react";

/*
 * useWizardDraft — sessionStorage-backed wizard draft state.
 *
 * Mirrors useState's signature plus a clearDraft to wipe the key on
 * successful submit. Persists JSON-serializable values only — File
 * objects, blobs, and class instances will not survive a reload. Wizards
 * with attachments should keep the File data in a sibling useState and
 * persist only the metadata (name, size, mime) here.
 *
 * Hydration story:
 *   - Server render uses `initial`.
 *   - First client effect reads sessionStorage and replaces draft if a
 *     valid snapshot is present.
 *   - All subsequent setDraft calls persist to sessionStorage.
 *
 * That avoids hydration mismatch (server can't see sessionStorage) at
 * the cost of one extra render on resume. Acceptable for the wizards
 * we have today.
 */
export function useWizardDraft<T>(
  key: string,
  initial: T | (() => T)
): readonly [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  // Stash the initializer in a ref so clearDraft can recreate a fresh
  // draft on demand. Without this, modal wizards that stay MOUNTED when
  // their `open` prop drops to false (every WizardShell-backed flow
  // today) would reopen with the stale in-memory draft — sessionStorage
  // gets cleared, but useState still holds the old object.
  const initialRef = React.useRef(initial);
  const [draft, setDraft] = React.useState<T>(initial);

  // One-shot hydration from sessionStorage. We deliberately don't include
  // `key` in the dep array — if a caller changes the storage key mid-life
  // they probably want a fresh draft, not a re-hydrate from the new key.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        setDraft(parsed);
      }
    } catch {
      /* corrupt JSON or privacy-mode storage — fall back to initial */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* quota / privacy errors — silently drop */
    }
  }, [key, draft]);

  const clearDraft = React.useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    // Reset the in-memory state to a fresh initial value. WITHOUT this,
    // a long-lived modal wizard (mounted but hidden) reopens showing
    // whatever the operator typed before they hit Exit — the
    // sessionStorage clear is invisible to React.
    const fresh =
      typeof initialRef.current === "function"
        ? (initialRef.current as () => T)()
        : initialRef.current;
    setDraft(fresh);
  }, [key]);

  return [draft, setDraft, clearDraft] as const;
}
