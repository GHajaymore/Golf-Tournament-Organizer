import { prisma } from "@/lib/db";
import { contestTitle, shownOnBoard, sponsorsToThank } from "@/lib/domain/contest-board";

/**
 * THE CONTESTS ON THE PUBLIC BOARD, AND THEIR SPONSORS (2026-10-17).
 *
 * A closest-to-the-pin or long-drive winner reached nobody but the money
 * ledger. This lists the ones a club announces (`shownOnBoard`) for the round
 * on show and for the whole outing: the contest, its winner once the committee
 * has named one, and who sponsors it — then thanks the sponsors once, at the
 * foot. Names only: no stake and no pot, which are the players' business.
 *
 * Read on every request, like the commentary above the scores, not through the
 * board's cache: a winner named is a winner the next refresh shows.
 */
export async function PublicContests({ eventId, stageId }: { eventId: string; stageId: string | null }) {
  const contests = (
    await prisma.contest.findMany({
      where: { eventId, ...(stageId === null ? {} : { stageId: { in: ["", stageId] } }) },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, name: true, hole: true, sponsorName: true, sponsorUrl: true, entrants: { where: { won: true }, select: { playerId: true } } },
    })
  ).filter((c) => shownOnBoard(c.kind));
  if (contests.length === 0) return null;

  const winnerIds = [...new Set(contests.flatMap((c) => c.entrants.map((e) => e.playerId)))];
  const names = new Map(
    (await prisma.player.findMany({ where: { eventId, id: { in: winnerIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  );
  const thanks = sponsorsToThank(contests);

  return (
    <section aria-label="Contests" style={{ marginTop: 22, display: "grid", gap: 10, minWidth: 0 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)", margin: 0 }}>
        Contests
      </h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {contests.map((c) => {
          const winners = c.entrants.map((e) => names.get(e.playerId)).filter((n): n is string => !!n);
          return (
            <li
              key={c.id}
              style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 3, minWidth: 0 }}
            >
              <span style={{ fontSize: 15, fontWeight: 600 }}>{contestTitle(c)}</span>
              <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>
                {winners.length ? winners.join(" & ") : <span style={{ color: "var(--color-neutral-400)" }}>Not decided yet</span>}
              </span>
              {c.sponsorName && (
                <span style={{ fontSize: 13, color: "var(--color-neutral-400)", overflowWrap: "anywhere" }}>
                  Sponsored by{" "}
                  {c.sponsorUrl ? (
                    <a href={c.sponsorUrl} target="_blank" rel="noopener nofollow" style={{ color: "var(--color-accent-200)" }}>
                      {c.sponsorName}
                    </a>
                  ) : (
                    c.sponsorName
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {thanks.length > 0 && (
        <p style={{ fontSize: 13, margin: "4px 0 0", color: "var(--color-neutral-400)", overflowWrap: "anywhere" }}>
          Thanks to our sponsors:{" "}
          {thanks.map((s, i) => (
            <span key={s.name}>
              {i > 0 ? ", " : ""}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener nofollow" style={{ color: "var(--color-accent-200)" }}>
                  {s.name}
                </a>
              ) : (
                s.name
              )}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
