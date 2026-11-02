/**
 * THE HIGHLIGHTS AND THE NUMBERS OF A TOURNAMENT, read off its cards
 * (Ajay, 2026-10-21: "the highlights and player accomplishments … whatever we
 * build should come from real app").
 *
 * Pure: the caller hands over every round's cards as the board reads them —
 * the right TABLE for the format (`roundStrokes`) and the right COURSE for the
 * round (`state.strokeCourseFor`, never the tournament's card for an away
 * round) — and this says what happened on them. Nothing here ranks a field or
 * prices a handicap: the BEST ROUND is the board's, not this file's, and the
 * biggest climb is the movement's.
 *
 * Two kinds of fact, and a round is asked only the kind it can answer:
 *
 *   a ball's facts      an ace, an eagle, a birdie. True of a player's own
 *                       ball on any card that carries one — a medal, a
 *                       four-ball, a match played on full cards.
 *   a card's facts      the lowest gross, the best nine, the longest run of
 *                       par or better, the hardest hole. Only on a STROKE
 *                       round (`strokePlay`): in a four-ball a partner picks
 *                       up, in a match a hole is conceded, and a total made
 *                       of those is not a score anybody went round in.
 *
 * A shared-ball card (foursomes, a scramble) never arrives at all: it names no
 * player, and a birdie on it is the side's, not one person's. Said here rather
 * than guessed at — the report leaves the section out.
 *
 * Nothing is reported off a hole without a par where the fact needs one, and
 * a tie is always said as a tie: every holder is listed.
 */

export interface HighlightCard {
  playerId: string;
  name: string;
  /** One entry per hole of the round as played, null where nothing is written. */
  strokes: ReadonlyArray<number | null>;
  /**
   * A Stableford hole the player PICKED UP on (2026-10-23). The card stores a
   * pick-up as a net double bogey — no points, and the card still complete —
   * so its figure is not a score anybody holed out in. It is left out of every
   * card fact and every hole's average: "the hardest hole" is not the one most
   * people walked off.
   */
  pickedUp?: ReadonlyArray<boolean>;
}

export interface HighlightRound {
  stageId: string;
  /** "Round 2", as the board labels it. */
  label: string;
  /** Holes the round is played over (9 or 18). */
  holes: number;
  /** The number of the first hole on the card: 10 for a back nine, else 1. */
  firstHole: number;
  /** Par for each hole of the card as played; 0 where nobody knows. */
  pars: ReadonlyArray<number>;
  /** A stroke round, whose card totals mean something — see the header. */
  strokePlay: boolean;
  /** Which course the round is on, so a hole at one venue is never averaged with another's. */
  venue: string;
  cards: ReadonlyArray<HighlightCard>;
}

/** Somebody, on a round. */
export interface Holder {
  name: string;
  round: string;
}

/** A hole-in-one, an eagle or an albatross. */
export interface Feat extends Holder {
  hole: number;
  par: number;
  strokes: number;
  what: "hole-in-one" | "eagle" | "albatross";
}

export interface HoleStat {
  hole: number;
  venue: string;
  par: number;
  /** Strokes taken there, on average, over every score written on it. */
  average: number;
  /** `average - par`. */
  overPar: number;
  scores: number;
}

export interface ReportHighlights {
  /** Every hole-in-one, in play order. */
  aces: Feat[];
  /** Every eagle or better that was not a hole-in-one, in play order. */
  eagles: Feat[];
  /** The lowest complete gross card over the full length of the longest stroke rounds. */
  lowestGross: { score: number; holders: Holder[] } | null;
  /** The nine played in the fewest strokes against its par. */
  bestNine: { score: number; toPar: number; holders: Array<Holder & { nine: "front" | "back" }> } | null;
  /** The longest run of consecutive holes at par or better — three or more. */
  longestRun: { length: number; holders: Array<Holder & { from: number; to: number }> } | null;
  /** The most birdies on one card — two or more. */
  mostBirdiesInARound: { count: number; holders: Holder[] } | null;
  /** The most birdies across every round — two or more, and only with more than one round. */
  mostBirdies: { count: number; names: string[] } | null;
  numbers: {
    /** Complete cards on the stroke rounds. */
    cards: number;
    /** Birdies made (exactly one under par), on every card that carries a ball. */
    birdies: number;
    /** Eagles or better, holes-in-one included. */
    eagles: number;
    /** Players with a complete card in every stroke round; null with fewer than two. */
    everyRound: number | null;
    /** The hole or holes played furthest over par on average; empty with fewer than two holes. */
    hardest: HoleStat[];
    /** And nearest to it, or under it. Empty where it would be the same holes as the hardest. */
    easiest: HoleStat[];
  };
}

/** A stroke somebody actually wrote: a whole number of one or more. */
function isStroke(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/** Every hole of the round has a stroke on it. */
function complete(card: HighlightCard, holes: number): boolean {
  for (let i = 0; i < holes; i += 1) if (!isStroke(card.strokes[i])) return false;
  return true;
}

function sum(xs: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** Keep only the entries sharing the best value, by a comparison that returns <0 when `a` is better. */
function best<T>(items: T[], better: (a: T, b: T) => number): T[] {
  let out: T[] = [];
  for (const it of items) {
    if (out.length === 0) {
      out = [it];
      continue;
    }
    const c = better(it, out[0]);
    if (c < 0) out = [it];
    else if (c === 0) out.push(it);
  }
  return out;
}

export function reportHighlights(asReturned: ReadonlyArray<HighlightRound>): ReportHighlights {
  // A picked-up hole is a hole with no score in it, for every fact below; the
  // card it is on is still a returned card (counted off `asReturned`).
  const rounds: HighlightRound[] = asReturned.map((r) => ({
    ...r,
    cards: r.cards.map((c) => (c.pickedUp ? { ...c, strokes: c.strokes.map((s, i) => (c.pickedUp?.[i] ? null : s)) } : c)),
  }));
  const aces: Feat[] = [];
  const eagles: Feat[] = [];
  let birdies = 0;
  const birdiesBy = new Map<string, { name: string; count: number }>();
  const birdieCards: Array<Holder & { count: number }> = [];

  for (const r of rounds) {
    for (const card of r.cards) {
      let onCard = 0;
      for (let i = 0; i < r.holes; i += 1) {
        const s = card.strokes[i];
        if (!isStroke(s)) continue;
        const par = r.pars[i] ?? 0;
        const hole = r.firstHole + i;
        if (s === 1) {
          aces.push({ name: card.name, round: r.label, hole, par, strokes: s, what: "hole-in-one" });
          continue;
        }
        if (par <= 0) continue;
        const under = par - s;
        if (under >= 2) {
          eagles.push({ name: card.name, round: r.label, hole, par, strokes: s, what: under >= 3 ? "albatross" : "eagle" });
        } else if (under === 1) {
          onCard += 1;
        }
      }
      birdies += onCard;
      if (onCard > 0) {
        birdieCards.push({ name: card.name, round: r.label, count: onCard });
        const had = birdiesBy.get(card.playerId);
        birdiesBy.set(card.playerId, { name: card.name, count: (had?.count ?? 0) + onCard });
      }
    }
  }

  const stroke = rounds.filter((r) => r.strokePlay);

  // ── The lowest gross: complete cards, over the longest rounds only ────────
  // A nine is not compared with an eighteen.
  const longest = Math.max(0, ...stroke.map((r) => r.holes));
  const totals: Array<Holder & { score: number }> = [];
  let cards = 0;
  for (const r of asReturned.filter((x) => x.strokePlay)) {
    for (const card of r.cards) if (complete(card, r.holes)) cards += 1;
  }
  for (const r of stroke) {
    for (const card of r.cards) {
      if (!complete(card, r.holes)) continue;
      if (r.holes === longest) {
        totals.push({ name: card.name, round: r.label, score: sum(card.strokes.slice(0, r.holes) as number[]) });
      }
    }
  }
  const low = best(totals, (a, b) => a.score - b.score);
  const lowestGross = low.length ? { score: low[0].score, holders: low.map(({ name, round }) => ({ name, round })) } : null;

  // ── The best nine, against its own par ────────────────────────────────────
  const nines: Array<Holder & { nine: "front" | "back"; score: number; toPar: number }> = [];
  for (const r of stroke) {
    const spans: Array<{ start: number; nine: "front" | "back" }> =
      r.holes === 18
        ? [
            { start: 0, nine: "front" },
            { start: 9, nine: "back" },
          ]
        : r.holes === 9
          ? [{ start: 0, nine: r.firstHole === 10 ? "back" : "front" }]
          : [];
    for (const { start, nine } of spans) {
      const pars = r.pars.slice(start, start + 9);
      if (pars.length < 9 || pars.some((p) => !(p > 0))) continue;
      for (const card of r.cards) {
        const strokes = card.strokes.slice(start, start + 9);
        if (strokes.length < 9 || !strokes.every(isStroke)) continue;
        const score = sum(strokes as number[]);
        nines.push({ name: card.name, round: r.label, nine, score, toPar: score - sum(pars) });
      }
    }
  }
  const nine = best(nines, (a, b) => a.toPar - b.toPar);
  const bestNine = nine.length
    ? {
        score: nine[0].score,
        toPar: nine[0].toPar,
        holders: nine.map(({ name, round, nine: n }) => ({ name, round, nine: n })),
      }
    : null;

  // ── The longest run at par or better ──────────────────────────────────────
  const runs: Array<Holder & { length: number; from: number; to: number }> = [];
  for (const r of stroke) {
    for (const card of r.cards) {
      let top = { length: 0, from: 0 };
      let length = 0;
      let from = 0;
      for (let i = 0; i < r.holes; i += 1) {
        const s = card.strokes[i];
        const par = r.pars[i] ?? 0;
        if (isStroke(s) && par > 0 && s <= par) {
          if (length === 0) from = i;
          length += 1;
          // The FIRST of two equal runs on one card is the one named.
          if (length > top.length) top = { length, from };
        } else {
          length = 0;
        }
      }
      if (top.length > 0) {
        runs.push({ name: card.name, round: r.label, length: top.length, from: r.firstHole + top.from, to: r.firstHole + top.from + top.length - 1 });
      }
    }
  }
  const run = best(runs, (a, b) => b.length - a.length);
  const longestRun =
    run.length && run[0].length >= 3
      ? { length: run[0].length, holders: run.map(({ name, round, from, to }) => ({ name, round, from, to })) }
      : null;

  // ── Birdies ───────────────────────────────────────────────────────────────
  const mostOnACard = best(birdieCards, (a, b) => b.count - a.count);
  const mostBirdiesInARound =
    mostOnACard.length && mostOnACard[0].count >= 2
      ? { count: mostOnACard[0].count, holders: mostOnACard.map(({ name, round }) => ({ name, round })) }
      : null;
  /**
   * ROUNDS THAT HAVE BEEN PLAYED, which is not the rounds that exist
   * (walked 2026-10-23). A league of seven weeks with four played reported
   * "0 played every round": every member was charged the three weeks nobody
   * has reached. A round with no card on it has not happened yet.
   */
  const played = rounds.filter((r) => r.cards.some((c) => c.strokes.some(isStroke)));
  const across = best([...birdiesBy.values()], (a, b) => b.count - a.count);
  const mostBirdies =
    played.length > 1 && across.length && across[0].count >= 2
      ? { count: across[0].count, names: across.map((a) => a.name) }
      : null;

  // ── Played every round ────────────────────────────────────────────────────
  let everyRound: number | null = null;
  const strokePlayed = stroke.filter((r) => played.includes(r));
  if (strokePlayed.length > 1) {
    const seen = new Map<string, number>();
    for (const r of strokePlayed) {
      // A returned card, pick-ups and all.
      const card = asReturned[rounds.indexOf(r)] ?? r;
      for (const id of new Set(card.cards.filter((c) => complete(c, r.holes)).map((c) => c.playerId))) {
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    everyRound = [...seen.values()].filter((n) => n === strokePlayed.length).length;
  }

  // ── The hardest and easiest holes, by strokes over par on average ─────────
  const byHole = new Map<string, { hole: number; venue: string; par: number; strokes: number; scores: number }>();
  for (const r of stroke) {
    for (let i = 0; i < r.holes; i += 1) {
      const par = r.pars[i] ?? 0;
      if (!(par > 0)) continue;
      const hole = r.firstHole + i;
      const key = `${r.venue}\u0000${hole}`;
      for (const card of r.cards) {
        const s = card.strokes[i];
        if (!isStroke(s)) continue;
        const at = byHole.get(key) ?? { hole, venue: r.venue, par, strokes: 0, scores: 0 };
        at.strokes += s;
        at.scores += 1;
        byHole.set(key, at);
      }
    }
  }
  const holes = [...byHole.values()].sort((a, b) => (a.venue === b.venue ? a.hole - b.hole : a.venue.localeCompare(b.venue)));
  // Compared as fractions, so two holes level on average are level exactly
  // rather than by whatever a float rounds them to.
  const over = (h: (typeof holes)[number]) => h.strokes - h.par * h.scores;
  const harder = (a: (typeof holes)[number], b: (typeof holes)[number]) => over(b) * a.scores - over(a) * b.scores;
  const stat = (h: (typeof holes)[number]): HoleStat => ({
    hole: h.hole,
    venue: h.venue,
    par: h.par,
    average: h.strokes / h.scores,
    overPar: h.strokes / h.scores - h.par,
    scores: h.scores,
  });
  const hardest = holes.length > 1 ? best(holes, harder) : [];
  const easiest = holes.length > 1 ? best(holes, (a, b) => harder(b, a)) : [];
  const sameHoles = hardest.length > 0 && easiest.length === hardest.length && easiest.every((h) => hardest.includes(h));

  return {
    aces,
    eagles,
    lowestGross,
    bestNine,
    longestRun,
    mostBirdiesInARound,
    mostBirdies,
    numbers: {
      cards,
      birdies,
      eagles: aces.length + eagles.length,
      everyRound,
      hardest: hardest.map(stat),
      easiest: sameHoles ? [] : easiest.map(stat),
    },
  };
}

/** "Two under par", "level par", "one over par" — a nine against its par, in words. */
export function toParWords(toPar: number): string {
  if (toPar === 0) return "level par";
  const n = Math.abs(toPar);
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const count = n < words.length ? words[n] : String(n);
  return `${count} ${toPar < 0 ? "under" : "over"} par`;
}

/** "6.5" — an average to one place, written as the app writes a handicap index. */
export function averageWords(average: number): string {
  return (Math.round(average * 10) / 10).toFixed(1);
}
