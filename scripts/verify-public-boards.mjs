/**
 * THE BOARD A CLUB SENDS ITS MEMBERS, AND WHETHER ITS NUMBERS EXPLAIN ITS ORDER.
 *
 * `/live/<shareToken>` is the one screen in this app with no sign-in in front
 * of it. Nothing walked it. Every other verify script here covers the console
 * or the player app, and the public board was reached only by the route walk,
 * which asks for a 200 and nothing else.
 *
 * It was wrong, and a 200 said so for as long as it took somebody to open it.
 * On 2026-09-22 the seeded club's April Medal board was headed "Ranked by net
 * strokes", was sorted correctly on net, and printed the GROSS to-par:
 *
 *     1  Marnie     gross 81   net 53    shown  +10
 *     2  Hattie           80       61    shown   +9
 *     3  Nkechi           70       63    shown   -1
 *     4  Priyanka         91       65    shown  +20
 *
 * A member reads the leader at +10, third place at -1 and fourth at +20. Both
 * figures were individually right and nothing compared them — and 8,359 unit
 * tests, the smoke walk and three Playwright viewports were all green over it,
 * because every one of them asks whether a number is correct and none asks
 * whether the column can be read down.
 *
 * WHAT THIS ASSERTS IS THAT INVARIANT, not a figure: **the scores printed on a
 * board must run in the order the board is sorted in.** It is the only
 * assertion that catches this class, and it is indifferent to which statistic
 * a round is scored by — lower-is-better for strokes, higher-is-better for
 * points, read off the board's own "Ranked by …" caption so the check cannot
 * disagree with the screen about what it is looking at.
 *
 * AND THE CONTROL, because a sweep that finds nothing may be broken: the
 * GROSS board is built so that gross and net order DIFFER, and the script
 * proves it would have failed on the old behaviour by checking the net board's
 * figures against the gross ones it would have printed. Without that, this
 * passes just as happily on a fixture where the two orders coincide — which is
 * most fixtures, and is why the defect survived so long.
 *
 * Everything it creates is named for the mark and deleted in a finally.
 */
import { runMark } from "./run-mark.mjs";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const MARK = runMark("zz-verify-board");
const prisma = new PrismaClient();

let failures = 0;
const fail = (where, why) => {
  failures += 1;
  console.log(`  FAIL ${where}: ${why}`);
};

const PAR = 4;
const HOLES = 18;
const PARS = new Array(HOLES).fill(PAR);
const SI = Array.from({ length: HOLES }, (_, i) => i + 1);
const COURSE_PAR = PAR * HOLES; // 72

function readable(html) {
  const open = html.indexOf("<main");
  const close = html.indexOf("</main>");
  const body = open >= 0 && close > open ? html.slice(open, close) : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<\/(div|p|td|th|tr|li|h1|h2|span|section)>/g, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&rsquo;|&#x27;|&#8217;|’/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ");
}

async function board(token) {
  const res = await fetch(`${BASE}/live/${token}?bust=${Date.now()}`, {
    redirect: "manual",
    cache: "no-store",
  });
  const html = res.status === 200 ? await res.text() : "";
  const lines = readable(html)
    .split("\n")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  return { status: res.status, lines, html };
}

/**
 * THE SCORES ON A POINTS BOARD, READ BY ROW RATHER THAN BY LINE.
 *
 * A flat scan of the text cannot do this one. The note on `printedScores`
 * says a points board's scores "ARE bare integers", which is true and is not
 * enough: so is the POSITION in the first column. On a one-round board the
 * positions happen to be absent or harmless; on a league board the flat
 * reader returned `1, 108, 2, 102, 3, 80` and reported a correctly-ordered
 * board as unsorted — a false alarm, which is the failure mode that gets a
 * check deleted.
 *
 * So take the LAST numeric cell of each row, which is the score column on
 * every board here, and let the row boundaries do the work the caption cannot.
 */
function pointsScoresByRow(html) {
  // The console draws a board as a TABLE and the public one as a LIST, so both
  // row shapes are accepted rather than one screen being asked to match the
  // other's markup.
  const rows = [
    ...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g),
    ...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g),
  ];
  const out = [];
  for (const row of rows) {
    const nums = row[1]
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((t) => /^\d+(\.\d+)?$/.test(t));
    // The score is the LAST figure on the row on both boards; the position is
    // the first, which is exactly the token the flat reader could not refuse.
    if (nums.length) out.push(Number(nums[nums.length - 1]));
  }
  return out;
}

/**
 * The scores down the board, in the order they are printed.
 *
 * Taken from the rows AFTER the "Ranked by" caption so the page furniture — a
 * date, a hole count, a player's handicap — cannot be mistaken for a score.
 * "E" is level par and is a real answer, so it reads as 0 rather than being
 * skipped.
 */
/**
 * TWO BOARDS, TWO SENTENCE SHAPES, one question.
 *
 * The individual board says "Ranked by net strokes"; the team board says
 * "Four-Ball · 2 sides · lowest net wins." (`teamBoardNote`). Both state what
 * the board is ordered on, which is all this check needs — so it accepts
 * either rather than requiring one screen to reword for a script.
 */
const CAPTION = /^Ranked by |wins\.$|points \(higher is better\)\.$/i;

function printedScores(lines, html = "") {
  const i = lines.findIndex((l) => CAPTION.test(l));
  if (i < 0) return { caption: null, scores: [] };
  const caption = lines[i];
  // A points board is read by ROW — see `pointsScoresByRow` for why the flat
  // scan below cannot tell a score from a finishing position.
  if (/points/i.test(caption) && html) {
    const byRow = pointsScoresByRow(html);
    if (byRow.length >= 2) return { caption, scores: byRow };
  }

  /**
   * WHICH TOKENS ARE SCORES DEPENDS ON THE CAPTION, and getting this wrong is
   * how the first draft of this script reported the app broken.
   *
   * A stroke board prints every score through `toParText`, so it is always
   * signed or "E" — and every BARE integer on those rows is something else: a
   * finishing position, a handicap, a hole count. Accepting bare integers
   * there read `0, 2, 7, 3, 14` off a board that actually prints `0, +7, +14`
   * and blamed the screen.
   *
   * A points board is the mirror: its scores ARE bare integers, and it has no
   * signed figures at all. So the caption decides, which is the same rule the
   * board itself follows.
   */
  const points = /points/i.test(caption);
  const scores = [];
  for (const l of lines.slice(i + 1)) {
    if (points) {
      if (/^\d+(\.\d+)?$/.test(l)) scores.push(Number(l));
    } else if (/^E$/.test(l)) scores.push(0);
    else if (/^[+-]\d+$/.test(l)) scores.push(Number(l));
  }
  return { caption, scores };
}

async function makeEvent(org, name, extra = {}) {
  return prisma.event.create({
    data: {
      organizationId: org,
      name: `${MARK} ${name}`,
      status: "live",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${MARK} Course`,
      city: `${MARK} Town`,
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: false,
      registrationToken: randomBytes(6).toString("hex"),
      shareToken: `${MARK}-${randomBytes(6).toString("hex")}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(HOLES).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      // The whole point: this board is the one anybody can open.
      leaderboardVisibility: "public",
      ...extra,
    },
    select: { id: true, shareToken: true },
  });
}

/**
 * A field whose GROSS order is the reverse of its NET order.
 *
 * This is the fixture doing the real work. A board where the two coincide
 * cannot tell a net reading from a gross one, so it would pass either way —
 * the "state nothing can express is a state nobody walks" trap. Here the best
 * gross round belongs to the worst net finisher and the other way about.
 *
 *   handicap 0  → gross 72 (level)   net 72   worst on net
 *   handicap 18 → gross 86 (+14)     net 68   best on net
 */
const FIELD = [
  { who: "scratch", handicap: 0, overPar: 0 },
  { who: "middle", handicap: 9, overPar: 7 },
  { who: "high", handicap: 18, overPar: 14 },
];

async function seedRound(eventId, basis) {
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: basis,
      holes: HOLES,
    },
    select: { id: true },
  });

  for (const [seed, p] of FIELD.entries()) {
    const player = await prisma.player.create({
      data: {
        eventId,
        name: `${MARK} ${p.who}`,
        email: `${MARK}-${p.who}@example.invalid`,
        handicap: p.handicap,
        seed,
        status: "confirmed",
      },
      select: { id: true },
    });
    // The overs are spread one per hole from the first, so every card is a
    // real eighteen and `thru` reads 18.
    const strokes = PARS.map((par, h) => (h < p.overPar ? par + 1 : par));
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: player.id, strokes: JSON.stringify(strokes), status: "certified" },
    });
  }
}

/**
 * THE SAME QUESTION ASKED OF A TEAM BOARD, which is a different engine.
 *
 * Individual rows come from `standingRows`; SIDES come from `teamStandings`,
 * and that one printed `aggregateTeamCard`'s `toPar` — a GROSS figure — on a
 * board it had just sorted by NET. Two sides level on net printed different
 * numbers, and the column could not be read downward. Measured on the seeded
 * club's Invitational foursomes on 2026-09-22, where it was invisible because
 * gross and net happened to run the same way.
 *
 * So this fixture does what the individual one does and reverses them:
 *
 *   side "scratch"  two players off 0   gross 72 (level)  worst on net
 *   side "high"     two players off 18  gross 86 (+14)    best on net
 *
 * Four-Ball rather than a shared ball, because it exercises the
 * `aggregateTeamCard` branch — the one eight screens read.
 */
async function seedTeamRound(eventId) {
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Four-Ball",
      scoringBasis: "net",
      holes: HOLES,
    },
    select: { id: true },
  });

  const SIDES = [
    { who: "scratch", handicap: 0, overPar: 0 },
    { who: "high", handicap: 18, overPar: 14 },
  ];

  for (const [seed, s] of SIDES.entries()) {
    const team = await prisma.team.create({
      data: { eventId, stageId: stage.id, name: `${MARK} ${s.who}`, seed: seed + 1 },
      select: { id: true },
    });
    // Two partners on the same figures, so the better ball IS that card and
    // the side's score needs no reasoning about which partner counted.
    for (const half of [0, 1]) {
      const player = await prisma.player.create({
        data: {
          eventId,
          name: `${MARK} ${s.who} ${half + 1}`,
          email: `${MARK}-${s.who}-${half + 1}@example.invalid`,
          handicap: s.handicap,
          seed: seed * 2 + half,
          status: "confirmed",
        },
        select: { id: true },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, playerId: player.id, position: half },
      });
      const strokes = PARS.map((par, h) => (h < s.overPar ? par + 1 : par));
      await prisma.teamScorecard.create({
        data: {
          eventId,
          stageId: stage.id,
          teamId: team.id,
          playerId: player.id,
          strokes: JSON.stringify(strokes),
        },
      });
    }
  }
}

/**
 * A ROUND ROBIN OF TEAM MATCHES, WHERE THE WINNER IS NOT THE LOW SCORER.
 *
 * `boardKind` asks the FORMAT alone, so a team format on a Round Robin landed
 * on the team STROKE board and every match result in the round was thrown
 * away. Measured before the fix, on exactly this shape:
 *
 *     Four-Ball · 2 sides · lowest net wins.
 *     1  lower-total       72   E
 *     2  wins-the-match    77
 *
 * So the fixture splits the two answers deliberately. Side A wins holes 1-10
 * and is ten up with eight to play — the match is over on the 10th, Rule
 * 3.2a(3) — and then takes fifteen on the last, which is a lost ball and a
 * re-tee and happens. A's TOTAL is far worse; A won the match.
 *
 * The match result is stored rather than computed, because this script writes
 * cards straight to the database and `recomputeTeamMatch` is what fills it in
 * when a scorer saves. What is under test here is the BOARD, not the scorer.
 */
async function seedTeamMatchRound(eventId) {
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Round 1",
      type: "Round Robin",
      format: "Four-Ball",
      scoringBasis: "net",
      holes: HOLES,
    },
    select: { id: true },
  });

  const SIDES = [
    { who: "won-the-match", card: PARS.map((par, h) => (h < 10 ? par - 1 : h === 17 ? par + 15 : par)) },
    { who: "lower-total", card: PARS.slice() },
  ];
  const teamIds = [];
  for (const [seed, s] of SIDES.entries()) {
    const team = await prisma.team.create({
      data: { eventId, stageId: stage.id, name: `${MARK} ${s.who}`, seed: seed + 1 },
      select: { id: true },
    });
    teamIds.push(team.id);
    for (const half of [0, 1]) {
      const player = await prisma.player.create({
        data: {
          eventId,
          name: `${MARK} ${s.who} ${half + 1}`,
          email: `${MARK}-${s.who}-${half + 1}@example.invalid`,
          handicap: 0,
          seed: seed * 2 + half,
          status: "confirmed",
        },
        select: { id: true },
      });
      await prisma.teamMember.create({ data: { teamId: team.id, playerId: player.id, position: half } });
      await prisma.teamScorecard.create({
        data: { eventId, stageId: stage.id, teamId: team.id, playerId: player.id, strokes: JSON.stringify(s.card) },
      });
    }
  }

  const flight = await prisma.group.create({
    data: { eventId, name: `${MARK} flight`, position: 0 },
  });
  await prisma.match.create({
    data: {
      eventId,
      stageId: stage.id,
      groupId: flight.id,
      round: 1,
      playerAId: "",
      playerBId: "",
      teamAId: teamIds[0],
      teamBId: teamIds[1],
      holes: JSON.stringify([...new Array(10).fill("A"), ...new Array(8).fill(null)]),
    },
  });
}

/**
 * THE SAME QUESTION ASKED ACROSS WEEKS, which no other fixture here can ask.
 *
 * Every board above is ONE round, and over one round a points board cannot
 * expose this: `scoreOnBasis` ranks on `points - levelPoints`, and with
 * everybody round the same eighteen the term is the same for all of them, so
 * the order is the points order whether or not the engine is right.
 *
 * It takes uneven ATTENDANCE to separate them. Measured on the seeded club's
 * Thursday Evening League on 2026-09-22, four weeks in: the board was ordered
 * perfectly on points per hole, printed the season totals, and headed itself
 * "Greta Lindqvist leads on 135 Stableford pts" over a table in which three
 * players had more. The league's own week view named somebody else.
 *
 * So: three weeks, and a player who misses the middle one and scores BETTER
 * per hole than anybody who played it.
 *
 *   evens    36 + 36 + 36  = 108 over 54 holes   2.00 a hole
 *   steady   34 + 34 + 34  = 102 over 54 holes   1.89
 *   sharp    40 +  -- + 40 =  80 over 36 holes   2.22  <- best rate, least use
 *
 * Ranked on the total the board reads 108, 102, 80 and runs downward. Ranked
 * on the rate it reads 80, 108, 102 and `checkOrder` says so in those words.
 * The middle week is the one missed on purpose, because the LAST round is the
 * board's active round — the one still in flight, where a shortfall is holes
 * not played YET and must not be charged.
 */
async function seedStablefordLeague(eventId) {
  const weeks = [];
  for (let i = 0; i < 3; i += 1) {
    weeks.push(
      await prisma.stage.create({
        data: {
          eventId,
          position: i,
          description: `Week ${i + 1}`,
          type: "Stroke Play Round",
          format: "Stableford",
          scoringBasis: "net",
          holes: HOLES,
        },
        select: { id: true },
      }),
    );
  }

  // Off scratch, so the points are the card and nothing depends on an
  // allowance: 2 a par, 3 a birdie, 1 a bogey.
  const card = (birdies, bogeys) =>
    JSON.stringify(PARS.map((par, h) => (h < birdies ? par - 1 : h < birdies + bogeys ? par + 1 : par)));

  const roster = [
    { who: "evens", weeks: [0, 1, 2], birdies: 0, bogeys: 0 }, // 36 a week, 108
    { who: "steady", weeks: [0, 1, 2], birdies: 0, bogeys: 2 }, // 34 a week, 102
    { who: "sharp", weeks: [0, 2], birdies: 4, bogeys: 0 }, // 40 a week, 80
  ];

  for (const [seed, p] of roster.entries()) {
    const player = await prisma.player.create({
      data: {
        eventId,
        name: `${MARK} ${p.who}`,
        email: `${MARK}-${p.who}@example.invalid`,
        handicap: 0,
        seed,
        status: "confirmed",
      },
      select: { id: true },
    });
    for (const w of p.weeks) {
      await prisma.scorecard.create({
        data: {
          eventId,
          stageId: weeks[w].id,
          playerId: player.id,
          strokes: card(p.birdies, p.bogeys),
          status: "certified",
        },
      });
    }
  }
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
}

/** Lower is better for strokes; higher is better for points. From the caption. */
function higherWins(caption) {
  return /points/i.test(caption);
}

function checkOrder(where, caption, scores) {
  if (scores.length < 2) {
    fail(where, `only ${scores.length} score(s) found under "${caption}" — the check read nothing`);
    return;
  }
  const up = !higherWins(caption);
  for (let i = 1; i < scores.length; i += 1) {
    const ok = up ? scores[i] >= scores[i - 1] : scores[i] <= scores[i - 1];
    if (!ok) {
      fail(
        where,
        `"${caption}" but the printed scores do not run that way: ${scores.join(", ")} — row ${i + 1} (${scores[i]}) beats row ${i} (${scores[i - 1]})`,
      );
      return;
    }
  }
}

async function main() {
  console.log(`Walking the public boards against ${BASE}`);
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: `${MARK} club`, kind: "club" },
    select: { id: true },
  });

  const net = await makeEvent(org.id, "net medal");
  await seedRound(net.id, "net");

  const gross = await makeEvent(org.id, "gross medal");
  await seedRound(gross.id, "gross");

  const team = await makeEvent(org.id, "net four-ball");
  await seedTeamRound(team.id);

  const teamMatch = await makeEvent(org.id, "four-ball round robin");
  await seedTeamMatchRound(teamMatch.id);

  const league = await makeEvent(org.id, "Stableford league");
  await seedStablefordLeague(league.id);

  for (const [label, ev] of [["net", net], ["gross", gross], ["team net", team], ["league", league]]) {
    const { status, lines, html } = await board(ev.shareToken);
    if (status !== 200) {
      fail(`${label} board`, `expected 200, got ${status}`);
      continue;
    }
    const { caption, scores } = printedScores(lines, html);
    if (!caption) {
      fail(`${label} board`, "no \"Ranked by …\" caption — a column of numbers with no unit");
      continue;
    }
    checkOrder(`${label} board`, caption, scores);

    for (const junk of ["NaN", "undefined", "Infinity", "[object Object]"]) {
      if (lines.join(" ").includes(junk)) fail(`${label} board`, `rendered "${junk}"`);
    }

    /**
     * THE CONTROL, and it is specific rather than decorative.
     *
     * The net board must not be printing the GROSS figures. Those are known
     * exactly from the fixture — 0, +7, +14 — so if they appear on a board
     * captioned "net", this is the 2026-09-22 defect back again and the
     * ordering check above happened to be satisfied by luck.
     */
    /**
     * THE LEAGUE'S CONTROL: the SEASON TOTALS, exactly.
     *
     * Ordering alone is not enough here, because a board ranked on points per
     * hole can still print a descending column if the fixture happens to be
     * kind. These three are known from the cards — 108, 102 and 80 — so
     * anything else means the board is aggregating something other than the
     * season, and the leader must be the 108 rather than the 80 that has the
     * best rate.
     */
    if (label === "league") {
      const want = [108, 102, 80];
      if (JSON.stringify(scores) !== JSON.stringify(want)) {
        fail("league board", `expected the season totals ${want.join(", ")}, printed ${scores.join(", ")}`);
      }
    }

    if (label === "net") {
      const grossFigures = FIELD.map((p) => p.overPar).sort((a, b) => a - b);
      const printed = [...scores].sort((a, b) => a - b);
      if (JSON.stringify(printed) === JSON.stringify(grossFigures)) {
        fail("net board", `printed the GROSS figures (${grossFigures.join(", ")}) under a net caption`);
      }
    }

    /**
     * The same control for the SIDES, whose gross figures are 0 and +14 and
     * are known exactly from the fixture. `teamStandings` printed these under
     * a net caption until 2026-09-22.
     */
    if (label === "team net") {
      const printed = [...scores].sort((a, b) => a - b);
      if (JSON.stringify(printed) === JSON.stringify([0, 14])) {
        fail("team net board", "printed the GROSS figures (0, +14) under a net caption");
      }
    }

    /**
     * WHAT THIS DELIBERATELY DOES NOT ASSERT: the exact net figure.
     *
     * The first draft did, computing `gross - handicap`, and reported the app
     * broken — it printed -3 where the arithmetic said -4. The app was right:
     * a playing handicap is a course handicap with the round's ALLOWANCE
     * applied, so an 18 becomes a 17 on a medal. Pinning the figure here would
     * have frozen an allowance rule that belongs to `stroke.ts` and is tested
     * against the Rules of Golf there, in a script about whether a column can
     * be read down.
     *
     * The two checks above need no such assumption. One says the printed
     * scores run the way the caption says the board is sorted; the other says
     * they are not the gross figures wearing a net caption. Both are true
     * whatever the allowance is.
     */
  }

  /**
   * THE TEAM MATCH BOARD, checked on its own rather than through the loop
   * above.
   *
   * That loop reads a column of SCORES and asks whether it runs the way the
   * caption says. This board has no such column — it prints P, W, ½, L, holes
   * and points — and feeding it to `printedScores` would read the "Holes ±"
   * figures as scores and assert something nobody claimed. A check that parses
   * the wrong column is the "passes without the content ever arriving" trap
   * one file over.
   *
   * What it asserts instead is the thing that was wrong: the side that WON is
   * printed first. Before the fix this board was the team stroke board and the
   * winner came second, so a regression puts it back there.
   */
  {
    const { status, lines } = await board(teamMatch.shareToken);
    if (status !== 200) {
      fail("team match board", `expected 200, got ${status}`);
    } else {
      const order = lines.filter((l) => /won-the-match|lower-total/.test(l));
      const first = order[0] ?? "";
      if (!/won-the-match/.test(first)) {
        fail(
          "team match board",
          `the side that won the match must be first, got "${first || "nothing"}" — ` +
            `a round of matches ranked on stroke totals again`,
        );
      }
      // And it says what it is ordered on, in its own words. "lowest net wins"
      // here would mean the stroke board is back whatever the order happens to
      // be, which one pairing cannot always reveal.
      if (!lines.some((l) => /point a win/.test(l))) {
        fail("team match board", 'no match-points caption — expected "1 point a win, ½ a half"');
      }
      if (lines.some((l) => /lowest net wins/.test(l))) {
        fail("team match board", 'captioned "lowest net wins" on a round decided hole by hole');
      }
    }
  }

  console.log(failures === 0 ? "Every public board reads down the way it is sorted." : `${failures} problem(s).`);
}

try {
  await main();
} catch (err) {
  failures += 1;
  console.log("FAIL (threw):", err?.message ?? err);
} finally {
  await cleanup();
  await prisma.$disconnect();
}

process.exit(failures === 0 ? 0 : 1);
