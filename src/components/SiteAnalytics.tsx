"use client";

import Script from "next/script";
import { scrubAnalyticsEvent, type AnalyticsEventLike } from "@/lib/domain/analytics-event";

type Va = ((...args: unknown[]) => void) & { q?: unknown[] };

declare global {
  interface Window {
    va?: Va;
    vaq?: unknown[];
  }
}

/**
 * Vercel Web Analytics, without the package (2026-10-03).
 *
 * `@vercel/analytics` is a thin loader: it defines a `window.va` queue, hands
 * it a `beforeSend`, and loads `/_vercel/insights/script.js`. Its current
 * releases declare SvelteKit and Vite 8 as optional peers, which npm cannot
 * resolve beside vitest's Vite 5 — so this does the same three things directly
 * rather than forcing the install and putting CI's `npm ci` at risk.
 *
 * Cookie-free: the script stores nothing in the browser and identifies nobody
 * between visits. Every address it counts is scrubbed of link tokens first
 * (`scrubAnalyticsEvent`). Rendered only when NEXT_PUBLIC_ANALYTICS is "on",
 * and Web Analytics must also be enabled for the project in Vercel, or the
 * script is not served.
 */
export function SiteAnalytics() {
  if (typeof window !== "undefined" && !window.va) {
    window.va = function va(...args: unknown[]) {
      (window.vaq = window.vaq || []).push(args);
    };
    window.va("beforeSend", (event: AnalyticsEventLike) => scrubAnalyticsEvent(event));
  }
  return <Script src="/_vercel/insights/script.js" strategy="afterInteractive" data-sdkn="tourneyhq" />;
}
