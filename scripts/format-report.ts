/**
 * What every format actually produces, printed as a leaderboard.
 *
 *   npx tsx --require ./scripts/server-shim.cjs scripts/format-report.ts
 *
 * The matrix sweep in `matrix.test.ts` asserts INVARIANTS across the cross
 * product — ranks contiguous, no NaN, a cut never larger than its field. That
 * catches a whole class of bug and tells you nothing about whether the numbers
 * are the RIGHT numbers. A par 4 scored as 3 with a shot received is a net 2,
 * and no invariant in the world notices if it comes out 3.
 *
 * So this runs the real engines over one realistic field and prints what each
 * format returns, for a human to read against the Rules. It touches no
 * database and creates no fixtures: everything here is in memory, so it cannot
 * leave a `zz-` row behind or go anywhere near a real tournament.
 *
 * It is a REPORT, not a test. It asserts nothing. When something in it looks
 * wrong, the fix is a failing case in the suite, not an assertion here.
 */
import {
  FORMAT_NAMES,
  findFormat,
  needsTeams,
  isManualFormat,
  entryModeFor,
} from "../src/lib/formats";
import { aggregateStroke, netOf, isRanked, type StrokeCard } from "../src/lib/domain/stroke-agg";
import { holeStrokesReceived, stablefordPointsForHole, allocationHoles } from "../src/lib/domain";
import { modifiedStablefordForHole } from "../src/lib/domain/stroke";
import { aggregateTeamCard, singleBallTeamCard, sideHandicap } from "../src/lib/domain/team";
import { playSkins } from "../src/lib/domain/skins";
import { resolveMatch } from "../src/lib/domain/match";
import { courseHandicap } from "../src/lib/domain/handicap";

/* ── One real course and one real field, used by every format ─────────────── */

/** Pebble Beach, as the public directory returns it. A real card, in order. */
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const TEE = { courseRating: 74.9, slopeRating: 144, par: 72 };
const STAGE = "r1";

/** Invented names and invented indexes. Nothing here is a real member. */
const FIELD = [
  { id: "p1", name: "zz Alex Vaughn", index: 2.1 },
  { id: "p2", name: "zz Sam Okafor", index: 8.4 },
  { id: "p3", name: "zz Priya Nair", index: 14.7 },
  { id: "p4", name: "zz Marco Diaz", index: 22.0 },
];

/**
 * A repeatable round for each player, without Math.random.
 *
 * Better players go lower and everybody has a blow-up somewhere, which is what
 * makes Stableford differ from stroke play rather than being a re-ranking of
 * it. Deterministic on purpose: a report that changes every run cannot be
 * compared against the last one.
 */
function roundFor(seed: number): number[] {
  return PARS.map((par, i) => {
    const wobble = (seed * 7 + i * 13) % 5;
    const over = wobble === 0 ? -1 : wobble === 4 ? 3 : wobble === 3 ? 1 : 0;
    return Math.max(2, par + over + (seed > 2 ? 1 : 0));
  });
}

const CARDS = FIELD.map((p, i) => ({ ...p, strokes: roundFor(i + 1) }));

/** Course handicap off the real WHS conversion, not the raw index. */
const courseHcp = new Map(CARDS.map((c) => [c.id, courseHandicap(c.index, TEE)]));

const nameOf = (id: string) => FIELD.find((p) => p.id === id)?.name ?? id;
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const num = (n: number, w = 4) => String(n).padStart(w);

function heading(title: string, sub: string) {
  console.log(`\n${"─".repeat(74)}\n${title}\n${sub}`);
}

/* ── The engines ──────────────────────────────────────────────────────────── */

/**
 * The points function is an OPTION, so the ENGINE picks it.
 *
 * The first draft of this report passed the ordinary Stableford function for
 * every format, and Modified Stableford duly printed points identical to
 * Stableford's — which is what a broken engine would look like too. It was the
 * report that was wrong; `modifiedStablefordForHole` exists and pushes the
 * rewards out, eagles and birdies worth more and bogeys actively penalised.
 * Worth the comment, because the two failures are indistinguishable on screen.
 */
const strokeOpts = (allowance: number, engine: string) => ({
  courseFor: () => ({ pars: PARS, holeDifficulty: SI, holes: 18 }),
  handicapFor: (playerId: string) =>
    Math.round(((courseHcp.get(playerId) ?? 0) * allowance) / 100),
  holeStrokesReceived,
  stablefordPointsForHole:
    engine === "modified-stableford" ? modifiedStablefordForHole : stablefordPointsForHole,
  allocationHoles,
});

/** Stroke play, Stableford and Modified Stableford all come off this. */
function individualBoard(engine: string, allowance: number) {
  const cards: StrokeCard[] = CARDS.map((c) => ({
    playerId: c.id,
    stageId: STAGE,
    strokes: c.strokes,
  }));
  const agg = aggregateStroke(cards, strokeOpts(allowance, engine));

  const rows = CARDS.map((c) => {
    const a = agg.get(c.id)!;
    return {
      name: c.name,
      hcp: Math.round(((courseHcp.get(c.id) ?? 0) * allowance) / 100),
      gross: a.gross,
      net: netOf(a),
      toPar: a.gross - a.parThru,
      points: a.points,
      ranked: isRanked(a),
    };
  });

  // Sorted by what the format is actually won on — the whole point of the
  // report. A Stableford ordered by strokes is the bug this would show.
  const byPoints = engine === "stableford" || engine === "modified-stableford";
  rows.sort((a, b) => (byPoints ? b.points - a.points : a.net - b.net));

  console.log(`  ${pad("", 4)}${pad("Player", 18)}${pad("Hcp", 5)}${pad("Gross", 7)}${pad("Net", 6)}${pad("+/-", 6)}${pad("Pts", 5)}`);
  rows.forEach((r, i) => {
    console.log(
      `  ${pad(String(i + 1) + ".", 4)}${pad(r.name, 18)}${pad(String(r.hcp), 5)}${pad(String(r.gross), 7)}` +
        `${pad(String(r.net), 6)}${pad(r.toPar > 0 ? "+" + r.toPar : String(r.toPar), 6)}${pad(String(r.points), 5)}` +
        `${r.ranked ? "" : "  (not ranked)"}`,
    );
  });
}

/** Match play, resolved between the two lowest indexes in the field. */
function matchBoard() {
  const a = CARDS[0];
  const b = CARDS[1];
  // Who won each hole, gross.
  const holes = PARS.map((_, i) =>
    a.strokes[i] < b.strokes[i] ? "A" : a.strokes[i] > b.strokes[i] ? "B" : "H",
  ) as Array<"A" | "B" | "H">;
  const r = resolveMatch(holes);
  console.log(`  ${a.name} v ${b.name}`);
  console.log(`  Holes: ${holes.join("")}`);
  console.log(`  Result: ${r.resultText}`);
  console.log(`  Played ${r.played} of 18${r.complete && r.remaining > 0 ? ` — ${r.remaining} holes never played` : ""}`);
}

/** Skins, from the same cards. */
function skinsBoard() {
  const players = CARDS.map((c) => ({
    playerId: c.id,
    strokes: c.strokes as (number | null)[],
    courseHandicap: courseHcp.get(c.id) ?? 0,
  }));
  const out = playSkins(players, 18, { net: false });
  out.standings
    .slice()
    .sort((x, y) => y.skins - x.skins)
    .forEach((row, i) =>
      console.log(
        `  ${pad(String(i + 1) + ".", 4)}${pad(nameOf(row.playerId), 18)}${num(row.skins)} skins`,
      ),
    );
  const carried = out.holes.filter((h) => h.carried).length;
  console.log(
    `  ${carried} of 18 holes tied and carried` +
      `${out.unclaimed > 0 ? `, and ${out.unclaimed} skin${out.unclaimed === 1 ? "" : "s"} finished unclaimed` : ""}`,
  );
}

/** A side format: two pairs, scored the way the format declares. */
function teamBoard(formatName: string) {
  const f = findFormat(formatName);
  /**
   * Sides the size the format actually declares.
   *
   * The first draft put two players a side for everything, so a Scramble —
   * declared as sides of four — was priced off two handicaps at 25% and
   * reported a side handicap of 7. Plausible on screen, and not what a
   * scramble is. A report that quietly plays the wrong shape is worse than no
   * report, because it looks like evidence.
   *
   * With a field of four, a four-person format is ONE side. That is the honest
   * arrangement, and the four-versus-one asymmetry is itself worth seeing.
   */
  const sides =
    f.sideSize >= 4
      ? [{ name: "zz Vaughn / Okafor / Nair / Diaz", members: CARDS }]
      : [
          { name: "zz Vaughn / Nair", members: [CARDS[0], CARDS[2]] },
          { name: "zz Okafor / Diaz", members: [CARDS[1], CARDS[3]] },
        ];

  console.log(
    `  Side size ${f.sideSize} · allowance ${f.allowance}%` +
      `${f.allowanceIsConvention ? " (local convention)" : " (WHS recommendation)"}` +
      `${f.ball === "single" ? " · one ball per side" : " · a ball each"}`,
  );

  for (const side of sides) {
    const members = side.members.map((m) => ({
      playerId: m.id,
      strokes: m.strokes as (number | null)[],
      courseHandicap: courseHcp.get(m.id) ?? 0,
    }));

    let card;
    if (f.ball === "single") {
      // One ball between them: the side plays the better of the two on every
      // hole, which is the closest a report can get to a shared ball without
      // inventing which drive they chose.
      const shared = PARS.map((_, i) =>
        Math.min(...members.map((m) => m.strokes[i] ?? 99)),
      ) as (number | null)[];
      const hcp = sideHandicap(
        members.map((m) => m.courseHandicap),
        f.allowance,
        f.weightsBySideSize?.[f.sideSize] ?? undefined,
      );
      card = singleBallTeamCard(shared, PARS, hcp, SI);
      console.log(
        `  ${pad(side.name, 22)} side hcp ${num(Math.round(hcp))}   gross ${num(card.grossTotal)}` +
          `   net ${num(card.netTotal, 5)}   pts ${num(card.pointsTotal, 4)}`,
      );
    } else {
      card = aggregateTeamCard(members, PARS, SI, f.allowance, 1);
      console.log(
        `  ${pad(side.name, 22)} gross ${num(card.grossTotal)}   net ${num(card.netTotal, 5)}` +
          `   pts ${num(card.pointsTotal, 4)}   ± ${card.toPar > 0 ? "+" + card.toPar : card.toPar}`,
      );
    }
  }
}

/* ── The report ───────────────────────────────────────────────────────────── */

console.log(
  "TourneyHQ — what every format produces\n" +
    "One field of four, one real card (Pebble Beach), the same four rounds throughout.\n" +
    "In memory only: no database, no fixtures, nothing to clean up.",
);

console.log(`\nThe field, and what the tee does to their index (CR ${TEE.courseRating} / slope ${TEE.slopeRating}):`);
for (const c of CARDS) {
  console.log(
    `  ${pad(c.name, 18)} index ${pad(c.index.toFixed(1), 6)} -> course handicap ${num(courseHcp.get(c.id) ?? 0)}` +
      `   gross ${num(c.strokes.reduce((s, n) => s + n, 0))}`,
  );
}

for (const name of FORMAT_NAMES) {
  const f = findFormat(name);
  const sub =
    `  engine: ${f.engine} · ${needsTeams(name) ? `sides of ${f.sideSize}` : "individual"}` +
    ` · entered as ${entryModeFor(name)}${isManualFormat(name) ? " · SCORED BY HAND" : ""}` +
    `${f.playable ? "" : `\n  not playable on its own — ${f.pendingReason ?? "no engine"}`}`;
  heading(name, sub);

  if (isManualFormat(name)) {
    // The one format with no engine, and the guard that keeps it away from one.
    console.log("  No engine runs. The committee enters the result and the app records it.");
    continue;
  }

  try {
    if (needsTeams(name)) teamBoard(name);
    else if (f.engine === "match") matchBoard();
    else if (f.engine === "skins") skinsBoard();
    else if (f.engine === "nassau") {
      matchBoard();
      console.log("  (front nine, back nine and the match are settled separately)");
    } else individualBoard(f.engine, f.allowance);
  } catch (e) {
    // A format that throws is the most useful line in this report.
    console.log(`  !! threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n${"─".repeat(74)}\nRead the numbers against the Rules, not against last month's output.`);
