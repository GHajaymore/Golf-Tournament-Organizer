/**
 * THE TOURNAMENT RESULT: what happened, round by round, whatever was played.
 *
 * EVERY KIND OF PLAY IS A TOURNAMENT — Ajay, 2026-09-19: "any golf play is a
 * tournament including outing, charity, league, etc." An outing, a charity
 * day, a club championship and a weekly league are one model with different
 * rounds in it, which is why this reads rounds and knows nothing about what
 * the day was called. The one thing that is NOT a tournament is a casual
 * round, which carries an expiry and is deliberately kept out of a club's
 * fixtures and history.
 *
 * The rounds are not the same game as each other — the example that provoked
 * this is forty players who play a two-team stroke-play nine, then a pairs
 * match-play nine, then an individual round. Each of those already has a
 * board; what nothing said was "so what happened today", and a member had to
 * visit three screens and remember.
 *
 * ONE RESULT PER ROUND, IN THE WORDS THAT ROUND USES. A medal has a winner and
 * a score; a match has a margin ("5&4") and no score at all; a team round has
 * a side; a round scored by hand has whatever the committee posted. Printing
 * them in one column with one heading is the whole feature.
 *
 * NO COMBINED RANKING, deliberately. Adding a team stroke total, a match
 * result and an individual medal into one number invents a result nobody
 * played for — and the honest way to have an overall is points per round,
 * which is what a league does and what a club has to choose. If that is ever
 * wanted, it belongs beside this and not inside it.
 *
 * Pure: it takes each round's outcome already resolved, so every shape below
 * can be swept without a database.
 */

/** A side or a player who won something, with whatever their score was. */
export interface Winner {
  name: string;
  /** "−4", "71", "38 pts", or "" where the format has no score to show. */
  score?: string;
}

export type RoundOutcome =
  /** A medal, a Stableford, anything ranked by a card. */
  | { kind: "stroke"; label: string; winners: Winner[]; unit?: string }
  /** A round played by sides rather than by people. */
  | { kind: "team"; label: string; winners: Winner[] }
  /** One match, decided or halved. */
  | { kind: "match"; label: string; winner: string; loser: string; margin: string }
  /** Scored by hand — the committee posts the result. */
  | { kind: "manual"; label: string; note: string }
  /** Played, or not, but nothing settled yet. */
  | { kind: "pending"; label: string; note?: string };

export interface OutingLine {
  /** The round, as the organizer named it. */
  label: string;
  /** One sentence: who won, and how. */
  result: string;
  /** True once this round's result can no longer change. */
  settled: boolean;
}

/** "A and B", "A, B and C" — a tie is shared, never broken here. */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function winnersLine(winners: Winner[], unit: string, tiedWord: string): string {
  const named = winners.filter((w) => w.name.trim());
  if (named.length === 0) return "No result";
  const names = joinNames(named.map((w) => w.name));
  const score = named[0].score?.trim() ?? "";
  // Every winner of a shared place has the same score — it is what makes it
  // shared — so it is printed once rather than repeated after each name.
  const scored = score ? `${names} · ${score}${unit ? ` ${unit}` : ""}` : names;
  return named.length > 1 ? `${tiedWord} ${scored}` : scored;
}

/**
 * The day, as a member reads it afterwards.
 *
 * Order is the caller's: rounds come in the order they were played, and this
 * does not sort them. A day reads forwards.
 */
export function tournamentResult(rounds: readonly RoundOutcome[]): OutingLine[] {
  return rounds.map((round) => {
    switch (round.kind) {
      case "stroke":
        return {
          label: round.label,
          result: winnersLine(round.winners, round.unit ?? "", "Tied:"),
          settled: round.winners.some((w) => w.name.trim().length > 0),
        };
      case "team":
        return {
          label: round.label,
          result: winnersLine(round.winners, "", "Tied:"),
          settled: round.winners.some((w) => w.name.trim().length > 0),
        };
      case "match": {
        // "halved" is a result, not a winner, and reads as a sentence of its
        // own: nobody "beat" anybody by it.
        const halved = !round.winner.trim() || round.margin.toLowerCase() === "halved";
        return {
          label: round.label,
          result: halved
            ? `${round.loser.trim() ? `${round.winner || "Both sides"} and ${round.loser}` : "Halved"} — halved`.trim()
            : `${round.winner} beat ${round.loser} ${round.margin}`.trim(),
          settled: true,
        };
      }
      case "manual":
        return {
          label: round.label,
          result: round.note.trim() || "Scored by hand — with the committee",
          settled: round.note.trim().length > 0,
        };
      case "pending":
      default:
        return {
          label: round.label,
          result: round.note?.trim() || "Not settled yet",
          settled: false,
        };
    }
  });
}

/**
 * One line for the whole day, for a card that shows the outing at a glance.
 *
 * Counts rather than concludes: "3 rounds · 2 settled" is true of any
 * combination of games, where "the winner was…" is only true of a day that
 * had one.
 */
export function resultSummary(lines: readonly OutingLine[]): string {
  if (lines.length === 0) return "Nothing played yet";
  const settled = lines.filter((l) => l.settled).length;
  const rounds = `${lines.length} round${lines.length === 1 ? "" : "s"}`;
  if (settled === lines.length) return `${rounds} · all settled`;
  if (settled === 0) return `${rounds} · nothing settled yet`;
  return `${rounds} · ${settled} settled`;
}
