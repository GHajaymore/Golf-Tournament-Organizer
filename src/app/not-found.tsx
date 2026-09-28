import type { Metadata } from "next";
import Link from "next/link";
import { Lockup } from "@/components/Lockup";
import { LOGO_SIZE } from "@/components/Logo";
import { NOINDEX } from "@/lib/site";

/**
 * WHERE A WRONG ADDRESS LANDS.
 *
 * There was no page for this, so Next served its own: a bare white screen
 * reading "404: This page could not be found." with no brand and no way back —
 * the one screen a member reaches from a stale link in an old message. Found on
 * 2026-09-28 by a console sweep that happened to ask for a route that does not
 * exist.
 *
 * It says what happened in plain words and offers the two places somebody
 * could have been going: the front page, and their own tournaments (which asks
 * them to sign in if they have not).
 */
export const metadata: Metadata = {
  title: "Page not found",
  robots: NOINDEX,
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(560px, 100%)" }}>
        <div style={{ marginBottom: 32 }}>
          <Lockup size={LOGO_SIZE.md} />
        </div>
        <p className="page-kicker">Page not found</p>
        <h1 style={{ fontSize: 30, margin: "8px 0 8px" }}>That page isn&rsquo;t here</h1>
        <p className="text-muted" style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
          The link may be old, or the address may have a typo in it. If you were sent a link to a
          tournament&rsquo;s leaderboard or entry form, ask the club for a fresh one — they can be
          switched off or replaced.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link href="/choose" className="btn btn-primary">
            Your tournaments
          </Link>
          <Link href="/" className="btn btn-secondary">
            TourneyHQ home
          </Link>
        </div>
      </div>
    </main>
  );
}
