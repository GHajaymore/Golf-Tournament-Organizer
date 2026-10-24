import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScorecardTable } from "@/components/ScorecardTable";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import type { StandingRow } from "@/components/LeaderboardTable";
import { cardWorking, strokesOnHole, CITE, type HandicapParts } from "@/lib/domain/figure-working";
import { countbackBetween, fromTheOtherSide } from "@/lib/domain/stroke-countback";
import { roundPlayingHandicap } from "@/lib/domain/handicap";
import { toParText } from "@/lib/domain/stroke";
import { readSource } from "./source";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { strokesByHandingOut, stablefordByName } from "@/lib/domain/__tests__/properties-reference";
import {
  readBoardNet,
  readHandicapSentence,
  readNetSentence,
  readPointsSentence,
  readStrokeSentence,
  readTieSentences,
  toParOf,
} from "@/lib/domain/__tests__/figure-reading";

/**
 * THE SCREENS AGREE WITH THEIR OWN WORKING (2026-10-24, "every figure explains
 * itself").
 *
 * For every figure the card and the board draw — a stroke dot, the net, a
 * hole's Stableford points, the points total, a place a countback decided, a
 * net board's figure — this renders the screen, reads the figure OFF THE
 * MARKUP, takes the numbers out of the sentence that figure opens (read the
 * way a golfer reads it, `figure-reading.ts`), and holds the two together and
 * to the Rule worked a second way (`properties-reference.ts`).
 *
 * Across the axes the panel named: an individual net medal at 95%, 85% and
 * 100%, Stableford and Modified Stableford, a plus handicap, two strokes on a
 * hole, nine holes, and tees of a higher par (Rule 6.2b).
 *
 * WHAT IT CANNOT SEE: whether the sentence is ON the screen when a finger
 * presses the figure — that is `e2e/every-figure-explains-itself.spec.ts`, in a
 * browser, on a fixture's own card and its public board — and a board's tie on
 * real stored cards, which is `figure-working-on-real-rows.audit.test.ts`.
 */

/** A stroke index that is not 1..18 in order, so a hole and its index differ. */
const SI18 = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const SI9 = [5, 2, 8, 1, 7, 3, 9, 4, 6];
const PARS18 = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const PARS9 = [4, 3, 5, 4, 4, 3, 4, 5, 4];

interface Case {
  name: string;
  holes: number;
  si: number[];
  pars: number[];
  strokes: (number | null)[];
  parts: HandicapParts;
  points?: "standard" | "modified";
}

/** The parts of a playing handicap as the round prices it. */
const parts = (courseExact: number, allowance: number, parStrokes = 0, source: HandicapParts["source"] = "member"): HandicapParts => ({
  courseExact,
  source,
  allowance,
  parStrokes,
  playing: roundPlayingHandicap(courseExact, allowance, parStrokes),
});

const full18 = [5, 5, 4, 6, 4, 5, 3, 6, 5, 5, 4, 4, 6, 5, 4, 4, 5, 6];
const CASES: Case[] = [
  { name: "an individual net medal at 95%", holes: 18, si: SI18, pars: PARS18, strokes: full18, parts: parts(14.7345, 95) },
  { name: "two strokes on a hole, part-way round", holes: 18, si: SI18, pars: PARS18, strokes: [...full18.slice(0, 9), ...new Array(9).fill(null)], parts: parts(23.1, 95) },
  { name: "a plus handicap giving strokes back", holes: 18, si: SI18, pars: PARS18, strokes: [3, 4, 3, 4, 4, 4, 3, 5, 4, 4, 4, 3, 4, 4, 4, 3, 4, 4], parts: parts(-3.4, 95) },
  { name: "nine holes", holes: 9, si: SI9, pars: PARS9, strokes: [5, 4, 6, 5, 4, 4, 5, 6, 5], parts: parts(7.6, 95) },
  { name: "tees of a higher par (Rule 6.2b)", holes: 18, si: SI18, pars: PARS18, strokes: full18, parts: parts(11.2, 95, 1) },
  { name: "a four-ball partner at 85%", holes: 18, si: SI18, pars: PARS18, strokes: full18, parts: parts(18.66, 85) },
  { name: "a committee's own figure at 100%", holes: 18, si: SI18, pars: PARS18, strokes: full18, parts: parts(12, 100, 0, "override") },
  { name: "Stableford", holes: 18, si: SI18, pars: PARS18, strokes: [...full18.slice(0, 16), 9, null], parts: parts(18.3, 95), points: "standard" },
  { name: "Modified Stableford", holes: 18, si: SI18, pars: PARS18, strokes: full18, parts: parts(9.9, 95), points: "modified" },
];

/** What the page hands the card: the dots allocated by `strokesOnHole`. */
const shotsOf = (c: Case) => c.si.map((s) => strokesOnHole(c.parts.playing, s, c.holes).shots);

/** The card as the read-only screen draws it, read back from the markup. */
function screenOf(c: Case) {
  const shots = shotsOf(c);
  const html = renderToStaticMarkup(
    <ScorecardTable
      holes={c.holes}
      pars={c.pars}
      strokeIndex={c.si}
      strokes={c.strokes}
      shotsPerHole={shots}
      playingHandicap={c.parts.playing}
      handicapParts={c.parts}
      pointsTable={c.points ?? null}
    />,
  );
  const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  // Each hole's box names its own strokes: "Hole 7, par 3, 3, 1 received — …".
  const boxes = [...decode(html).matchAll(/aria-label="Hole (\d+), par (\d+)(?:, (\d+))?(?:, (\d+) (received|given back))? — how its strokes were worked out"/g)].map((m) => ({
    hole: +m[1],
    strokes: m[3] != null ? +m[3] : null,
    shots: m[4] == null ? 0 : m[5] === "received" ? +m[4] : -m[4],
  }));
  const dots = [...html.matchAll(/data-shots="(-?\d+)"/g)].map((m) => +m[1]);
  const netShown = /aria-label="Net (-?\d+) — how it was worked out"/.exec(html);
  const pointsShown = /aria-label="Points (-?\d+) — how it was worked out"/.exec(html);
  return { html, shots, boxes, dots, net: netShown ? +netShown[1] : null, points: pointsShown ? +pointsShown[1] : null };
}

/** The working the card opens, from the very call the card draws its line with. */
const workingOf = (c: Case) =>
  cardWorking({
    holes: c.holes,
    pars: c.pars,
    strokeIndex: c.si,
    strokes: c.strokes,
    shotsPerHole: shotsOf(c),
    playingHandicap: c.parts.playing,
    handicapParts: c.parts,
    pointsTable: c.points ?? null,
  });

/**
 * One sentence out of a hole's line, by what it begins with. A line is "Hole N:
 * <sentence> (<cite>) <sentence> (<cite>)", so it is cut at each citation.
 */
const sentence = (line: string, start: RegExp) =>
  line
    .replace(/^Hole \d+: /, "")
    .split(/ \((?:Rules of [^)]*|Committee [^)]*|the tournament[^)]*)\) ?/)
    .find((s) => start.test(s)) ?? null;

describe.each(CASES)("the card: $name", (c) => {
  const screen = screenOf(c);
  const cw = workingOf(c);

  it("every box on the screen is offered, and its dots are drawn", () => {
    expect(screen.boxes.map((b) => b.hole)).toEqual(Array.from({ length: c.holes }, (_, i) => i + 1));
    expect(screen.dots).toEqual(screen.shots.filter((s) => s !== 0));
  });

  it("each hole's sentence gives the strokes in its box — by its own words and by the Rule", () => {
    const ref = strokesByHandingOut(c.parts.playing, c.si);
    for (const box of screen.boxes) {
      const i = box.hole - 1;
      const line = cw.hole(i);
      expect(line.startsWith(`Hole ${box.hole}: `), line).toBe(true);
      const said = sentence(line, /^(You get|You give|No stroke)/)!;
      const r = readStrokeSentence(said);
      expect(r.lead, line).toBe(box.shots);
      expect(r.fromSpread, line).toBe(box.shots);
      expect(r.playing).toBe(c.parts.playing);
      expect(r.strokeIndex).toBe(c.si[i]);
      expect(box.shots).toBe(ref[i]);
      expect(line).toContain(`(${CITE.allocation})`);
      // And the net under the gross is the gross less those strokes.
      if (!c.points && box.strokes != null && box.shots !== 0) {
        expect(screen.html).toContain(`aria-label="net ${box.strokes - box.shots}"`);
      }
    }
  });

  it("the net on the screen is the gross less the strokes in the sentence, and the playing handicap is the Rule's", () => {
    expect(screen.net).not.toBeNull();
    const r = readNetSentence(cw.net!.says);
    expect(r.net).toBe(screen.net);
    expect(r.gross - r.taken).toBe(screen.net);
    const gross = c.strokes.reduce<number>((a, s) => a + (s ?? 0), 0);
    const ref = strokesByHandingOut(c.parts.playing, c.si);
    expect(r.gross).toBe(gross);
    expect(r.taken).toBe(c.strokes.reduce<number>((a, s, i) => a + (s != null ? ref[i] : 0), 0));
    const h = readHandicapSentence(cw.net!.says);
    expect(h.playing).toBe(c.parts.playing);
    expect(h.rounded + h.parStrokes).toBe(c.parts.playing);
    if (h.share !== null) expect(Math.floor(h.share + 0.5 + 1e-9)).toBe(h.rounded);
    expect(h.parStrokes).toBe(c.parts.parStrokes);
    expect(cw.net!.cite).toBe(c.parts.parStrokes ? CITE.playingWithPars : CITE.playing);
  });

  it.runIf(!!c.points)("each hole's points add up to the points on the screen, by the table a scorer learns", () => {
    let total = 0;
    for (const box of screen.boxes) {
      if (box.strokes == null) continue;
      const said = sentence(cw.hole(box.hole - 1), /^(Net -?\d+ on a par|\d+ less|\d+ and)/)!;
      const p = readPointsSentence(said);
      expect(p.net).toBe(box.strokes - box.shots);
      if (c.points === "standard") expect(p.points).toBe(stablefordByName(p.net, p.par));
      total += p.points;
    }
    expect(screen.points).toBe(total);
    expect(cw.pointsWhy!.says.startsWith(`${total} points over the`)).toBe(true);
  });
});

describe("the board", () => {
  /** A row as `standingRows` builds one for a stroke board. */
  const row = (id: string, name: string, over: Partial<StandingRow>): StandingRow => ({
    id, rank: 1, ranked: true, started: true, name, flight: "—", advancing: false, record: "", diff: "", pts: "",
    played: 0, wins: 0, ties: 0, losses: 0, gross: 80, net: 72, toPar: 0, points: 0, thru: 18, holesOwed: 18,
    parThru: 72, parKnown: true, ...over,
  });
  const four = new Array(18).fill(4);
  // A birdie on the 17th: the last 9 is 35 against 36, which is the first step
  // of the ladder, so it is decided there (Committee Procedures 5A).
  const cardA = { playerId: "a", total: 0, holes: [...four.slice(0, 15), 4, 3, 4] };
  const cardB = { playerId: "b", total: 0, holes: [...four.slice(0, 15), 4, 4, 4] };
  const cardC = { playerId: "c", total: 0, holes: [...four.slice(0, 15), 4, 4, 4] };
  // A and B level on −2; the countback decides it on the last 9. B and C level
  // on −2 too, and the same at every step: they share.
  const ab = countbackBetween(cardA, cardB, 18);
  const bc = countbackBetween(cardB, cardC, 18);
  const rows: StandingRow[] = [
    row("a", "Ailsa Invented", { rank: 1, gross: 84, net: 70, toPar: -2, tiedWith: [{ name: "Brodie Invented", decision: ab }] }),
    row("b", "Brodie Invented", {
      rank: 2,
      gross: 80,
      net: 70,
      toPar: -2,
      tiedWith: [
        { name: "Ailsa Invented", decision: fromTheOtherSide(ab) },
        { name: "Calum Invented", decision: bc },
      ],
    }),
    row("c", "Calum Invented", { rank: 2, gross: 76, net: 70, toPar: -2, tiedWith: [{ name: "Brodie Invented", decision: fromTheOtherSide(bc) }] }),
    row("d", "Dougie Invented", { rank: 0, ranked: false, disqualified: true, gross: 75, net: 69, toPar: -3 }),
  ];
  const html = renderToStaticMarkup(
    <PlayerLeaderboard isStroke isStableford={false} rows={rows} holes={18} unit="net strokes" />,
  );
  /** Each row's markup, in order. */
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
  const says = (item: string) => [...item.matchAll(/<span class="why-says" role="note">([\s\S]*?) <cite>/g)].map((m) => m[1]);
  const placeOf = (item: string) => /aria-label="[^"]*, place (T?\d+) — how it was worked out"/.exec(item)?.[1] ?? null;

  it("a place the countback decided says so, with the cards' own totals, and the places on the screen follow it", () => {
    expect(placeOf(items[0])).toBe("1");
    const [t] = readTieSentences(says(items[0])[0]);
    expect(t).toMatchObject({ name: "Brodie Invented", score: "-2", kind: "ahead", holes: 9, mine: 35, theirs: 36 });
    const back = readTieSentences(says(items[1])[0]);
    expect(back[0]).toMatchObject({ name: "Ailsa Invented", kind: "behind", holes: 9, mine: 36, theirs: 35 });
    // The score in the sentence is the score on the row.
    expect(items[0]).toContain(">-2<");
  });

  it("a place nothing separated is shared on the screen, and the sentence says it is shared and what was level", () => {
    expect(placeOf(items[1])).toBe("T2");
    expect(placeOf(items[2])).toBe("T2");
    const shared = readTieSentences(says(items[2])[0]);
    expect(shared[0]).toMatchObject({ name: "Brodie Invented", kind: "shared", place: 2, score: "-2" });
    expect(says(items[2])[0]).toContain("level on the last 9, the last 6, the last 3 and the last hole too");
  });

  it("a net board's figure is net less par, as printed", () => {
    for (const [i, r] of rows.slice(0, 3).entries()) {
      const net = says(items[i]).find((s) => /^(E|[+-]\d+): /.test(s))!;
      const b = readBoardNet(net);
      expect(b.shown).toBe(toParText(r.toPar));
      expect(b.net - b.par).toBe(toParOf(b.shown));
      expect(b.gross - b.taken).toBe(b.net);
    }
  });

  it("a row with no place says why, from what is stored on it", () => {
    expect(says(items[3]).some((s) => s.startsWith("Disqualified by the committee"))).toBe(true);
    expect(items[3]).toContain(`(${CITE.disqualified})`);
  });

  it("a figure with nothing to explain opens nothing", () => {
    const plain = renderToStaticMarkup(
      <PlayerLeaderboard isStroke isStableford={false} rows={[row("x", "Xan Invented", { toPar: 0, net: 72, gross: 72 })]} holes={18} unit="gross strokes" />,
    );
    expect(plain).not.toContain("why-says");
  });
});

describe("one rule, one place: no screen words a figure's working itself", () => {
  /**
   * The Rules a working cites are written once, in `figure-working.ts`. A screen
   * that spelled one out for itself would be a second sentence about a figure,
   * free to disagree with the first. The control: the sweep finds them in the
   * one file that may hold them.
   */
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p.slice(process.cwd().length + 1).replace(/\\/g, "/"));
    }
  };
  walk(join(process.cwd(), "src"));
  const phrases = [CITE.allocation, CITE.countback, CITE.disqualified, "rounded once to", "strokes you receive on the", "on the countback over"];
  const holders = files.filter((f) => phrases.some((p) => readSource(f).includes(p)));

  it("finds the phrases where they belong, so the sweep can see one", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(holders).toContain("src/lib/domain/figure-working.ts");
  });

  it("finds them nowhere else", () => {
    expect(holders.filter((f) => f !== "src/lib/domain/figure-working.ts")).toEqual([]);
  });

  it("the card and the board draw their working from figure-working, not from a sentence of their own", () => {
    expect(readSource("src/components/ScorecardTable.tsx")).toMatch(/cardWorking\(\{/);
    expect(readSource("src/components/PlayerCard.tsx")).toMatch(/cardWorking\(\{/);
    expect(readSource("src/components/PlayerLeaderboard.tsx")).toMatch(/tieWorking\(r\.tiedWith/);
    // The dots on the player's card are allocated by the function that says why.
    expect(readSource("src/app/(player)/me/card/page.tsx")).toMatch(/strokesOnHole\(hcp, card\.strokeIndex\[i\] \?\? 18, holes\)\.shots/);
    // The board's places and the countback's working are one decision.
    expect(readSource("src/lib/services/tournament.ts")).toMatch(/const level = sameScore && decision!\.order === 0;/);
  });
});
