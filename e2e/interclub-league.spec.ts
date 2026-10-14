import { createHmac, randomBytes } from "node:crypto";
import { test, expect, type Page, type Locator } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A SECRETARY RUNS A CLUB LEAGUE FROM ITS FIRST WEEK TO ITS CHAMPION, AND EVERY
 * FIGURE ON THE TABLE IS WORKED OUT FROM THE CARDS.
 *
 * Four clubs, two four-balls a meeting, everybody meets everybody once, and the
 * top two play a final. `league.spec.ts` measures this screen's width and says
 * in its own header that it nominates nothing, draws nothing and records no
 * play-off hole. So `setLeagueSettings`, `nominatePair`, `withdrawPair`,
 * `drawLeagueWeek` and `setPlayoffHoleWinner` — every action a league has —
 * were performed by no browser test (the reach report, 2026-10-13).
 *
 * WALKING IT FOUND FIVE THINGS, each a statement about golf nobody had played:
 *
 *   the table said "Played 1" for every club the moment a week was DRAWN
 *   every four-ball of a week just drawn read "AS" — all square — in the
 *     meetings list, and one still out read "T" whatever the score
 *   the play-offs printed "Final: (1) Ardlui v Balfron (2)" before a ball was
 *     struck: the first two clubs in the alphabet
 *   the final could be DRAWN with two of three season weeks never played
 *   a refused Withdraw was said under the roster, not beside the pair
 *
 * What is held to the Rules here, worked out in this file from the stored
 * cards and the players' indexes and sharing nothing with the app:
 *
 *   a playing handicap    90% of the course handicap, taken before rounding
 *                         (Rules of Handicapping 6.2a; Appendix C, four-ball
 *                         match play). No tees are set, so the course handicap
 *                         is the index.
 *   strokes               the lowest of the four plays off scratch and the
 *                         others receive the difference, by stroke index
 *   a hole                the better net ball of each side; lower wins it
 *   a match               over when a side is more holes up than remain, and
 *                         worded the usual way: 3&2, 1 UP, AS
 *
 * and the league's own arithmetic, from the sentence the screen prints for
 * each scoring system: a point a four-ball; a point a hole and a bonus for the
 * match; holes only; and a Nassau's three.
 *
 * Week 1 and the final are entered through the score-entry screen, hole by
 * hole. Weeks 2 and 3 are written as rows, which is said where it is done.
 *
 * WHAT IT CANNOT SEE: a league of an odd number of clubs (one sits out each
 * week), a club short of a pair on the night, a semi-final (a final only), a
 * committee overturning a result that was won on the points (the database test
 * `league-playoff.audit.test.ts` does that), and the countbacks that order
 * clubs level on points — the season here is chosen so that no two are.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const WALKED = ["desktop", "phone"];

const CLUBS = ["Ardlui", "Balfron", "Cardross", "Drymen"];
/** Four to a club, with the decimal an index has. */
const INDEX = [
  [3.4, 9.7, 14.6, 21.3],
  [5.1, 11.8, 16.2, 24.9],
  [1.6, 8.3, 17.5, 19.4],
  [6.8, 12.2, 13.9, 27.1],
];
const NTH = ["One", "Two", "Three", "Four"];
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
const STROKE_INDEX = [7, 3, 15, 11, 1, 9, 17, 5, 13, 8, 16, 2, 12, 6, 10, 18, 4, 14];
/** Who is paired with whom each week, as places on the club's roster. Different pairs week to week. */
const PAIRS_BY_WEEK = [
  [[0, 3], [1, 2]],
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
];

type Roster = { id: string; name: string; index: number; club: number }[][];

async function build(mark: string) {
  const org = await prisma.organization.create({ data: { name: `${mark} League Committee`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${mark} Thursday Interclub`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(STROKE_INDEX),
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
  });
  const weeks: string[] = [];
  for (const [i, label] of ["Week 1", "Week 2", "Week 3", "Final"].entries()) {
    const stage = await prisma.stage.create({
      data: { eventId: event.id, position: i, description: label, type: "Round Robin", format: "Four-Ball", holes: 18, scoringBasis: "net" },
    });
    weeks.push(stage.id);
  }
  const clubs: { id: string; name: string }[] = [];
  const roster: Roster = [];
  for (const [c, name] of CLUBS.entries()) {
    const club = await prisma.group.create({ data: { eventId: event.id, name, position: c } });
    clubs.push({ id: club.id, name });
    const own = [];
    for (const [k, index] of INDEX[c].entries()) {
      const p = await prisma.player.create({
        data: {
          eventId: event.id,
          name: `${name} ${NTH[k]}`,
          email: `${mark}-${c}-${k}@example.invalid`.toLowerCase(),
          handicap: index,
          seed: c * 4 + k + 1,
          status: "confirmed",
          groupId: club.id,
        },
      });
      own.push({ id: p.id, name: p.name, index, club: c });
    }
    roster.push(own);
  }
  const organizer = await prisma.user.create({
    data: { email: `${mark}-secretary@example.invalid`.toLowerCase(), name: "L. Secretary", password: "x:unusable" },
  });
  await prisma.account.create({ data: { eventId: event.id, name: "L. Secretary", email: organizer.email, role: "admin" } });
  // A member of the first club, who may look and may not touch.
  const memberEmail = `${mark}-0-0@example.invalid`.toLowerCase();
  const member = await prisma.user.create({ data: { email: memberEmail, name: roster[0][0].name, password: "x:unusable" } });
  await prisma.account.create({ data: { eventId: event.id, name: roster[0][0].name, email: memberEmail, role: "player" } });
  return { event, weeks, clubs, roster, organizer, member };
}
async function remove(mark: string) {
  await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: mark.toLowerCase() } } });
}

// ── The golf, worked out here and sharing nothing with the app ──────────────
/** Nearest whole number, a half upwards. */
const nearest = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
/** 90% of the index, taken of the figure with its decimal and rounded once. */
const playingOff = (index: number) => nearest(Math.round(index * 10) * 90, 1000);
const shotsOn = (strokes: number, strokeIndex: number) => Math.floor(strokes / 18) + (strokeIndex <= strokes % 18 ? 1 : 0);

type Ball = { index: number; strokes: number[] };
type Hole = "A" | "B" | "H";
/** A four-ball's holes: the lowest of the four off scratch, the better net ball of each side. */
function fourBall(a: Ball[], b: Ball[]): Hole[] {
  const low = Math.min(...[...a, ...b].map((x) => playingOff(x.index)));
  const best = (side: Ball[], h: number) =>
    Math.min(...side.map((x) => x.strokes[h] - shotsOn(playingOff(x.index) - low, STROKE_INDEX[h])));
  return PARS.map((_, h) => {
    const [x, y] = [best(a, h), best(b, h)];
    return x < y ? "A" : y < x ? "B" : "H";
  });
}
/** How a match ends: over when a side is more holes up than remain. */
function result(holes: Hole[]) {
  let lead = 0;
  for (let h = 0; h < holes.length; h += 1) {
    lead += holes[h] === "A" ? 1 : holes[h] === "B" ? -1 : 0;
    const left = holes.length - 1 - h;
    if (Math.abs(lead) > left) return { winner: lead > 0 ? "A" : "B", text: left === 0 ? `${Math.abs(lead)} UP` : `${Math.abs(lead)}&${left}` };
  }
  return { winner: "H", text: "AS" };
}
const SYSTEMS = {
  match: "Match play — 1 point a win, ½ a half",
  "holes-and-match": "Holes won, plus a bonus for the match",
  holes: "Holes won only",
  nassau: "Nassau — front nine, back nine, overall",
} as const;
type System = keyof typeof SYSTEMS;
/** A four-ball's points to each side, from the sentence the screen prints for the system. */
function points(holes: Hole[], system: System, bonus: number): [number, number] {
  const won = (seg: Hole[], who: Hole) => seg.filter((h) => h === who).length;
  const halves = (seg: Hole[]) => seg.filter((h) => h === "H").length;
  const r = result(holes);
  if (system === "match") return r.winner === "A" ? [1, 0] : r.winner === "B" ? [0, 1] : [0.5, 0.5];
  if (system === "nassau") {
    let [a, b] = [0, 0];
    for (const seg of [holes.slice(0, 9), holes.slice(9), holes]) {
      const d = won(seg, "A") - won(seg, "B");
      a += d > 0 ? 1 : d < 0 ? 0 : 0.5;
      b += d < 0 ? 1 : d > 0 ? 0 : 0.5;
    }
    return [a, b];
  }
  const a = won(holes, "A") + halves(holes) / 2;
  const b = won(holes, "B") + halves(holes) / 2;
  if (system === "holes") return [a, b];
  return r.winner === "A" ? [a + bonus, b] : r.winner === "B" ? [a, b + bonus] : [a + bonus / 2, b + bonus / 2];
}

/** A seeded card: the higher the index, the fewer the pars. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cardFor(seed: number, week: number, playerSeed: number, index: number) {
  const rand = rng(seed * 7919 + week * 104729 + playerSeed * 1299709);
  const birdie = Math.max(0.03, 0.14 - index / 250);
  const par = Math.max(0.2, 0.62 - index / 55);
  return PARS.map((p) => {
    const r = rand();
    return p + (r < birdie ? -1 : r < birdie + par ? 0 : r < birdie + par + 0.28 ? 1 : 2);
  });
}

type Drawn = { matchId: string; a: { teamId: string; club: number; name: string; players: number[] }; b: { teamId: string; club: number; name: string; players: number[] } };

test("a secretary runs a four-club league from its first week to its champion, and every figure on the table is the cards'", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third season proves nothing a second did not");
  test.setTimeout(900_000);
  const mark = `zz-interclub-${testInfo.project.name}`;
  await remove(mark);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const fx = await build(mark);
  const { clubs, roster, weeks } = fx;
  const flat = roster.flat();
  const seedOf = (playerId: string) => flat.findIndex((p) => p.id === playerId);

  try {
    await context.addCookies([
      { name: "ng_session", value: sign(signedInNow(fx.organizer.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(fx.event.id), url: baseURL! },
    ]);
    const league = page.locator("section", { has: page.locator(".page-kicker", { hasText: "League" }) });
    const open = async (week: number) => {
      await page.goto(`/teams?round=${weeks[week]}&bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(league, "the Teams screen shows no league").toBeVisible();
    };
    const settings = async () => {
      const scoring = league.getByLabel("Scoring");
      if (!(await scoring.isVisible().catch(() => false))) await league.locator("summary", { hasText: "League settings" }).click();
      await expect(scoring).toBeVisible();
      return scoring;
    };
    const stored = async () =>
      prisma.event.findUniqueOrThrow({
        where: { id: fx.event.id },
        select: { leaguePoints: true, leagueMatchBonus: true, leaguePairs: true, leaguePlayoffClubs: true },
      });
    /** A club's team sheet: its pairs, and the roster to pick from. */
    const sheet = (c: number) =>
      page.locator("div", { has: page.locator(":scope > .card .card-title", { hasText: new RegExp(`^${clubs[c].name}$`) }) }).last();
    const pairName = (c: number, pair: number[]) => pair.map((k) => roster[c][k].name).join(" / ");
    const nominate = async (c: number, pair: number[]) => {
      const s = sheet(c);
      for (const k of pair) await s.getByRole("button", { name: new RegExp(`^${roster[c][k].name} `) }).click();
      await s.getByRole("button", { name: "Nominate pair" }).click();
      await expect(s.getByText(pairName(c, pair), { exact: true }), `${pairName(c, pair)} was not put up`).toBeVisible();
    };

    /** The week as the database holds it: who plays whom. */
    const drawnIn = async (week: number): Promise<Drawn[]> => {
      const matches = await prisma.match.findMany({ where: { stageId: weeks[week] }, orderBy: [{ round: "asc" }, { id: "asc" }] });
      const side = async (teamId: string) => {
        const t = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, include: { members: { orderBy: { position: "asc" } } } });
        return { teamId, club: clubs.findIndex((c) => c.id === t.clubGroupId), name: t.name, players: t.members.map((m) => seedOf(m.playerId)) };
      };
      const out: Drawn[] = [];
      for (const m of matches) out.push({ matchId: m.id, a: await side(m.teamAId), b: await side(m.teamBId) });
      return out;
    };
    /** The cards a week is played to, by seed. */
    const cardsOf = (seed: number, week: number, d: Drawn) => {
      const ball = (p: number): Ball => ({ index: flat[p].index, strokes: cardFor(seed, week, p, flat[p].index) });
      return { a: d.a.players.map(ball), b: d.b.players.map(ball) };
    };
    type Played = { d: Drawn; holes: Hole[] }[];
    const play = (seed: number, week: number, drawn: Drawn[]): Played =>
      drawn.map((d) => {
        const { a, b } = cardsOf(seed, week, d);
        return { d, holes: fourBall(a, b) };
      });

    /** What a set of weeks comes to, club by club. */
    const tableOf = (season: Played[], system: System, bonus: number) => {
      const rows = clubs.map((c) => ({ name: c.name, played: 0, won: 0, holes: 0, points: 0 }));
      for (const week of season) {
        const meetings = new Map<string, { x: number; y: number; px: number; py: number }>();
        for (const { d, holes } of week) {
          const [x, y] = [Math.min(d.a.club, d.b.club), Math.max(d.a.club, d.b.club)];
          const m = meetings.get(`${x}:${y}`) ?? { x, y, px: 0, py: 0 };
          const [pa, pb] = points(holes, system, bonus);
          m.px += d.a.club === x ? pa : pb;
          m.py += d.a.club === x ? pb : pa;
          meetings.set(`${x}:${y}`, m);
          const diff = holes.filter((h) => h === "A").length - holes.filter((h) => h === "B").length;
          rows[d.a.club].holes += diff;
          rows[d.b.club].holes -= diff;
        }
        for (const m of meetings.values()) {
          rows[m.x].points += m.px;
          rows[m.y].points += m.py;
          rows[m.x].played += 1;
          rows[m.y].played += 1;
          if (m.px > m.py) rows[m.x].won += 1;
          if (m.py > m.px) rows[m.y].won += 1;
        }
      }
      return rows;
    };

    /** The season table as drawn. */
    const tableOnScreen = async (scope: Locator) => {
      const table = scope.locator("table", { has: page.locator("th", { hasText: /^Played$/ }) }).first();
      await expect(table, "there is no league table").toBeVisible();
      const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())));
      return rows.map(([pos, name, played, won, holes, pts]) => ({ pos, name, played: Number(played), won: Number(won), holes: Number(holes), points: Number(pts) }));
    };
    const tableHolds = async (scope: Locator, season: Played[], system: System, bonus: number, what: string) => {
      const want = tableOf(season, system, bonus);
      const got = await tableOnScreen(scope);
      for (const w of want) {
        const row = got.find((g) => g.name === w.name);
        expect(row, `${what}: ${w.name} is not on the table`).toBeTruthy();
        expect({ played: row!.played, won: row!.won, holes: row!.holes, points: row!.points }, `${what}: ${w.name}`).toEqual({
          played: w.played,
          won: w.won,
          holes: w.holes,
          points: w.points,
        });
        // A place is one more than the number of clubs with more points, and is shared when the points are.
        const above = want.filter((o) => o.points > w.points).length;
        const shared = want.filter((o) => o.points === w.points).length > 1;
        expect(row!.pos, `${what}: ${w.name}'s place`).toBe(`${shared ? "T" : ""}${above + 1}`);
      }
      const order = got.map((g) => g.points);
      expect(order, `${what}: the table is not in order of points`).toEqual([...order].sort((x, y) => y - x));
      return got;
    };
    /** The week's meetings as drawn: every four-ball's result and points, by the two pairs' names. */
    const meetingsOnScreen = async (scope: Locator) => {
      const cards = scope.locator(".card", { has: page.locator("th", { hasText: /^Match$/ }) });
      return cards.evaluateAll((els) =>
        els.map((card) => ({
          title: ((card.querySelector(".card-title") as HTMLElement | null)?.innerText ?? "").trim(),
          rows: [...card.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())),
        })),
      );
    };
    const meetingsHold = async (scope: Locator, week: Played, system: System, bonus: number, what: string) => {
      const shown = await meetingsOnScreen(scope);
      const rows = shown.flatMap((m) => m.rows);
      expect(rows.length, `${what}: the meetings list has ${rows.length} four-balls`).toBe(week.length);
      for (const { d, holes } of week) {
        const row = rows.find((r) => (r[0] === d.a.name && r[2] === d.b.name) || (r[0] === d.b.name && r[2] === d.a.name));
        expect(row, `${what}: ${d.a.name} v ${d.b.name} is not in the meetings list`).toBeTruthy();
        expect(row![1], `${what}: how ${d.a.name} v ${d.b.name} ended`).toBe(result(holes).text);
        const [pa, pb] = points(holes, system, bonus);
        const [first, second] = row![0] === d.a.name ? [pa, pb] : [pb, pa];
        expect(row![3].replace(/\s+/g, " "), `${what}: the points of ${d.a.name} v ${d.b.name}`).toBe(`${first.toFixed(2)} – ${second.toFixed(2)}`);
      }
    };

    /**
     * Type a week's cards into the score-entry screen, a player at a time, and read each back from
     * the database. On a phone the screen opens a hole at a time; a whole card is typed on the full one.
     */
    const typeCards = async (week: number, drawn: Drawn[], cards: (d: Drawn, i: number) => { a: Ball[]; b: Ball[] }) => {
      await page.goto(`/entry?round=${weeks[week]}&bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const cell = page.locator("input[data-score-cell]").first();
      if (!(await cell.isVisible().catch(() => false))) await page.getByRole("button", { name: "Full card" }).click();
      await expect(cell, "the score-entry screen offers no full card").toBeVisible();
      for (const [n, d] of drawn.entries()) {
        const { a, b } = cards(d, n);
        for (const [side, balls] of [[d.a, a], [d.b, b]] as const) {
          for (const [i, p] of side.players.entries()) {
            const name = flat[p].name;
            const block = page
              .locator("div", { has: page.locator(":scope > div.sc-wrap") })
              .filter({ has: page.getByLabel(`${name}, hole 1, par ${PARS[0]}`, { exact: true }) })
              .last();
            await expect(block, `the entry screen has no card for ${name}`).toBeVisible();
            for (const [h, s] of balls[i].strokes.entries()) {
              await block.getByLabel(`${name}, hole ${h + 1}, par ${PARS[h]}`, { exact: true }).fill(String(s));
            }
            await block.getByRole("button", { name: "Save card" }).click();
            await expect
              .poll(
                async () => {
                  const row = await prisma.teamScorecard.findFirst({ where: { stageId: weeks[week], teamId: side.teamId, playerId: flat[p].id } });
                  return row ? row.strokes : "";
                },
                { message: `${name}'s card was not stored as it was typed`, timeout: 15_000 },
              )
              .toBe(JSON.stringify(balls[i].strokes));
          }
        }
      }
    };
    const enterInTheBrowser = (seed: number, week: number, drawn: Drawn[]) => typeCards(week, drawn, (d) => cardsOf(seed, week, d));
    /** The same cards written as rows: what a week's scoring leaves behind, without the typing. */
    const writeAsRows = async (seed: number, week: number, drawn: Drawn[]) => {
      for (const d of drawn) {
        const { a, b } = cardsOf(seed, week, d);
        for (const [side, balls] of [[d.a, a], [d.b, b]] as const) {
          for (const [i, p] of side.players.entries()) {
            await prisma.teamScorecard.create({
              data: { eventId: fx.event.id, stageId: weeks[week], teamId: side.teamId, matchId: d.matchId, playerId: flat[p].id, strokes: JSON.stringify(balls[i].strokes) },
            });
          }
        }
      }
    };

    // ── 1. the league is switched on ─────────────────────────────────────────
    await open(0);
    await expect(league.getByText(/Choose a scoring system to switch it on/)).toBeVisible();
    await (await settings()).selectOption({ label: SYSTEMS.match });
    await league.getByLabel(/Pairs per club each week/).fill("25");
    await league.getByRole("button", { name: "Save league settings" }).click();
    await expect(league.getByRole("alert").filter({ hasText: "Pairs per club is a whole number from 0 to 24." }), "25 pairs a club was not refused where it was typed").toBeVisible();
    expect((await stored()).leaguePoints, "a refused setting switched the league on").toBe("");
    await league.getByLabel(/Pairs per club each week/).fill("2");
    await league.getByLabel("Play-offs").selectOption({ label: "Top 2 — a final" });
    await league.getByRole("button", { name: "Save league settings" }).click();
    await expect(league.getByText("Saved.")).toBeVisible();
    expect(await stored()).toEqual({ leaguePoints: "match", leagueMatchBonus: 2, leaguePairs: 2, leaguePlayoffClubs: 2 });
    // The save that switches the league on does not shut the form it was pressed in: the word
    // "Saved." stays where the press was, with the settings still open under it. It used to be a
    // race — the stored value changed and the panel closed over the word in the same instant.
    await expect(league.getByLabel("Scoring"), "the settings shut when the league was switched on").toBeVisible();
    await page.waitForTimeout(1500);
    await expect(league.getByText("Saved."), "\"Saved.\" was shown and then taken away").toBeVisible();
    await expect(league.getByLabel("Scoring")).toBeVisible();

    // ── 2. before a ball is struck: nobody has played, and nobody is in the final ─
    await open(0);
    for (const row of await tableOnScreen(league)) expect(row, `${row.name} before anybody has played`).toMatchObject({ played: 0, won: 0, holes: 0, points: 0 });
    await expect(league.getByText("Final — as the table stands"), "the final is printed as settled before anybody has played").toBeVisible();
    await expect(league.getByText(/Not settled yet\./)).toBeVisible();
    await expect(league.getByText("6 season meetings still have no result", { exact: false })).toBeVisible();
    await expect(league.getByText(/^Champions:/)).toHaveCount(0);

    // ── 3. the first week's team sheets ──────────────────────────────────────
    await expect(sheet(0).getByRole("button", { name: "Nominate pair" }), "a pair of nobody can be put up").toBeDisabled();
    await sheet(0).getByRole("button", { name: new RegExp(`^${roster[0][0].name} `) }).click();
    await expect(sheet(0).getByRole("button", { name: "Nominate pair" }), "a pair of one can be put up").toBeDisabled();
    await sheet(0).getByRole("button", { name: new RegExp(`^${roster[0][0].name} `) }).click();
    for (const c of [0, 1, 2, 3]) for (const pair of PAIRS_BY_WEEK[0]) await nominate(c, pair);
    await expect(sheet(0).getByText("2 of 2 pairs")).toBeVisible();
    await expect(sheet(0).getByText("Everybody on the roster is already in a pair this round.")).toBeVisible();
    // A pair taken down and put up again: the second pair, so the order the club nominated in is kept.
    const second = pairName(0, PAIRS_BY_WEEK[0][1]);
    await sheet(0).locator("li", { hasText: second }).getByRole("button", { name: "Withdraw" }).click();
    await expect(sheet(0).getByText(second, { exact: true }), "a withdrawn pair is still on the sheet").toHaveCount(0);
    expect(await prisma.team.count({ where: { stageId: weeks[0], clubGroupId: clubs[0].id } })).toBe(1);
    await nominate(0, PAIRS_BY_WEEK[0][1]);

    // ── 4. the draw: everybody meets somebody, first pair against first pair ──
    await league.getByRole("button", { name: "Draw this week", exact: true }).click();
    await expect(league.getByText("4 four-balls drawn.")).toBeVisible();
    let week1 = await drawnIn(0);
    expect(week1).toHaveLength(4);
    const meets = (drawn: Drawn[]) => [...new Set(drawn.map((d) => [d.a.club, d.b.club].sort().join("v")))].sort();
    expect(meets(week1), "the week is not two meetings of two different clubs each").toHaveLength(2);
    expect(new Set(week1.flatMap((d) => [d.a.club, d.b.club])).size, "a club has no meeting this week").toBe(4);
    for (const d of week1) {
      expect(d.a.club, `${d.a.name} was drawn against its own club`).not.toBe(d.b.club);
      // First pair against first pair: the pairs of a four-ball were nominated in the same place.
      const place = (side: Drawn["a"]) => PAIRS_BY_WEEK[0].findIndex((pair) => pairName(side.club, pair) === side.name);
      expect(place(d.a), `${d.a.name} v ${d.b.name} is not first pair against first pair`).toBe(place(d.b));
    }

    // Drawn is not played: no result, no points, and nobody has played a meeting.
    await open(0);
    for (const m of await meetingsOnScreen(league)) {
      for (const r of m.rows) {
        expect(r[1], `${r[0]} v ${r[2]} has a result before anybody has played`).toBe("—");
        expect(r[3].replace(/\s+/g, " ")).toBe("0.00 – 0.00");
      }
    }
    for (const row of await tableOnScreen(league)) expect(row.played, `${row.name} has played a meeting that was only drawn`).toBe(0);

    // ── 5. drawing again asks first ──────────────────────────────────────────
    const before = week1.map((d) => d.matchId).sort();
    await league.getByRole("button", { name: "Redraw this week", exact: true }).click();
    await expect(league.getByText("Replace this week's draw?")).toBeVisible();
    await expect(league.getByText(/This week already has 4 matches\./)).toBeVisible();
    await league.getByRole("button", { name: "Keep them", exact: true }).click();
    expect((await drawnIn(0)).map((d) => d.matchId).sort(), "declining replaced the draw").toEqual(before);
    await league.getByRole("button", { name: "Redraw this week", exact: true }).click();
    await league.getByRole("button", { name: "Replace them", exact: true }).click();
    await expect(league.getByText("4 four-balls drawn.")).toBeVisible();
    week1 = await drawnIn(0);
    expect(week1).toHaveLength(4);
    expect(week1.map((d) => d.matchId).sort(), "Replace them kept the old matches").not.toEqual(before);

    // ── 6. week one is played, and typed in ──────────────────────────────────
    // CONTROL on the cards: a week in which one four-ball ends early, one goes the distance, and the
    // scoring systems disagree — or the checks below could pass on a week that says nothing.
    let seed1 = 0;
    for (let s = 1; s <= 400 && !seed1; s += 1) {
      const p = play(s, 0, week1);
      const texts = p.map((x) => result(x.holes).text);
      const early = texts.some((t) => t.includes("&"));
      const late = texts.some((t) => t.endsWith("UP") || t === "AS");
      const lines = (["match", "holes", "nassau"] as const).map((sys) => JSON.stringify(tableOf([p], sys, 3).map((r) => r.points)));
      const decided = tableOf([p], "match", 3).some((r) => r.won === 1);
      if (early && late && decided && new Set(lines).size === 3) seed1 = s;
    }
    expect(seed1, "no week of cards was found that ends one match early and one late").toBeGreaterThan(0);
    const played1 = play(seed1, 0, week1);
    testInfo.annotations.push({ type: "week 1", description: played1.map((x) => `${x.d.a.name} v ${x.d.b.name}: ${result(x.holes).text}`).join("; ") });
    await enterInTheBrowser(seed1, 0, week1);

    await open(0);
    await meetingsHold(league, played1, "match", 2, "week 1 on match play");
    await tableHolds(league, [played1], "match", 2, "after week 1");
    await expect(league.getByText("4 season meetings still have no result", { exact: false })).toBeVisible();
    // And the score-entry screen's saved cards agree with the stored result of each match, hole for hole.
    for (const { d, holes } of played1) {
      const m = await prisma.match.findUniqueOrThrow({ where: { id: d.matchId } });
      expect(JSON.parse(m.holes), `the stored holes of ${d.a.name} v ${d.b.name}`).toEqual(holes);
    }

    // ── 7. the same week under each way of scoring it ────────────────────────
    const scoreBy = async (system: System, bonus: number) => {
      await (await settings()).selectOption({ label: SYSTEMS[system] });
      if (system === "holes-and-match") await league.getByLabel("Points for winning the match").fill(String(bonus));
      await league.getByRole("button", { name: "Save league settings" }).click();
      await expect(league.getByText("Saved.")).toBeVisible();
      expect((await stored()).leaguePoints).toBe(system);
      await open(0);
      await meetingsHold(league, played1, system, bonus, `week 1 on ${system}`);
      await tableHolds(league, [played1], system, bonus, `after week 1 on ${system}`);
    };
    await scoreBy("holes-and-match", 3);
    expect((await stored()).leagueMatchBonus).toBe(3);
    await scoreBy("holes", 3);
    await scoreBy("nassau", 3);
    await scoreBy("match", 3);

    // ── 8. a pair that has played cannot be taken down, and is told so beside it ─
    const first = pairName(0, PAIRS_BY_WEEK[0][0]);
    const pairsCard = sheet(0).locator(":scope > .card").first();
    await pairsCard.locator("li", { hasText: first }).getByRole("button", { name: "Withdraw" }).click();
    await expect(pairsCard.getByRole("alert"), "the refusal is not beside the pair").toHaveText(`${first} has a card. Clear the scores before taking the pair down.`);
    expect(await prisma.team.count({ where: { stageId: weeks[0], clubGroupId: clubs[0].id } }), "a pair with a card was taken down").toBe(2);

    // ── 9. the final cannot be drawn off a season two weeks short without being asked ─
    await open(3);
    for (const c of [0, 1, 2, 3]) for (const pair of PAIRS_BY_WEEK[1]) await nominate(c, pair);
    await league.getByRole("button", { name: "Draw this week", exact: true }).click();
    await expect(league.getByText("Draw the play-offs before the season is finished?"), "the final was drawn off one week of three without a question").toBeVisible();
    await expect(league.getByText(/4 season meetings were never played/)).toBeVisible();
    expect(await prisma.match.count({ where: { stageId: weeks[3] } }), "asked, and drew anyway").toBe(0);
    await league.getByRole("button", { name: "Not yet", exact: true }).click();
    await expect(league.getByText("Draw the play-offs before the season is finished?")).toHaveCount(0);
    expect(await prisma.match.count({ where: { stageId: weeks[3] } }), "declining drew the final").toBe(0);

    // ── 10. the fixture list for weeks two and three, and what "played" means ──
    for (const w of [1, 2]) {
      await open(w);
      for (const c of [0, 1, 2, 3]) for (const pair of PAIRS_BY_WEEK[w]) await nominate(c, pair);
      await league.getByRole("button", { name: "Draw this week", exact: true }).click();
      await expect(league.getByText("4 four-balls drawn.")).toBeVisible();
    }
    const week2 = await drawnIn(1);
    const week3 = await drawnIn(2);
    // Everybody meets everybody once: three weeks, six different meetings.
    expect(new Set([...meets(week1), ...meets(week2), ...meets(week3)]).size, "a pair of clubs meets twice, or not at all").toBe(6);
    // Two weeks drawn and not played: every club has still played ONE meeting.
    await open(1);
    await tableHolds(league, [played1], "match", 3, "with weeks 2 and 3 drawn and not played");
    // And the final, with weeks 2 and 3 drawn but out: refused outright, by the meeting that is not finished.
    await open(3);
    await league.getByRole("button", { name: "Draw this week", exact: true }).click();
    await expect(league.getByRole("alert").filter({ hasText: /is not finished yet\. The play-offs are drawn once every meeting before them has a result\./ })).toBeVisible();
    expect(await prisma.match.count({ where: { stageId: weeks[3] } })).toBe(0);

    // CONTROL on the season: cards for weeks 2 and 3 that leave no two clubs level on points, so the
    // finalists are the cards' and not a countback's.
    let seed2 = 0;
    for (let s = 1; s <= 2000 && !seed2; s += 1) {
      const pts = tableOf([played1, play(s, 1, week2), play(s, 2, week3)], "match", 3).map((r) => r.points);
      if (new Set(pts).size === 4) seed2 = s;
    }
    expect(seed2, "no season was found with all four clubs on different points").toBeGreaterThan(0);
    const played2 = play(seed2, 1, week2);
    const played3 = play(seed2, 2, week3);

    // Weeks 2 and 3 are written as rows — the typing was week 1's, and is the final's.
    await writeAsRows(seed2, 1, week2);
    await open(1);
    await meetingsHold(league, played2, "match", 3, "week 2");
    await tableHolds(league, [played1, played2], "match", 3, "after week 2, with week 3 drawn and not played");
    await expect(league.getByText("2 season meetings still have no result", { exact: false })).toBeVisible();
    await writeAsRows(seed2, 2, week3);
    await open(2);
    await meetingsHold(league, played3, "match", 3, "week 3");
    const final = await tableHolds(league, [played1, played2, played3], "match", 3, "the finished season");
    testInfo.annotations.push({ type: "the season", description: final.map((r) => `${r.pos} ${r.name} ${r.points}`).join("; ") });

    // ── 11. the season is over: the final is the top two, and says so plainly ──
    const [top, runnerUp] = [...tableOf([played1, played2, played3], "match", 3)].sort((x, y) => y.points - x.points);
    const [X, Y] = [clubs.findIndex((c) => c.name === top.name), clubs.findIndex((c) => c.name === runnerUp.name)];
    await expect(league.getByText("as the table stands"), "a finished season's final is still printed as provisional").toHaveCount(0);
    await expect(league.getByText(/Not settled yet/)).toHaveCount(0);
    await expect(league.locator("li", { hasText: `${top.name} v ${runnerUp.name}` }).filter({ hasText: "(1)" }), "the final is not first against second").toBeVisible();

    // ── 12. the final: drawn without a question, played level, settled on a play-off hole ─
    await open(3);
    await league.getByRole("button", { name: "Draw this week", exact: true }).click();
    await expect(league.getByText("2 four-balls drawn.")).toBeVisible();
    await expect(league.getByText("Draw the play-offs before the season is finished?")).toHaveCount(0);
    const finalDrawn = await drawnIn(3);
    expect(finalDrawn).toHaveLength(2);
    expect(meets(finalDrawn), "the final is not between the top two clubs").toEqual([[X, Y].sort().join("v")]);
    // One four-ball each: the first to the leaders, the second to the runners-up. Twos against nines
    // cannot be turned by a stroke or two a hole.
    const finalCards = (d: Drawn, i: number) => {
      const winner = i === 0 ? X : Y;
      const strokes = (club: number) => new Array(18).fill(club === winner ? 2 : 9);
      const ball = (p: number): Ball => ({ index: flat[p].index, strokes: strokes(flat[p].club) });
      return { a: d.a.players.map(ball), b: d.b.players.map(ball) };
    };
    for (const [i, d] of finalDrawn.entries()) {
      const { a, b } = finalCards(d, i);
      expect(result(fourBall(a, b)).text, "the final's cards do not decide their four-ball").toBe("10&8");
    }
    await typeCards(3, finalDrawn, finalCards);
    await open(3);
    const finalMeeting = (await meetingsOnScreen(league)).flatMap((m) => m.rows);
    expect(finalMeeting.map((r) => r[1])).toEqual(["10&8", "10&8"]);
    await expect(league.getByText(/finished level — a play-off hole decides it/)).toBeVisible();
    await expect(league.getByText(/^Champions:/), "a level final has a champion").toHaveCount(0);
    // The season's table is the season's: a final does not move it.
    await tableHolds(league, [played1, played2, played3], "match", 3, "the season table, after the final");

    const decision = league.locator(".card", { has: page.locator(".card-title", { hasText: /^Final: / }) }).filter({ hasText: "Finished level." });
    await decision.getByRole("button", { name: "Record the play-off hole" }).click();
    await decision.getByRole("button", { name: `${runnerUp.name} won the hole`, exact: true }).click();
    await expect(league.getByText(`Champions: ${runnerUp.name}`, { exact: true })).toBeVisible();
    await expect(league.getByText(`${runnerUp.name} won the play-off hole (recorded by L. Secretary)`)).toBeVisible();
    expect((await prisma.leaguePlayoffHole.findFirstOrThrow({ where: { stageId: weeks[3] } })).winnerId).toBe(clubs[Y].id);

    // ── 13. what a member of a club sees: the week, the table and the champion, and nothing to press ─
    const theirs = await browser.newContext();
    try {
      await theirs.addCookies([
        { name: "ng_session", value: sign(signedInNow(fx.member.id)), url: baseURL! },
        { name: "ng_active_event", value: sign(fx.event.id), url: baseURL! },
      ]);
      const member = await theirs.newPage();
      const memberErrors: string[] = [];
      watchPageErrors(member, memberErrors, "member");
      await member.goto(`/week?round=${weeks[3]}&bust=${Date.now()}`);
      await member.waitForLoadState("networkidle").catch(() => {});
      const main = member.locator("main");
      await expect(main.getByText(`Champions: ${runnerUp.name}`, { exact: true })).toBeVisible();
      const seen = await main.locator("table", { has: member.locator("th", { hasText: /^Played$/ }) }).first().locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())),
      );
      expect(seen.map((r) => [r[1], Number(r[5])]), "a member's table is not the secretary's").toEqual(final.map((r) => [r.name, r.points]));
      for (const name of ["Nominate pair", "Withdraw", "Draw this week", "Redraw this week", "Record the play-off hole", "Save league settings"]) {
        await expect(main.getByRole("button", { name, exact: true }), `a member is offered ${name}`).toHaveCount(0);
      }
      expect(memberErrors, memberErrors.join("\n")).toEqual([]);
    } finally {
      await theirs.close();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await remove(mark);
    await prisma.$disconnect();
  }
});
