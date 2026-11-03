import type { PlayBy } from "@/lib/domain/knockout-play-by";

/**
 * A PLAYER'S OWN TIE, at the top of their Board (the panel, 2026-10-23): the
 * round, who they play (or the tie that decides it), the strokes given or
 * received off the full difference, the play-by date — "Overdue" written out
 * once the club's day is past it — and where a win takes them. The draw is
 * below it, opened on their section with their path lit.
 */
export function MyKnockoutTie({
  heading,
  line,
  strokes,
  playBy,
  next,
}: {
  /** "Your tie" while it is to play; "Your knockout" once they are out or have won it. */
  heading: string;
  /** `myTieLine`: "Round 2 v Ann Ash", "Out in the semi-final · lost to …", "Champion". */
  line: string;
  /** `strokesWords`, or "" when there is no opponent yet or nothing to play. */
  strokes: string;
  playBy: PlayBy | null;
  /** `nextTieWords`, or "" once there is nothing to play. */
  next: string;
}) {
  return (
    <section aria-labelledby="my-tie-head" className="card elev-sm" style={{ display: "grid", gap: 6, marginBottom: 16 }}>
      <h2 id="my-tie-head" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)", margin: 0 }}>
        {heading}
      </h2>
      <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: 17, lineHeight: 1.35 }}>{line}</p>
      {strokes && <p style={{ margin: 0, fontSize: 14 }}>{strokes}</p>}
      {playBy && (
        <p style={{ margin: 0, fontSize: 14 }}>
          Play by {playBy.words}
          {playBy.overdue && <strong style={{ color: "var(--color-danger)" }}> · Overdue</strong>}
        </p>
      )}
      {next && <p style={{ margin: 0, fontSize: 14, color: "var(--color-neutral-400)" }}>{next}</p>}
    </section>
  );
}
