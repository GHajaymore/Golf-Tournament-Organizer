import { prisma } from "@/lib/db";
import { sinceWords } from "@/lib/domain/since";

/**
 * WHAT THE COMMITTEE HAS SAID, WHERE THE FIELD CAN READ IT (2026-10-13).
 *
 * Under the organizer's leaderboard there is a box: "Post an update,
 * milestone or highlight…". Until this existed the lines posted there were
 * shown in exactly one place — that same screen, which only the committee
 * opens. Nobody the update was FOR could read it: not a player on the 12th,
 * not a family following the public link. Found while writing the first
 * browser test of posting one, by asking where to look for it afterwards.
 * Ajay's ruling when asked whether to show them or take the box away: "you are
 * the boss wearing many hats. go decide" — and a live update only its author
 * can see has no reason to exist, so it is shown.
 *
 * Read-only, on the public board and on a player's Board tab: the latest few
 * lines, newest first, each with how long ago it was said.
 *
 * WHAT IT DELIBERATELY LEAVES OUT: who wrote it. On the console the author is
 * named, because a committee wants to know which of them posted. This is a
 * page anybody with the link can open, and it speaks for the committee.
 *
 * A SERVER COMPONENT, and it must stay one. "12 minutes ago" is worked out
 * here, once, and sent as words. Worked out again in a browser a moment later
 * it can be a different word, and a screen drawn in different words on the
 * two sides is thrown away and drawn twice (CLAUDE.md, the #418 section;
 * `no-client-screen-draws-from-its-own-clock.test.ts`). Nothing that is drawn
 * in the browser may import this.
 *
 * Nothing at all is drawn when nothing has been said — no heading over an
 * empty box on every board of every club that never uses this.
 */

/** How many lines a board carries. A board is for the scores; this is a strip above them. */
export const COMMENTARY_ON_A_BOARD = 3;

export async function CommentaryFeed({ eventId, organizer }: { eventId: string; organizer: string }) {
  const lines = await prisma.commentary.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take: COMMENTARY_ON_A_BOARD,
    select: { id: true, text: true, source: true, createdAt: true },
  });
  if (lines.length === 0) return null;
  const now = new Date();
  return (
    <section
      aria-label={`From the ${organizer}`}
      style={{
        margin: "10px 0 18px",
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--color-divider)",
        background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
        display: "grid",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        From the {organizer}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {lines.map((line) => (
          <li key={line.id} style={{ minWidth: 0, fontSize: 14.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
            {line.text}
            <span style={{ display: "block", marginTop: 2, fontSize: 13, color: "var(--color-neutral-400)" }}>
              {/* The same label the console gives a line a machine drafted: a reader is told. */}
              {line.source === "ai" ? "AjAi · " : ""}
              {sinceWords(line.createdAt, now)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
