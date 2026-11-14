import { tieNotReady, type BracketMatch, type BracketView } from "./bracket";
import { marginWords } from "./my-tie";

/**
 * KNOCKOUT TIES ON SCORE ENTRY, AND WHEN A RESULT MAY STILL BE TAKEN BACK
 * (simplicity review, cut 3, 2026-11-14).
 *
 * Until now a knockout winner was recorded by ONE tap on a 13.5 px seat in the
 * drawn tree, with no confirm and no undo. Taking a result back was a second tap
 * on the same seat, and nothing stopped it after the tie that result fed had
 * been played: the draw is rebuilt from the stored winners by position
 * (`buildBracket`), so a later winner whose opponent is no longer known is
 * dropped (`claimedWinner`). A wrong tap on a quarter-final after the semi-final
 * was in made the semi-final vanish from the board, with no line saying so.
 *
 * Two rules live here, each in one place:
 *
 *   `laterTieRefusal`  a result may be changed or taken back only while no other
 *                      result was built on it. The SERVER asks it, for the
 *                      bracket's tap (`setBracketWinner`) and for Undo / Change
 *                      result on Score entry (`undoTieResult`).
 *   `scoreEntryTies`   the ties as Score entry lists them: those needing an
 *                      answer first (a player's report), then those ready to
 *                      play, then those decided. A tie with a TBD seat has no
 *                      buttons (`tieNotReady`), and a first-round bye is not a tie.
 *
 * There is no "Halved" anywhere: a knockout match level after the last hole is
 * played on, one hole at a time, until there is a winner (Rule 3.2a(4)).
 */

export type Draws = { label: string; view: BracketView }[];

/** The tie a tie's winner goes on to, in the same draw; null for a final. */
export function tieItFeeds(view: BracketView, m: Pick<BracketMatch, "roundIndex" | "matchIndex">): BracketMatch | null {
  return view.rounds[m.roundIndex + 1]?.matches[Math.floor(m.matchIndex / 2)] ?? null;
}

/** "Semi-finals", or "Plate · Semi-finals" where there is more than one draw. */
function roundWords(draw: string, round: string): string {
  return draw ? `${draw} · ${round}` : round;
}

function findTie(draws: Draws, key: string): { index: number; draw: string; view: BracketView; round: string; match: BracketMatch } | null {
  for (const [index, { label, view }] of draws.entries()) {
    for (const rd of view.rounds) {
      const match = rd.matches.find((m) => m.key === key);
      if (match) return { index, draw: label, view, round: rd.label, match };
    }
  }
  return null;
}

/**
 * WHY THIS TIE'S RESULT CAN NO LONGER BE CHANGED OR TAKEN BACK, or null when it can.
 *
 * Its winner has played on: the tie it feeds has a result of its own. Changing it
 * now would take that later result off the draw without a word (the draw is
 * rebuilt by position, and a stored winner whose opponent changed is dropped),
 * so the refusal names the later tie and the way out: take THAT result back
 * first. A plate is drawn from the main draw's first-round losers, so once any
 * plate tie has a result, the main draw's first round is held the same way.
 *
 * `plate` is whether the second draw is a plate (`Event.bracketMode === "plate"`);
 * the draws are `bracketDraws(state.brackets)`, every flight included.
 */
export function laterTieRefusal(draws: Draws, key: string, opts: { plate: boolean }): string | null {
  const found = findTie(draws, key);
  if (!found) return null;
  const next = tieItFeeds(found.view, found.match);
  if (next?.winnerId && next.a.playerId && next.b.playerId) {
    const round = found.view.rounds[next.roundIndex]?.label ?? "";
    return `${roundWords(found.draw, round)}: ${next.a.name} v ${next.b.name} already has a result, and it was played by this tie's winner. Undo that result first, then change this one.`;
  }
  if (opts.plate && found.index === 0 && found.match.roundIndex === 0 && draws[1]) {
    const plate = draws[1];
    const played = plate.view.rounds.some((rd) => rd.matches.some((m) => m.winnerId && m.a.playerId && m.b.playerId));
    if (played) {
      const name = plate.label || "The plate";
      return `${name} is drawn from this round's losers, and it has results. Undo the ${name.toLowerCase()}'s results first, then change this one.`;
    }
  }
  return null;
}

export interface TieSide {
  id: string;
  name: string;
}

export interface EntryTie {
  key: string;
  /** "Semi-finals", or "Plate · Semi-finals". */
  round: string;
  a: TieSide;
  b: TieSide;
  state: "reported" | "to-play" | "decided";
  /** The winner, on a decided tie; "" otherwise. */
  winnerId: string;
  /** How a decided tie was won, in golf's words with its leading space (" 3&2", " by walkover"), or "". */
  margin: string;
  /** A player's report waiting on staff, on a reported tie. */
  report: { winnerId: string; winner: string; margin: string; reportedBy: string } | null;
}

/**
 * THE KNOCKOUT AS SCORE ENTRY LISTS IT: every tie of every draw (`bracketDraws`,
 * so every flight) that two players can play, in the order a secretary works:
 * reported first (somebody is waiting on an answer), then ready to play, then
 * decided. `waiting` counts the ties that cannot be played yet (a TBD seat).
 * A first-round bye is not a tie and is in neither.
 */
export function scoreEntryTies(
  draws: Draws,
  reports: readonly { key: string; winnerId: string; result: string; reportedBy: string }[],
  results: Readonly<Record<string, string>>,
): { ties: EntryTie[]; waiting: number } {
  const reportByKey = new Map(reports.map((r) => [r.key, r]));
  const reported: EntryTie[] = [];
  const toPlay: EntryTie[] = [];
  const decided: EntryTie[] = [];
  let waiting = 0;
  for (const { label, view } of draws) {
    for (const rd of view.rounds) {
      for (const m of rd.matches) {
        if (m.a.bye || m.b.bye) continue;
        if (tieNotReady(m)) {
          waiting += 1;
          continue;
        }
        const a = { id: m.a.playerId!, name: m.a.name };
        const b = { id: m.b.playerId!, name: m.b.name };
        const base = { key: m.key, round: roundWords(label, rd.label), a, b };
        if (m.winnerId) {
          decided.push({ ...base, state: "decided", winnerId: m.winnerId, margin: marginWords(results[m.key]), report: null });
          continue;
        }
        const r = reportByKey.get(m.key);
        // A report for a winner who is not in this tie any more is not a question
        // this tie can answer (`openTieReport` sets it aside the same way).
        const winner = r ? (r.winnerId === a.id ? a.name : r.winnerId === b.id ? b.name : "") : "";
        if (r && winner) {
          reported.push({
            ...base,
            state: "reported",
            winnerId: "",
            margin: "",
            report: { winnerId: r.winnerId, winner, margin: marginWords(r.result), reportedBy: r.reportedBy },
          });
        } else {
          toPlay.push({ ...base, state: "to-play", winnerId: "", margin: "", report: null });
        }
      }
    }
  }
  return { ties: [...reported, ...toPlay, ...decided], waiting };
}

/** What the bar says after a result is recorded: "Ann Ash goes through." */
export function goesThroughWords(t: Pick<EntryTie, "a" | "b">, winnerId: string): string {
  const w = winnerId === t.a.id ? t.a : winnerId === t.b.id ? t.b : null;
  return w ? `${w.name} goes through.` : "";
}
