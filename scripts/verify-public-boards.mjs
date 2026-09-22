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
  return { status: res.status, lines };
}

/**
 * The scores down the board, in the order they are printed.
 *
 * Taken from the rows AFTER the "Ranked by" caption so the page furniture — a
 * date, a hole count, a player's handicap — cannot be mistaken for a score.
 * "E" is level par and is a real answer, so it reads as 0 rather than being
 * skipped.
 */
function printedScores(lines) {
  const i = lines.findIndex((l) => /^Ranked by /i.test(l));
  if (i < 0) return { caption: null, scores: [] };
  const caption = lines[i];

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

  for (const [label, ev] of [["net", net], ["gross", gross]]) {
    const { status, lines } = await board(ev.shareToken);
    if (status !== 200) {
      fail(`${label} board`, `expected 200, got ${status}`);
      continue;
    }
    const { caption, scores } = printedScores(lines);
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
    if (label === "net") {
      const grossFigures = FIELD.map((p) => p.overPar).sort((a, b) => a - b);
      const printed = [...scores].sort((a, b) => a - b);
      if (JSON.stringify(printed) === JSON.stringify(grossFigures)) {
        fail("net board", `printed the GROSS figures (${grossFigures.join(", ")}) under a net caption`);
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
