"use client";
import { useEffect } from "react";

/**
 * Registers the service worker so the app is installable as a PWA — but only in
 * production. In development the SW is intentionally NOT used (and any stale one
 * is unregistered), because caching Next.js dev build chunks causes stale-chunk
 * runtime errors after rebuilds.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort */
      });
    } else {
      // Tear down any SW left over from a previous run so it can't serve stale chunks.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
    }
  }, []);
  return null;
}
