import type { BracketMatch, BracketView } from "./bracket";

/**
 * HOW A KNOCKOUT IS DRAWN ON A SCREEN — sections, columns, where each tie sits
 * and the lines between them. One model behind every surface that shows a draw:
 * the organizer's Bracket screen, the player's Board and the club's public
 * board (`components/BracketDrawing.tsx` reads only this).
 *
 * Asked for by Ajay on 2026-10-23 after a knockout of 129 drew as one page
 * 16,341px tall: "we need to show entire bracket … including tabs based on the
 * QF, SF, F or something better". What the tabs are was decided by his panel the
 * same day (`docs/bracket-panel-2026-10-23.md`):
 *
 *   more than 32 places   Quarter 1 · Quarter 2 · Quarter 3 · Quarter 4 · Finals · Whole draw
 *   17 to 32 places       Top half · Bottom half · Finals · Whole draw
 *   16 or fewer           no tabs: the whole draw
 *
 * A quarter is drawn from its first real tie to its quarter-final; a half holds
 * two quarters; Finals is quarter-finals → semi-finals → final. So every tie of
 * the draw is in exactly one quarter (or half) or in Finals — except a
 * quarter-final, which is the last column of its quarter AND the first of
 * Finals, and is counted in both on purpose.
 *
 * A BYE IS NEVER A BOX. A first-round tie with nobody in one place is not
 * played (`bracket.ts` already sends the seed through on its own); the seed is
 * drawn in their first real tie with "bye" beside the name. The first column of
 * a section is the first round with a real tie in it, so 129 entrants draw a
 * one-tie preliminary column in the quarter that holds 128 v 129 and start at
 * Round 1 everywhere else.
 */

export type SectionKey = "q1" | "q2" | "q3" | "q4" | "top" | "bottom" | "finals" | "whole";

export interface DrawSection {
  key: SectionKey;
  label: string;
  /** Every tie the section draws, by its key. A bye is not a tie and is never here. */
  keys: string[];
  /** Ties in it with no result yet — the number on the tab. */
  toPlay: number;
}

export interface SeatMark {
  /**
   * This player came into the tie off a bye in a round that is DRAWN as a round
   * (100 in a draw of 128: the 28 top seeds, in Round 2). Never for skipping a
   * preliminary round — a draw sheet does not mark that (`hasPreliminaryRound`).
   */
  bye: boolean;
  /** This place is filled by the one who comes through the preliminary round. */
  prelim: boolean;
}

export interface TieBox {
  match: BracketMatch;
  /** Which column (0 = the section's first round drawn). */
  col: number;
  /** The tie's centre, in seat units from the top (a seat is one unit tall; a tie two). */
  y: number;
  a: SeatMark;
  b: SeatMark;
}

export interface DrawColumn {
  roundIndex: number;
  label: string;
  ties: TieBox[];
}

/** A line from the tie that fed a place to that place: drawn as an elbow. */
export interface Connector {
  /** The tie the line leaves, and the tie whose place it runs into. */
  fromKey: string;
  toKey: string;
  fromCol: number;
  fromY: number;
  toCol: number;
  toY: number;
}

export interface DrawLayout {
  columns: DrawColumn[];
  connectors: Connector[];
  /** Total height in seat units. */
  height: number;
}

/** A first-round tie with nobody in one of its places: nobody plays it. */
export function isByeTie(m: Pick<BracketMatch, "roundIndex" | "a" | "b">): boolean {
  return m.roundIndex === 0 && (m.a.bye === true || m.b.bye === true);
}

/** Places on the sheet: two to the number of rounds. */
export function drawPlaces(view: BracketView): number {
  return 2 ** view.rounds.length;
}

/** Every tie in the subtree under (round, index), down to the first round. */
function subtreeKeys(view: BracketView, round: number, index: number, out: string[]): void {
  const m = view.rounds[round]?.matches[index];
  if (!m) return;
  if (round > 0) {
    subtreeKeys(view, round - 1, index * 2, out);
    subtreeKeys(view, round - 1, index * 2 + 1, out);
  }
  if (!isByeTie(m)) out.push(m.key);
}

/**
 * THE TABS OF A DRAW, in the order they are offered, "Whole draw" last.
 * A draw of 16 places or fewer has only the whole draw, and offers no tabs.
 */
export function drawSections(view: BracketView): DrawSection[] {
  const decided = new Set(view.rounds.flatMap((r) => r.matches.filter((m) => m.winnerId).map((m) => m.key)));
  const section = (key: SectionKey, label: string, keys: string[]): DrawSection => ({
    key,
    label,
    keys,
    toPlay: keys.filter((k) => !decided.has(k)).length,
  });
  const all: string[] = [];
  view.rounds.forEach((r) => r.matches.forEach((m) => !isByeTie(m) && all.push(m.key)));
  const whole = section("whole", "Whole draw", all);
  const places = drawPlaces(view);
  if (places <= 16 || view.rounds.length < 4) return [whole];

  const qf = view.rounds.length - 3;
  const quarter = (i: number) => {
    const keys: string[] = [];
    subtreeKeys(view, qf, i, keys);
    return keys;
  };
  const finals: string[] = [];
  for (let r = qf; r < view.rounds.length; r += 1) view.rounds[r].matches.forEach((m) => finals.push(m.key));

  const parts =
    places > 32
      ? ([0, 1, 2, 3] as const).map((i) => section(`q${i + 1}` as SectionKey, `Quarter ${i + 1}`, quarter(i)))
      : [
          section("top", "Top half", [...quarter(0), ...quarter(1)]),
          section("bottom", "Bottom half", [...quarter(2), ...quarter(3)]),
        ];
  return [...parts, section("finals", "Finals", finals), whole];
}

/**
 * WHERE EVERY TIE OF A SECTION SITS.
 *
 * A tidy tree, laid out from the final (or the section's quarter-finals) down:
 * a place filled from a tie the section draws takes that tie's height, and a
 * place filled from anywhere else — a bye, or a round this section does not
 * draw — is one seat of its own. A tie sits midway between its two places, so a
 * quarter-final is always centred between the two ties that feed it, and a
 * seed off a bye simply has no line running into their seat.
 *
 * `gap` is the space, in seats, between two neighbouring ties — the room the
 * organizer's result box hangs in.
 */
export function layoutSection(view: BracketView, keys: readonly string[], gap: number): DrawLayout {
  const inSection = new Set(keys);
  const drawn = (m: BracketMatch | undefined): m is BracketMatch => !!m && inSection.has(m.key) && !isByeTie(m);
  const boxes = new Map<string, { m: BracketMatch; y: number; a: SeatMark; b: SeatMark }>();
  const lines: Array<{ from: string; to: string; toY: number }> = [];
  let cursor = 0;

  const place = (round: number, index: number): number => {
    const m = view.rounds[round].matches[index];
    const feeders = [0, 1].map((s) => (round > 0 ? view.rounds[round - 1].matches[index * 2 + s] : undefined));
    const fed = feeders.map((f) => drawn(f));
    const centres: number[] = [];
    for (const s of [0, 1]) {
      if (s === 1 && (fed[0] || fed[1])) cursor += gap;
      if (fed[s]) centres.push(place(round - 1, index * 2 + s));
      else {
        centres.push(cursor + 0.5);
        cursor += 1;
      }
    }
    const y = (centres[0] + centres[1]) / 2;
    const prelim = view.preliminary === true;
    const mark = (s: 0 | 1): SeatMark => {
      const f = feeders[s];
      return {
        bye: !!f && isByeTie(f) && !prelim,
        prelim: !!f && prelim && f.roundIndex === 0 && !isByeTie(f),
      };
    };
    boxes.set(m.key, { m, y, a: mark(0), b: mark(1) });
    feeders.forEach((f, s) => {
      if (fed[s]) lines.push({ from: f!.key, to: m.key, toY: y + (s === 0 ? -0.5 : 0.5) });
    });
    return y;
  };

  // The roots: drawn ties whose next tie the section does not draw.
  const roots: Array<[number, number]> = [];
  view.rounds.forEach((rd, r) =>
    rd.matches.forEach((m, i) => {
      if (!drawn(m)) return;
      const parent = view.rounds[r + 1]?.matches[Math.floor(i / 2)];
      if (!parent || !drawn(parent)) roots.push([r, i]);
    }),
  );
  roots.forEach(([r, i], n) => {
    if (n > 0) cursor += gap;
    place(r, i);
  });

  const rounds = [...new Set([...boxes.values()].map((b) => b.m.roundIndex))].sort((a, b) => a - b);
  const colOf = new Map(rounds.map((r, c) => [r, c]));
  const columns: DrawColumn[] = rounds.map((r) => ({
    roundIndex: r,
    label: view.rounds[r].label,
    ties: view.rounds[r].matches
      .filter((m) => boxes.has(m.key))
      .map((m) => {
        const b = boxes.get(m.key)!;
        return { match: m, col: colOf.get(r)!, y: b.y, a: b.a, b: b.b };
      }),
  }));
  const connectors: Connector[] = lines.map((l) => {
    const from = boxes.get(l.from)!;
    const to = boxes.get(l.to)!;
    return {
      fromKey: l.from,
      toKey: l.to,
      fromCol: colOf.get(from.m.roundIndex)!,
      fromY: from.y,
      toCol: colOf.get(to.m.roundIndex)!,
      toY: l.toY,
    };
  });
  return { columns, connectors, height: cursor };
}

/** Every tie a player has stood in, in round order — their path through the draw. */
export function playerPath(view: BracketView, playerId: string): string[] {
  if (!playerId) return [];
  return view.rounds.flatMap((r) =>
    r.matches.filter((m) => !isByeTie(m) && (m.a.playerId === playerId || m.b.playerId === playerId)).map((m) => m.key),
  );
}

/**
 * WHICH TAB A PLAYER IS FOUND ON: the section holding their latest tie — their
 * quarter (or half) while they are in it, up to and including its
 * quarter-final, and Finals once they are past it. "whole" when the draw has no
 * tabs, null when they are not in this draw.
 */
export function sectionOfPlayer(view: BracketView, sections: DrawSection[], playerId: string): SectionKey | null {
  const path = playerPath(view, playerId);
  const latest = path[path.length - 1];
  if (!latest) return null;
  const own = sections.find((s) => s.key !== "finals" && s.key !== "whole" && s.keys.includes(latest));
  if (own) return own.key;
  return sections.find((s) => s.key !== "whole" && s.keys.includes(latest))?.key ?? "whole";
}

/** The players in a draw, each once, for "Find a player". */
export function drawPlayers(view: BracketView): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const m of view.rounds[0]?.matches ?? []) {
    for (const s of [m.a, m.b]) if (s.playerId && !seen.has(s.playerId)) seen.set(s.playerId, s.name);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
