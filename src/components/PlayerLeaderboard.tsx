import { rankedScore, unitIsNet } from "@/lib/domain/ranked-score";
import { holdsPosition, placeText, sharedRanks } from "@/lib/domain/shared-position";
import { cutLineIndex } from "@/lib/domain/cut";
import { FlipList } from "./FlipList";
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

/**
 * Where the card is, in the words a player uses: "F", "thru 14", "not started".
 *
 * A card that stopped short says so on the same line. A match won 5&4 leaves
 * four holes conceded and never played (Rule 3.2b), and the card is complete as
 * a RESULT while being short as a CARD — so the player is on the board with the
 * holes they played and no position beside them. Told here, in the row, rather
 * than left as an unexplained dash where the rank should be.
 */
function cardState(r: StandingRow, holes: number): string {
  /**
   * "Not playing this week" and "not started" are different facts, and only
   * one of them means somebody may still walk in.
   *
   * Checked before `thru`, not after: an absentee has no card by definition,
   * so asking about holes first answers with the vaguer of the two every
   * time. This is also what stops the board carrying a FINAL chip above rows
   * it has itself called "not started" — see `absent` on StandingRow.
   */
  if (r.absent) return "not playing this week";
  if (r.thru <= 0) return "not started";
  // Against what this row's own cards cover, falling back to the round's hole
  // count for a row that has none. A Round Robin stage holds the whole round
  // robin, so one player has three matches inside one round — eighteen holes
  // returned is a third of their round, and calling it "F" would tell somebody
  // still on the course that they had finished.
  const owed = r.holesOwed > 0 ? r.holesOwed : holes;
  const played = r.thru >= owed ? "F" : `thru ${r.thru}`;
  if (r.ranked) return played;
  // The same reason the console gives — see `unrankedNote`. "F · not ranked"
  // on a player cut after round 1 read as a finished card that lost its place
  // for nothing.
  return r.missedRound ? `${played} · didn't play ${r.missedRound}` : `${played} · not ranked`;
}

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
  youId = "",
  unit = "",
  cutNote = "",
}: {
  isStroke: boolean;
  isStableford?: boolean;
  rows: StandingRow[];
  /**
   * One sentence explaining where the cut line falls, from `cutLineNote`.
   *
   * Empty means say nothing — a board with no cut, or one whose bubble the
   * service could not describe. Never assembled here: the words are per-format
   * (a stroke board is separated by a countback, a match board by the
   * tiebreaker chain) and they are already written once, next to the decision
   * that produces them.
   */
  cutNote?: string;
  /** Round length, so "thru 18" can become "F". */
  holes: number;
  /**
   * The signed-in player's id, when they are in this field.
   *
   * A board is read to answer one question first — where am I — and on a
   * forty-player field that meant scrolling and reading names. Their row is
   * marked, and their position is repeated at the top so the answer is on
   * screen before any scrolling happens at all.
   */
  youId?: string;
  /**
   * What the numbers are: "strokes", "Stableford points", "match points".
   *
   * A column of numbers with no unit is a column a player has to infer, and
   * the same board legitimately shows three different things depending on the
   * round. The server knows which; it should say so rather than let the reader
   * guess from the shape of the digits.
   */
  unit?: string;
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
  //
  // WHEN THERE IS ONE. This took the LAST advancing row and drew under it,
  // which assumes the advancing set is a prefix of the board — and on a
  // tournament whose bracket was qualified on an earlier round's ranking it is
  // not. See `cutLineIndex`, which measured that case on the demo: four
  // players through, the rule drawn under row seventeen. Where the line cannot
  // be drawn honestly the rows say it one at a time instead.
  const lastAdvancing = cutLineIndex(rows);
  const showCut = lastAdvancing !== null;
  const markEachRow = !showCut && rows.some((r) => r.advancing) && rows.some((r) => !r.advancing);

  const youIndex = youId ? rows.findIndex((r) => r.id === youId) : -1;
  /**
   * Only when the player's own row is out of sight (2026-09-19). "Where am I"
   * answered above the board is the point for somebody 23rd of 40; for the
   * leader it printed their row twice, one line apart — the first thing the
   * club named as redundant. The top five are on the first screen anyway.
   */
  const you = youIndex >= 5 ? rows[youIndex] : undefined;
  /* The figure follows the caption: a board that says it is ranked by net
     strokes prints a net to-par. See `unitIsNet`. */
  const isNet = unitIsNet(unit);
  const yourScore = you ? rankedScore(you, { isStroke, isStableford, isNet }).text : "";
  // "T9" where a place is shared — the same rule `/me` uses. See `placeText`.
  const shared = sharedRanks(rows);

  return (
    <>
      {/* Where am I — answered before a finger touches the screen. */}
      {you && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            marginBottom: 10,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
            boxShadow: "inset 3px 0 0 var(--color-accent)",
          }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
            You
          </span>
          <span style={{ ...num, fontSize: 17, fontWeight: 700 }}>
            {holdsPosition(you) ? placeText(you, shared) : "–"}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--color-neutral-400)" }}>
            {isStroke ? cardState(you, holes) : you.record}
          </span>
          <span
            style={{
              ...num,
              fontFamily: "var(--font-heading)",
              fontSize: 24,
              color: scoreColour(you.toPar, isStableford),
            }}
          >
            {you.started ? yourScore : "–"}
          </span>
        </div>
      )}

      {unit && (
        <p
          className="text-muted"
          style={{ fontSize: 11.5, margin: "0 0 6px", letterSpacing: "0.04em", textTransform: "uppercase" }}
        >
          Ranked by {unit}
        </p>
      )}

      {/* A list that slides when rows change places — the one animation in the
          app, and only because a position change is real information. It is
          inert unless the board updates in place, which happens on the public
          spectator board and nowhere else. See FlipList. */}
      <FlipList style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r, i) => {
        // Two different questions, and a 5&4 card answers them differently.
        // `started` is "is there a card to show" and decides whether a score
        // appears; `r.ranked` is "does this row hold a position" and decides
        // the number down the left and who is called the leader.
        const leader = i === 0 && r.ranked;
        /**
         * `r.started`, the field built for this question — not `thru > 0`.
         *
         * `thru` counts holes on a returned CARD, and a match-play round keeps
         * its results on the matches, so `thru` is nought for everybody in one.
         * Reading it here printed a dash where every player's match points
         * belong: a board headed "Ranked by match points", sorted by match
         * points, with no match points on it.
         *
         * The row already answers this. `standingRows` sets `started` from
         * MATCHES played in a match round and from holes returned in a stroke
         * one, and `StandingRow` documents it against this exact fault — it
         * once "told a player 3-0-0 and top of their flight that they had no
         * position". This component was the reader that never got the message.
         */
        const started = r.started;
        const isYou = !!youId && r.id === youId;

        // The one number the row is built around, through the one reader —
        // the two copies of this branch in this file are what let a
        // match-play board render a dash for everybody but you.
        const score = rankedScore(r, { isStroke, isStableford, isNet }).text;

        return (
          <li key={r.id} data-flip-key={r.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: leader ? "16px 14px" : "13px 14px",
                borderRadius: 12,
                // The leader gets a tint and a rule, not a different layout —
                // the eye should still be able to run straight down the scores.
                // Your own row is marked the same way in the second colour, so
                // scrolling to find yourself is a glance rather than a read.
                background: leader
                  ? "var(--color-accent-900)"
                  : isYou
                    ? "color-mix(in srgb, var(--color-accent-2) 12%, transparent)"
                    : "transparent",
                boxShadow: leader
                  ? "inset 3px 0 0 var(--color-accent)"
                  : isYou
                    ? "inset 3px 0 0 var(--color-accent-2)"
                    : undefined,
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              <span
                style={{
                  ...num,
                  // Wide enough for "T12" so the names still line up down the
                  // board whether or not a row's place is shared.
                  minWidth: 34,
                  fontSize: leader ? 17 : 15,
                  fontWeight: leader ? 700 : 500,
                  color: r.ranked ? "var(--color-text)" : "var(--color-neutral-400)",
                }}
              >
                {holdsPosition(r) ? placeText(r, shared) : "–"}
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
                    isStroke ? cardState(r, holes) : r.record,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {/* WHO IS THROUGH, WHEN A LINE CANNOT SAY IT.
                    Only on a board whose advancing set is scattered rather
                    than a prefix — see `cutLineIndex`. On every ordinary cut
                    the rule above still does the work and this is absent, so
                    nothing gains a badge it does not need. Same word the
                    console's table and Reports already use. */}
                {markEachRow && r.advancing && (
                  <span
                    className="tag tag-accent"
                    style={{ fontSize: 10.5, marginTop: 4, display: "inline-block" }}
                  >
                    Advancing
                  </span>
                )}
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
            {/* WHY the line falls here.
                On a board separated by a tiebreaker the two players either
                side of it have the SAME score, and a line drawn through a tie
                with no explanation is how a player concludes the app is
                wrong. The sentence existed on the organizer's console and on
                neither of the two boards this component is — the player's own
                Board tab and the public share link. */}
            {showCut && cutNote && i === lastAdvancing && (
              <p
                className="text-muted"
                style={{ fontSize: 11.5, lineHeight: 1.5, margin: "-4px 2px 10px", textAlign: "center" }}
              >
                {cutNote}
              </p>
            )}
          </li>
        );
        })}
      </FlipList>
    </>
  );
}
