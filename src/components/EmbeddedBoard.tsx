import type { ReactNode } from "react";

/**
 * A board placed INSIDE another page: the table, and the one line saying what
 * it is ranked on — without the "Overview · Live leaderboard" heading the
 * console's Live leaderboard gives it.
 *
 * `TeamLeaderboard`, `SkinsLeaderboard`, `NassauLeaderboard` and
 * `ModifiedStablefordLeaderboard` are whole pages, heading and all. Reports
 * and the public `/live` board both dropped them into a page that already has
 * its own `<h1>`, which gave each of those screens two — and put the console's
 * "Overview" kicker in front of a club's members on the shared link, and the
 * word "Live" on a sheet printed after the round. Found 2026-09-26 on the
 * seeded club's foursomes.
 */
export function EmbeddedBoard({ note, children }: { note: string; children: ReactNode }) {
  return (
    <>
      <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.5, color: "var(--color-neutral-400)" }}>
        {note}
      </p>
      {children}
    </>
  );
}
