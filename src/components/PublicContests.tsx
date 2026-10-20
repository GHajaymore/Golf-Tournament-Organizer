import { contestBoard } from "@/lib/services/contest-board";

/**
 * THE CONTESTS ON THE PUBLIC BOARD, AND THEIR SPONSORS (2026-10-17).
 *
 * A closest-to-the-pin or long-drive winner reached nobody but the money
 * ledger. This lists the ones a club announces for the round on show and for
 * the whole outing: the contest, its winner once the committee has named one,
 * and who sponsors it — then thanks the sponsors once, at the foot. Read
 * through `contestBoard`, the one reader the printed results use too.
 *
 * Read on every request, like the commentary above the scores, not through the
 * board's cache: a winner named is a winner the next refresh shows.
 */
export async function PublicContests({ eventId, stageId }: { eventId: string; stageId: string | null }) {
  const { lines, thanks } = await contestBoard(eventId, stageId);
  if (lines.length === 0) return null;

  return (
    <section aria-label="Contests" style={{ marginTop: 22, display: "grid", gap: 10, minWidth: 0 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)", margin: 0 }}>
        Contests
      </h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {lines.map((c) => (
          <li
            key={c.id}
            style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 3, minWidth: 0 }}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>{c.title}</span>
            <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>
              {c.winners.length ? c.winners.join(" & ") : <span style={{ color: "var(--color-neutral-400)" }}>Not decided yet</span>}
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
        ))}
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
