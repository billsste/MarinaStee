"use client";

import * as React from "react";

// Registers the service worker after the page is interactive.
// Silent on dev (Next.js dev server can confuse SW caching), opt-in via NODE_ENV.
//
// In dev: actively unregister any SW left over from a previous production
// visit AND wipe its caches. Without this, a stale cache-first SW will
// serve old compiled JS chunks forever even though we're not registering
// a new SW — symptom is "I edited the source but the browser still shows
// the old UI." Hard-refresh doesn't beat the SW; only an unregister does.
//
// In prod: register, then watch for updates. When a new SW is detected,
// post SKIP_WAITING so it activates immediately. Without this step the
// new SW sits in `waiting` until every tab closes — on iOS standalone PWA
// that means the user fully kills the app, which they almost never do.

export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // Dev: best-effort kill of any leftover SW + its caches.
      (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {
          // Silent — best effort.
        }
      })();
      return;
    }

    const onLoad = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");

        // Listen for an updated SW becoming available. The `installing`
        // worker transitions installed → activated; once installed (and a
        // controller already exists), we tell it to skip waiting so the
        // next navigation uses the new shell.
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      } catch {
        // Silent failure — SW is progressive enhancement.
      }
    };

    if (document.readyState === "complete") {
      void onLoad();
    } else {
      const handler = () => void onLoad();
      window.addEventListener("load", handler);
      return () => window.removeEventListener("load", handler);
    }
  }, []);

  return null;
}
