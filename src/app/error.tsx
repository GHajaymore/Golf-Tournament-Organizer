"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * WHAT A MEMBER SEES WHEN A SCREEN FAILS.
 *
 * With no boundary of its own, the app fell through to Next's default —
 * "Application error: a server-side exception has occurred" on a blank page,
 * which is how a member standing on the 9th reads a transient database blip.
 * Added 2026-09-28 alongside `not-found.tsx`.
 *
 * It never shows the error's message: that is server detail, and it can name a
 * table, a query or a person. It shows the DIGEST instead — the id Next logs
 * the real error under — so "it broke" can be matched to the log line when
 * somebody passes it on.
 *
 * "Try again" re-renders the segment, which is what clears the transient case;
 * the way home is for everything else.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The browser console, for whoever is debugging. Never the screen.
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(560px, 100%)" }}>
        <p className="page-kicker">Something went wrong</p>
        <h1 style={{ fontSize: 28, margin: "8px 0 8px" }}>This screen didn&rsquo;t load</h1>
        <p className="text-muted" style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 20px" }}>
          Scores that were already saved are safe. Try again — if it keeps happening, quote the
          reference below when you report it.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            TourneyHQ home
          </Link>
        </div>
        {error.digest && (
          <p className="text-muted" style={{ fontSize: 12.5, marginTop: 20 }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </main>
  );
}
