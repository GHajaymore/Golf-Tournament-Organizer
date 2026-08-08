/**
 * Spoken questions, answered from the round's own data.
 *
 * Dictation writes scores; this reads them back. The questions a player
 * actually asks on a tee are few and specific — what do I play off, who am I
 * playing, where do I stand — and every answer already exists in the loaded
 * event state. No network, no model: a recognizer this narrow can run on the
 * transcript alone, and being narrow is what makes it trustworthy. Anything
 * it does not recognize says so, rather than guessing at golf it wasn't
 * asked about.
 *
 * The parser and the answerer are separate on purpose. Parsing is pure text →
 * intent and is where the tests live; answering needs the snapshot the screen
 * already holds and stays a thin lookup.
 */

export type VoiceQuery =
  | { kind: "handicap"; round: number | null }
  | { kind: "opponent"; round: number | null }
  | { kind: "standing" }
  | { kind: "score"; round: number | null }
  | { kind: "unknown" };

/** "round two", "round 2", "rnd 2" → 2; absent → null (the current round). */
function roundIn(t: string): number | null {
  const m = /\br(?:ou)?nd\s+(\d+|one|two|three|four|five|six)\b/.exec(t);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  return words[m[1]] ?? parseInt(m[1], 10);
}

/**
 * Recognize one spoken question.
 *
 * Word-boundary tests throughout — "handicap" must not fire inside a name,
 * and the score intent must not swallow the standing intent ("where do I
 * stand" contains no "score" but "what's my score" must not read as a
 * standings question).
 */
export function parseVoiceQuery(transcript: string): VoiceQuery {
  const t = transcript.toLowerCase().trim();
  const round = roundIn(t);

  if (/\bhandicaps?\b|\bplay(ing)? off\b|\bstrokes? do i (get|receive)\b/.test(t)) {
    return { kind: "handicap", round };
  }
  if (/\bwho\b.*\b(play(ing)?|against|opponents?)\b|\bopponents?\b|\bmy match\b/.test(t)) {
    return { kind: "opponent", round };
  }
  if (/\bwhere\b.*\bstand\b|\bstandings?\b|\bposition\b|\bleaderboard\b|\bplace\b/.test(t)) {
    return { kind: "standing" };
  }
  if (/\bscore\b|\bhow am i doing\b|\bthru\b|\bthrough\b/.test(t)) {
    return { kind: "score", round };
  }
  return { kind: "unknown" };
}

/** Everything the answerer may know. All optional: it answers what it can. */
export interface VoiceContext {
  /** The person asking. */
  playerName: string;
  /** Playing handicap by round number (1-based), for the rounds that exist. */
  handicapByRound?: Record<number, number>;
  /** The round the screen currently shows. */
  currentRound?: number;
  /** Opponent name by round, for match play. */
  opponentByRound?: Record<number, string>;
  /** Current leaderboard position and field size. */
  position?: { rank: number; of: number };
  /** Current score summary, already formatted ("+3 thru 12"). */
  scoreText?: string;
}

/**
 * One spoken answer.
 *
 * Written to be read aloud by a screen reader or shown as a toast — one
 * sentence, no markup, and honest when the data isn't there: "no round 4"
 * beats silence, and beats an invented number by more.
 */
export function answerVoiceQuery(q: VoiceQuery, ctx: VoiceContext): string {
  const round = (r: number | null) => r ?? ctx.currentRound ?? null;

  switch (q.kind) {
    case "handicap": {
      const r = round(q.round);
      if (r === null || !ctx.handicapByRound) return "I don't have handicaps to hand for this round.";
      const h = ctx.handicapByRound[r];
      if (h === undefined) return `There's no round ${r} in this tournament.`;
      return `Your playing handicap for round ${r} is ${h}.`;
    }
    case "opponent": {
      const r = round(q.round);
      if (r === null || !ctx.opponentByRound) return "I can't see a match for you in this round.";
      const o = ctx.opponentByRound[r];
      if (!o) return `No opponent drawn for you in round ${r} yet.`;
      return `Round ${r}: you're playing ${o}.`;
    }
    case "standing": {
      if (!ctx.position) return "No standings yet — nothing has been scored.";
      return `You're ${ordinal(ctx.position.rank)} of ${ctx.position.of}.`;
    }
    case "score": {
      if (!ctx.scoreText) return "No score recorded for you yet.";
      return `You're ${ctx.scoreText}.`;
    }
    default:
      return 'I can answer "what\'s my handicap", "who am I playing", "where do I stand" and "what\'s my score".';
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
