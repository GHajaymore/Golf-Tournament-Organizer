import { toParText } from "@/lib/domain";
import type { StandingRow } from "./LeaderboardTable";

/**
 * The leaderboard as a player reads it — on a phone, one-handed, in daylight.
 *
 * `LeaderboardTable` is the organizer's view: every column, because an
 * organizer is auditing. This is the opposite brief. A player standing on the
 * 14th tee wants three facts — where am I, what am I on, how many are left to
 * play — and wants them without pinching, scrolling sideways, or shading the
 * screen with a hand.
 *
 * So this is not a table. Tables put their information in columns of equal
 * weight and make every one of them small; a phone in sun can afford exactly
 * one thing at small size, and it should not be the score. Rows here are
 * generous, the score is the largest thing on the line, and the rank and
 * "thru" sit back.
 *
 * Deliberately server-rendered and static: no polling, no client JS. Refreshing
 * is a pull-down, which every player already knows, and battery on the course
 * is not a renewable resource.
 */

const num = { fontVariantNumeric: "tabular-nums" as const };

/** Under par earns colour; level and over stay in text. */
function scoreColour(toPar: number, isStableford: boolean): string {
  if (isStableford) return "var(--color-text)";
  if (toPar < 0) return "var(--color-accent-2-300)";
  return "var(--color-text)";
}

export function PlayerLeaderboard({
  isStroke,
  isStableford = false,
  rows,
  holes,
}: {
  isStroke: boolean;
  isStableford?: boolean;
  rows: StandingRow[];
  /** Round length, so "thru 18" can become "F". */
  holes: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted" style={{ fontSize: 15, margin: 0, lineHeight: 1.5 }}>
        No scores yet. This page updates as cards come in.
      </p>
    );
  }

  // Where the cut falls, if there is one. Rendered as a labelled rule between
  // rows rather than a colour on them: a tinted row means "advancing" only if
  // you already know that, whereas a line that says so cannot be misread.
  const lastAdvancing = rows.reduce(
    (last, r, i) => (r.advancing ? i : last),
    -1,
  );
  const showCut = lastAdvancing >= 0 && lastAdvancing < rows.length - 1;

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((r, i) => {
        const leader = i === 0 && r.thru > 0;
        const started = r.thru > 0;

        // The one number the row is built around.
        const score = isStroke
          ? isStableford
            ? String(r.points)
            : toParText(r.toPar)
          : r.pts;

        return (
          <li key={r.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: leader ? "16px 14px" : "13px 14px",
                borderRadius: 12,
                // The leader gets a tint and a rule, not a different layout —
                // the eye should still be able to run straight down the scores.
                background: leader ? "var(--color-accent-900)" : "transparent",
                boxShadow: leader ? "inset 3px 0 0 var(--color-accent)" : undefined,
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              <span
                style={{
                  ...num,
                  minWidth: 26,
                  fontSize: leader ? 17 : 15,
                  fontWeight: leader ? 700 : 500,
                  color: started ? "var(--color-text)" : "var(--color-neutral-400)",
                }}
              >
                {started ? r.rank : "–"}
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: leader ? 18 : 16,
                    fontWeight: leader ? 650 : 550,
                    lineHeight: 1.25,
                    // Long names wrap rather than truncate. A player whose name
                    // is cut off cannot find themselves on the board.
                    overflowWrap: "anywhere",
                  }}
                >
                  {r.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    marginTop: 2,
                    color: "var(--color-neutral-400)",
                  }}
                >
                  {[
                    // An unflighted event stores the flight as an em dash, which
                    // is a placeholder for a table cell that must not be blank —
                    // it is not a label, and it reads as noise on a line of prose.
                    r.flight === "—" ? "" : r.flight,
                    isStroke
                      ? started
                        ? r.thru >= holes
                          ? "F"
                          : `thru ${r.thru}`
                        : "not started"
                      : r.record,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>

              <span
                style={{
                  ...num,
                  fontSize: leader ? 30 : 26,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: started ? scoreColour(r.toPar, isStableford) : "var(--color-neutral-400)",
                }}
              >
                {started ? score : "–"}
              </span>
            </div>

            {showCut && i === lastAdvancing && (
              <div
                aria-label="Cut line"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "10px 2px",
                }}
              >
                <span style={{ flex: 1, height: 1, background: "var(--color-accent)" }} />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-400)",
                  }}
                >
                  Cut line
                </span>
                <span style={{ flex: 1, height: 1, background: "var(--color-accent)" }} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
