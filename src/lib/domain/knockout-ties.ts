import { tieNotReady, type BracketMatch, type BracketView } from "./bracket";
import { marginWords } from "./my-tie";
import { storedMatchIsOver, resolveMatch } from "./match";
import type { HoleResult } from "./types";

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

/**
 * "Semi-finals", or "Plate · Semi-finals" where there is more than one draw: how a
 * tie's round is named in every sentence and audit line about it. The one place
 * the label is put together.
 */
export function drawRoundWords(draw: string, round: string): string {
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

/** The play-off for third as the rule needs it: who is in it, and whether it has been played. */
export interface ThirdPlaceFact {
  playerIds: readonly string[];
  /** Scores are in, or it was conceded: it has HAPPENED, and is held like a result. */
  played: boolean;
}

/** The key the play-off for third answers to in the list and in a refusal's link. */
export const THIRD_PLACE_KEY = "third-place";

/**
 * WHY A TIE'S RESULT IS HELD: the refusal in words, the result to take back first
 * (`heldBy`, a tie's key or `THIRD_PLACE_KEY`, so the screen links to its card), and
 * how many results the correction would take back with it (`undoes`).
 */
export interface TieHold {
  said: string;
  heldBy: string;
  undoes: number;
}

/**
 * WHY THIS TIE'S RESULT CAN NO LONGER BE CHANGED OR TAKEN BACK, or null when it can.
 *
 * Its winner has played on: the tie it feeds has a result of its own. Changing it
 * now would take that later result off the draw without a word (the draw is
 * rebuilt by position, and a stored winner whose opponent changed is dropped), so
 * the refusal names what rests on it, latest first, and the way out in the words
 * of the controls that do it: Change result on that tie (or, on the Bracket, its
 * winner tapped again). A chain is counted: a quarter-final under a played
 * semi-final AND final undoes two.
 *
 * THE PLAY-OFF FOR THIRD is fed by the semi-finals' LOSERS (`third-place.ts`) and
 * stored as a match outside the draw. Once it has been played (`played`), a main
 * draw's semi-final, or a tie whose correction would undo one, is held the same way.
 * Made but not played, it holds nothing: its sides are drawn again from the
 * semi-finals (`syncThirdPlace`).
 *
 * A plate is drawn from the main draw's first-round losers, so once any plate tie
 * has a result, the main draw's first round is held as a whole.
 *
 * `plate` is whether the second draw is a plate (`Event.bracketMode === "plate"`);
 * the draws are `bracketDraws(state.brackets)`, every flight included.
 */
export function laterTieHold(
  draws: Draws,
  key: string,
  opts: { plate: boolean; thirdPlace?: ThirdPlaceFact | null },
): TieHold | null {
  const found = findTie(draws, key);
  if (!found) return null;
  const { view } = found;
  const label = (m: BracketMatch) => `${drawRoundWords(found.draw, view.rounds[m.roundIndex]?.label ?? "")}: ${m.a.name} v ${m.b.name}`;

  // Every later result built on this one, nearest first.
  const chain: BracketMatch[] = [];
  for (let cur = tieItFeeds(view, found.match); cur?.winnerId && cur.a.playerId && cur.b.playerId; cur = tieItFeeds(view, cur)) chain.push(cur);

  const semis = view.rounds.length - 2;
  const tp = opts.thirdPlace;
  const touchesSemi = found.index === 0 && semis >= 0 && [found.match, ...chain].some((m) => m.roundIndex === semis);
  const playoff = tp?.played && touchesSemi ? tp : null;

  if (chain.length > 0 || playoff) {
    const name = (id: string) => {
      for (const rd of view.rounds) for (const t of rd.matches) for (const s of [t.a, t.b]) if (s.playerId === id) return s.name;
      return "a player no longer in the draw";
    };
    const playoffWords = playoff ? `Play-off for third: ${name(playoff.playerIds[0])} v ${name(playoff.playerIds[1])}` : "";
    // Latest first: the one that can be taken back now leads.
    const resting = [...(playoff ? [playoffWords] : []), ...chain.slice().reverse().map(label)];
    const heldBy = playoff ? THIRD_PLACE_KEY : chain[chain.length - 1].key;
    const undoes = resting.length;
    const how = "with Change result on its card (on the Bracket, tap its winner again)";
    const said =
      undoes === 1
        ? playoff
          ? `${playoffWords} has been played, between this tie's loser and the other semi-final's. Take its result back first with Change result on the play-off's card, then change this one.`
          : `${resting[0]} already has a result, and this tie's winner played in it. Take that result back first ${how}, then change this one.`
        : `${undoes} later results rest on this one: ${resting.join("; then ")}. Take them back first, in that order, each ${how}, then change this one.`;
    return { said, heldBy, undoes };
  }

  if (opts.plate && found.index === 0 && found.match.roundIndex === 0 && draws[1]) {
    const plate = draws[1];
    const results = plate.view.rounds.reduce((n, rd) => n + rd.matches.filter((m) => m.winnerId && m.a.playerId && m.b.playerId).length, 0);
    if (results > 0) {
      const name = plate.label || "The plate";
      return {
        said: `${name} is drawn from this round's losers, and ${results === 1 ? "1 of its ties has a result" : `${results} of its ties have results`}. Take ${results === 1 ? "it" : "them"} back first, latest first, with Change result on each, then change this one.`,
        heldBy: "",
        undoes: results,
      };
    }
  }
  return null;
}

/**
 * The event's play-off for third, read off its matches: `round: 0` is the marker
 * `createThirdPlaceMatch` writes and nothing else does. PLAYED once a hole has a
 * result or it was conceded (what has happened, not what is arranged): a card half
 * filled in is a match under way, and its two players are no longer to be moved.
 */
export function thirdPlaceFrom(
  matches: readonly { round: number; playerAId: string; playerBId: string; holes: string; forfeitedBy?: string | null }[],
): (ThirdPlaceFact & { decided: boolean }) | null {
  const p = matches.find((x) => x.round === 0);
  if (!p) return null;
  let anyHole = false;
  try {
    const holes = JSON.parse(p.holes) as unknown[];
    anyHole = Array.isArray(holes) && holes.some((h) => h !== null);
  } catch {
    anyHole = false;
  }
  return { playerIds: [p.playerAId, p.playerBId], played: !!p.forfeitedBy || anyHole, decided: storedMatchIsOver(p) };
}

/**
 * THE PLAY-OFF FOR THIRD AS A CARD IN THE LIST (persona walk of cut 3): it is
 * the one tie fed by losers, stored as a match, and a refusal that names it must
 * point at a control. "to-play" (two name buttons), "under-way" (scores in, not
 * finished) or "decided" (who won, or halved: the two share third).
 */
export interface ThirdPlaceCard {
  matchId: string;
  a: TieSide;
  b: TieSide;
  state: "to-play" | "under-way" | "decided";
  /** The winner on a decided play-off; "" when halved or not decided. */
  winnerId: string;
}

export function thirdPlaceCard(
  matches: readonly { id: string; round: number; playerAId: string; playerBId: string; holes: string; forfeitedBy?: string | null }[],
  nameOf: (id: string) => string,
): ThirdPlaceCard | null {
  const p = matches.find((x) => x.round === 0);
  const fact = p ? thirdPlaceFrom([p]) : null;
  if (!p || !fact) return null;
  const a = { id: p.playerAId, name: nameOf(p.playerAId) };
  const b = { id: p.playerBId, name: nameOf(p.playerBId) };
  if (!fact.played) return { matchId: p.id, a, b, state: "to-play", winnerId: "" };
  if (!fact.decided) return { matchId: p.id, a, b, state: "under-way", winnerId: "" };
  let winnerId = "";
  if (p.forfeitedBy) winnerId = p.forfeitedBy === p.playerAId ? p.playerBId : p.forfeitedBy === p.playerBId ? p.playerAId : "";
  else {
    try {
      const w = resolveMatch(JSON.parse(p.holes) as HoleResult[]).winner;
      winnerId = w === "A" ? p.playerAId : w === "B" ? p.playerBId : "";
    } catch {
      winnerId = "";
    }
  }
  return { matchId: p.id, a, b, state: "decided", winnerId };
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
        const base = { key: m.key, round: drawRoundWords(label, rd.label), a, b };
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

/** What the tie says after its result is recorded, naming it: "Final: Ann Ash goes through." */
export function goesThroughWords(t: Pick<EntryTie, "round" | "a" | "b">, winnerId: string): string {
  const w = winnerId === t.a.id ? t.a : winnerId === t.b.id ? t.b : null;
  return w ? `${t.round}: ${w.name} goes through.` : "";
}
