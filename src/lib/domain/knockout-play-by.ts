import { cleanIsoDate, shortDate } from "./round-dates";
import { isByeTie } from "./bracket-layout";
import { winnerOfWords, type BracketMatch, type BracketView } from "./bracket";

/**
 * A KNOCKOUT'S "PLAY BY" DATES, AND WHAT EACH SURFACE OPENS ON (the panel,
 * 2026-10-23; `docs/bracket-panel-2026-10-23.md`, part b).
 *
 * The dates are stored on the knockout's round (`Stage.knockoutPlayBy`) as JSON,
 * rounds counted BACK FROM THE FINAL — "0" the final, "1" the semi-finals, "2"
 * the quarter-finals — so one set of dates serves every flight of a knockout in
 * flights, whatever its size: every flight's final is played by the same day.
 * This file is the only reader and writer of that column.
 *
 * A date is a DAY, and "Overdue" is decided against the CLUB's today
 * (`state.today`, `domain/club-clock.ts`), never the server's: a deadline of the
 * 12th is not passed at 8pm on the 12th in New York.
 */

/** Rounds back from the final → ISO day. */
export type PlayByDates = Record<number, string>;

export function parsePlayBy(json: string | null | undefined): PlayByDates {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: PlayByDates = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(k);
      const day = typeof v === "string" ? cleanIsoDate(v) : "";
      if (Number.isInteger(n) && n >= 0 && n < 12 && day) out[n] = day;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * What the Bracket screen sends, checked: a date per round back from the final,
 * each a real day or empty (no date). Refused, in words, for anything else —
 * and for a round played by a day AFTER a later round's, which a draw cannot do.
 */
export function cleanPlayBy(input: unknown): { ok: true; json: string; dates: PlayByDates } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Those dates could not be read." };
  const dates: PlayByDates = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || n >= 12) return { ok: false, error: "Those dates could not be read." };
    if (v === "" || v === null || v === undefined) continue;
    const day = typeof v === "string" ? cleanIsoDate(v) : "";
    if (!day) return { ok: false, error: "A play-by date is a day, like 2026-11-14." };
    dates[n] = day;
  }
  // From the earliest round to the final, no round may be due after the one it feeds.
  const back = Object.keys(dates).map(Number).sort((a, b) => b - a);
  for (let i = 1; i < back.length; i += 1) {
    if (dates[back[i - 1]] > dates[back[i]]) {
      return { ok: false, error: "A round can't be due after the round it feeds. Check the dates run in order to the final." };
    }
  }
  return { ok: true, json: Object.keys(dates).length ? JSON.stringify(dates) : "", dates };
}

/** Rounds back from the final, for a round of this draw. */
export function fromFinal(view: Pick<BracketView, "rounds">, roundIndex: number): number {
  return view.rounds.length - 1 - roundIndex;
}

export interface PlayBy {
  /** ISO day. */
  iso: string;
  /** "Sat 14 Nov", in the club's own words. */
  words: string;
  /** The club's today is past it. */
  overdue: boolean;
}

/** The club's today is after the day: "Overdue" from the morning after. */
export function isOverdue(iso: string, today: string): boolean {
  return !!iso && !!today && today > iso;
}

/** Each round of this draw's play-by date, by round index; a round with none is absent. */
export function roundPlayBy(view: Pick<BracketView, "rounds">, dates: PlayByDates, today: string, locale: string): Record<number, PlayBy> {
  const out: Record<number, PlayBy> = {};
  view.rounds.forEach((_, r) => {
    const iso = dates[fromFinal(view, r)];
    if (iso) out[r] = { iso, words: shortDate(iso, locale), overdue: isOverdue(iso, today) };
  });
  return out;
}

/** A tie a secretary can record: two players known, no result. */
export function tieToPlay(m: Pick<BracketMatch, "a" | "b" | "winnerId">): boolean {
  return !!m.a.playerId && !!m.b.playerId && !m.winnerId;
}

export interface ToPlayRound {
  draw: string;
  roundIndex: number;
  round: string;
  playBy: PlayBy | null;
  ties: BracketMatch[];
}

/**
 * "TO PLAY" — what the secretary's Bracket screen opens on: every tie that can be
 * played now (both players known, no result), round by round and in draw order
 * within a round, earliest round first, with the round's play-by date. A tie
 * still waiting on the one before it is not here; it is counted (`waiting`).
 */
export function toPlay(
  draws: ReadonlyArray<{ label: string; view: BracketView }>,
  dates: PlayByDates,
  today: string,
  locale: string,
): { rounds: ToPlayRound[]; waiting: number } {
  const rounds: ToPlayRound[] = [];
  let waiting = 0;
  for (const { label, view } of draws) {
    const playBy = roundPlayBy(view, dates, today, locale);
    view.rounds.forEach((rd, r) => {
      const ties = rd.matches.filter(tieToPlay);
      waiting += rd.matches.filter((m) => !m.winnerId && !isByeTie(m) && !tieToPlay(m)).length;
      if (ties.length) rounds.push({ draw: label, roundIndex: r, round: rd.label, playBy: playBy[r] ?? null, ties });
    });
  }
  rounds.sort((a, b) => a.roundIndex - b.roundIndex);
  return { rounds, waiting };
}

/** One knockout result in a sentence: "Round 2: Ann Ash beat Bob Birch". The margin is added by the caller. */
export function resultLine(round: string, m: Pick<BracketMatch, "a" | "b" | "winnerId">): string {
  const won = m.winnerId === m.a.playerId ? m.a : m.b;
  const lost = won === m.a ? m.b : m.a;
  return `${round}: ${won.name} beat ${lost.name}`;
}

/**
 * "LATEST RESULTS" on the public board: the decided ties of the furthest round
 * anybody has reached, and of the round before it when that round finished
 * fewer than `atLeast` — results are posted a round at a time, and the newest
 * round is the news. Byes are not results.
 */
export function latestResults(
  draws: ReadonlyArray<{ label: string; view: BracketView }>,
  atLeast = 4,
): Array<{ draw: string; round: string; match: BracketMatch }> {
  const out: Array<{ draw: string; round: string; match: BracketMatch }> = [];
  for (const { label, view } of draws) {
    const decided = view.rounds.map((rd) => rd.matches.filter((m) => m.winnerId && !isByeTie(m)));
    let r = decided.length - 1;
    while (r >= 0 && decided[r].length === 0) r -= 1;
    const mine: typeof out = [];
    for (; r >= 0 && mine.length < atLeast; r -= 1) {
      for (const m of decided[r]) mine.push({ draw: label, round: view.rounds[r].label, match: m });
    }
    out.push(...mine);
  }
  return out;
}

/**
 * "Win, and you play …" — where a player's next tie comes from: their opponent
 * there if already through, the two players of the tie that decides it if both
 * are known, or the round it is in. The final's line is the championship.
 */
export function nextTieWords(view: BracketView, m: BracketMatch): string {
  const r = m.roundIndex;
  if (r === view.rounds.length - 1) return "Win, and you are the champion.";
  const sibling = view.rounds[r].matches[m.matchIndex ^ 1];
  const next = view.rounds[r + 1].label;
  if (!sibling) return `Win, and you are through to the ${next.toLowerCase()}.`;
  if (sibling.winnerId) {
    const through = sibling.winnerId === sibling.a.playerId ? sibling.a.name : sibling.b.name;
    return `Win, and you play ${through} in the ${next.toLowerCase()}.`;
  }
  // A bye sends its player through without a result: that player is who is next.
  if (isByeTie(sibling)) return `Win, and you play ${(sibling.a.playerId ? sibling.a : sibling.b).name} in the ${next.toLowerCase()}.`;
  const words = winnerOfWords(sibling);
  if (words) return `Win, and you play the ${words.charAt(0).toLowerCase()}${words.slice(1)}.`;
  return `Win, and you are through to the ${next.toLowerCase()}.`;
}

/**
 * The strokes in a net singles match: the difference between the two playing
 * handicaps, given in full (singles match play: 100% of the difference). From
 * the player's own side.
 */
export function strokesWords(mine: number, theirs: number, net: boolean, opponent: string): string {
  if (!net) return "Off scratch: no strokes either way.";
  const d = Math.round(mine) - Math.round(theirs);
  if (d === 0) return `Level: no strokes either way (both off ${Math.round(mine)}).`;
  const n = Math.abs(d);
  return d > 0
    ? `You receive ${n} ${n === 1 ? "stroke" : "strokes"} from ${opponent} (${Math.round(mine)} v ${Math.round(theirs)}).`
    : `You give ${opponent} ${n} ${n === 1 ? "stroke" : "strokes"} (${Math.round(mine)} v ${Math.round(theirs)}).`;
}
