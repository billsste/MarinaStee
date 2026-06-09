"use client";

import * as React from "react";

/*
 * Holder portal session — device-local, persistent across reloads.
 *
 * Storage shape:
 *   {
 *     v: 1,
 *     boaterId: "b_emmons",
 *     token: "tok_h_emmons_2026a",
 *     signedInAt: "2026-05-28T14:02:00.000Z",
 *     lastActiveAt: "2026-05-28T18:33:00.000Z",
 *   }
 *
 * Session lifetime: 365 days from last activity. Every time the holder
 * lands on a portal route, lastActiveAt is bumped — so an active user
 * never gets logged out, only an idle one.
 *
 * Magic-link flow: marina sends `/portal/{token}` once. First landing
 * validates the token (server-side via getBoaterByPortalToken), then
 * calls `signInHolder(token, boaterId)` here to persist the session.
 * Every subsequent open from the home-screen icon goes straight to the
 * agent — no token check needed unless the session expired.
 *
 * NOT part of the reactive client-store on purpose — the holder session
 * is device-local; mixing it into the marina state would leak between
 * staff and holder browsing on the same device.
 */

const STORAGE_KEY = "marina-stee:holder-session:v1";
const SESSION_VERSION = 1;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 365 days

export type HolderSession = {
  v: typeof SESSION_VERSION;
  boaterId: string;
  token: string;
  signedInAt: string;
  lastActiveAt: string;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Read the current session from localStorage. Returns null if missing,
 *  malformed, or expired. */
export function loadHolderSession(): HolderSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HolderSession;
    if (parsed.v !== SESSION_VERSION) return null;
    if (!parsed.boaterId || !parsed.token) return null;
    const last = Date.parse(parsed.lastActiveAt);
    if (Number.isFinite(last) && Date.now() - last > MAX_AGE_MS) {
      // Stale beyond 365 days — clear it.
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a freshly authenticated session. Called from /portal/[token]
 *  on first landing once the token is validated against the boater. */
export function signInHolder(token: string, boaterId: string): void {
  if (!isBrowser()) return;
  const now = new Date().toISOString();
  const session: HolderSession = {
    v: SESSION_VERSION,
    boaterId,
    token,
    signedInAt: now,
    lastActiveAt: now,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota / disabled storage — session won't persist, holder will
    // re-auth via the original magic link next time.
  }
  // Notify any in-page subscribers.
  window.dispatchEvent(new Event("holder-session-changed"));
}

/** Update lastActiveAt on the existing session. Cheap — call from the
 *  shell on each route view to keep the session "warm". */
export function touchHolderSession(): void {
  if (!isBrowser()) return;
  const current = loadHolderSession();
  if (!current) return;
  const updated: HolderSession = {
    ...current,
    lastActiveAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

/** Forget the current holder session (log out). */
export function signOutHolder(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("holder-session-changed"));
}

/** React hook: subscribe to the current holder session. Re-renders when
 *  sign-in / sign-out happens in this tab. */
export function useHolderSession(): HolderSession | null {
  const [session, setSession] = React.useState<HolderSession | null>(() =>
    loadHolderSession()
  );

  React.useEffect(() => {
    const onChange = () => setSession(loadHolderSession());
    window.addEventListener("holder-session-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("holder-session-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return session;
}
