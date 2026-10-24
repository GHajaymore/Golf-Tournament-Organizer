import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The board is `unstable_cache`d, which throws outside a Next request; the
// identity runs the real builder, which is the code the report reads.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
import { createElement } from "react";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { reportFor, reportCardInput, type AnyReport, type EventReport as Report } from "@/lib/services/event-report";
import { liveBoard } from "@/lib/services/live-board";
import { EventReport } from "@/components/EventReport";
import { FinalReport } from "@/components/FinalReport";
import { reportCard } from "@/lib/domain/report-card";
import { SIGNINS_KEY } from "@/lib/services/signins-switch";
import { HELD_FRONT_DOOR } from "@/lib/sign-in-gate";
// A plain .mjs fixture, shared with the browser spec so the two walk the same tournaments.
import { seedRich, teardownRich, NAMES } from "../../../e2e/report-rich-fixture.mjs";

/**
 * THE RICH REPORT, AGAINST REAL ROWS (2026-10-23; Ajay: "make all the reports
 * rich and add some graphics … include money only if the tournament has it.
 * so as other things"). Four invented, finished tournaments with money and
 * extras in them (`e2e/report-rich-fixture.mjs`, worked by hand in its
 * header), each read through `reportFor` as the pages read it, and drawn.
 *
 *   the lead          each format's own words; a countback says where; a
 *                     play-off says who won it
 *   money at the sink a pot that can still change is absent, mid-round; a
 *                     finished Nassau nine is present; the word "bet" and
 *                     anything saying money was paid are nowhere
 *   sections          every format × section is drawn with data or not drawn,
 *                     with a control that it IS drawn when the data is there
 *   privacy           the public page carries no address, no phone number and
 *                     no handicap index
 *   the launch switch the footer follows it both ways
 *
 *   npx vitest run --config vitest.audit.config.ts the-rich-report
 */

const MARK = "zz-audit-rich";
const prisma = new PrismaClient();
type Seeded = Awaited<ReturnType<typeof seedRich>>;
let seeded: Seeded;

const event = async (eventId: string, audience: "staff" | "public" = "staff"): Promise<Report> => {
  const found = await reportFor(eventId, audience === "staff" ? { kind: "staff", email: seeded.organizerEmail } : { kind: "public" });
  if (!found || found.kind !== "event") throw new Error("not an event report");
  return found.report;
};
const cup = async (eventId: string) => {
  const found = await reportFor(eventId, { kind: "public" });
  if (!found || found.kind !== "cup") throw new Error("not a cup report");
  return found.report;
};
const html = (r: Report) => renderToStaticMarkup(createElement(EventReport, { report: r }));
const h2s = (page: string) => [...page.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

beforeAll(async () => {
  seeded = await seedRich(MARK);
}, 120_000);

afterAll(async () => {
  await teardownRich(MARK);
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------------ */

describe("each format leads with its result in its own words", () => {
  it("a Stableford: points, never a to-par; a tie on points placed by the board's countback, said with where", async () => {
    const r = await event(seeded.events.stableford.eventId);
    expect(r.kind).toBe("stableford");
    const lines = r.lead[0].lines;
    for (const l of lines) expect(l.figure).toMatch(/^\d+ points$/);
    // The board's own order, and its own figures.
    const board = (await liveBoard(seeded.events.stableford.eventId))!;
    const top = board.rows.filter((x) => x.ranked).slice(0, 3);
    expect(lines.flatMap((l) => l.names)).toEqual(top.map((x) => x.name));
    expect(lines.map((l) => l.figure)).toEqual(top.map((x) => `${x.points} points`));
    // Second and third level on points: the countback is said on the second's line.
    expect(top[1].points).toBe(top[2].points);
    expect(lines[1].how).toMatch(new RegExp(`^ahead of ${top[2].name} on countback, (back 9|last [631]|last hole) points$`));
    expect(r.hero?.kind).toBe("points");
    expect(r.holeStrip?.kind).toBe("holes");
  });

  it("a medal: gross and net side by side; a tie the committee settled by play-off; a third place on countback", async () => {
    const r = await event(seeded.events.medal.eventId);
    expect(r.kind).toBe("stroke");
    const [first, second, third] = r.lead[0].lines;
    expect([first.place, first.names, first.how]).toEqual(["Winner", [NAMES[0]], "Won the play-off at the 2nd extra hole"]);
    expect([second.place, second.names, second.how]).toEqual(["Second", [NAMES[1]], "lost the play-off"]);
    expect(first.figure).toBe("72 gross / 70 net");
    expect(second.figure).toBe("72 gross / 68 net");
    // Cora and Dev both 74; Cora's back nine is 36 to Dev's 38.
    expect([third.names, third.figure, third.how]).toEqual([[NAMES[2]], "74 gross / 68 net", `ahead of ${NAMES[3]} on countback, back 9`]);
    expect(r.first?.names).toEqual([NAMES[0]]);
    expect(r.margin).toBe("after a play-off");
    // The board itself still SHARES first — the report never breaks a tie the board did not.
    const board = (await liveBoard(seeded.events.medal.eventId))!;
    expect(board.rows.filter((x) => x.ranked && x.rank === 1).map((x) => x.name).sort()).toEqual([NAMES[0], NAMES[1]].sort());
  });

  it("a medal with no play-off recorded says the first place is shared", async () => {
    const entry = await prisma.honoursEntry.findFirstOrThrow({ where: { eventId: seeded.events.medal.eventId } });
    await prisma.honoursEntry.delete({ where: { id: entry.id } });
    try {
      const r = await event(seeded.events.medal.eventId);
      expect([r.lead[0].lines[0].place, r.lead[0].lines[0].names]).toEqual(["Joint winners", [NAMES[0], NAMES[1]]]);
      expect(r.ribbon).toBe("Shared first place");
    } finally {
      const { id: _id, ...rest } = entry;
      await prisma.honoursEntry.create({ data: rest });
    }
  });

  it("two rounds of medal: the ladder, from the board ranked through each round", async () => {
    const r = await event(seeded.events.championship.eventId);
    expect(r.lead[0].lines[0]).toMatchObject({ place: "Winner", names: [NAMES[0]], figure: "140 gross / 136 net" });
    expect(r.hero?.kind).toBe("ladder");
    if (r.hero?.kind !== "ladder") return;
    expect(r.hero.columns).toEqual(["R1", "Final"]);
    expect(r.hero.rows.slice(0, 4).map((x) => [x.name, ...x.places])).toEqual([
      [NAMES[0], "4", "1"],
      [NAMES[3], "2", "2"],
      [NAMES[1], "3", "3"],
      [NAMES[2], "1", "4"],
    ]);
    expect(r.hero.caption).toBe(`${NAMES[0]} came from 4th after R1 to win.`);
    // The ladder's rows are the leaderboard's, in its order.
    expect(r.hero.rows.map((x) => x.name)).toEqual(r.rows.slice(0, r.hero.rows.length).map((x) => x.name));
  });

  it("a knockout: the champion, the final's margin in golf's words, and the path", async () => {
    const r = await event(seeded.events.knockout.eventId);
    expect(r.kind).toBe("knockout");
    expect(r.lead[0].lines.map((l) => [l.place, l.names, l.figure])).toEqual([
      ["Champion", [NAMES[3]], `beat ${NAMES[1]} in the final at the 19th`],
      ["Runner-up", [NAMES[1]], ""],
      ["Semi-finalists", expect.arrayContaining([NAMES[0], NAMES[2]]), ""],
    ]);
    expect(r.hero?.kind).toBe("path");
    if (r.hero?.kind !== "path") return;
    expect(r.hero.steps.map((s) => [s.opponent, s.margin, s.upset])).toEqual([
      [NAMES[0], " 2&1", false],
      [NAMES[1], " at the 19th", false],
    ]);
    // No position chart over a knockout, and no birdies counted where nobody wrote a hole.
    expect(r.numbers).toEqual([]);
    expect(r.holeStrip).toBeNull();
  });

  it("a four-ball: the winning side's card, whose ball counted on each hole", async () => {
    const r = await event(seeded.events.fourball.eventId);
    expect(r.kind).toBe("team");
    expect(r.hero?.kind).toBe("side");
    if (r.hero?.kind !== "side") return;
    expect(r.hero.side).toBe(`${NAMES[0]} & ${NAMES[1]}`);
    const by = Object.fromEntries(r.hero.holes.filter((h) => h.toPar !== 0).map((h) => [h.hole, [h.score, h.by]]));
    expect(by).toEqual({ 3: [2, "Ailsa"], 7: [2, "Bram"], 11: [2, "Ailsa"], 16: [2, "Bram"] });
    expect(r.hero.holes.reduce((t, h) => t + (h.score ?? 0), 0)).toBe(68);
  });

  it("a league: the table in the board's order, a dot a week, and who missed one", async () => {
    const r = await event(seeded.events.league.eventId);
    expect(r.kind).toBe("league");
    expect(r.hero?.kind).toBe("weeks");
    if (r.hero?.kind !== "weeks") return;
    expect(r.hero.rows.map((x) => x.name)).toEqual(r.rows.filter((x) => x.place).map((x) => x.name).slice(0, r.hero.rows.length));
    const ailsa = r.hero.rows.find((x) => x.name === NAMES[0])!;
    expect([ailsa.weeks, ailsa.played]).toEqual([[true, false, true], 2]);
    const bram = r.hero.rows.find((x) => x.name === NAMES[1])!;
    expect([bram.weeks, bram.played, bram.points]).toEqual([[true, true, true], 3, "111"]);
  });

  it("a cup: its score, session by session, and the match that clinched it", async () => {
    const r = await cup(seeded.events.cup.eventId);
    expect(r.score).toEqual([5.5, 2.5]);
    expect(r.progress.sessions.map((s) => [s.title, s.a, s.b])).toEqual([
      ["Saturday singles", 2.5, 1.5],
      ["Sunday singles", 5.5, 2.5],
    ]);
    // 2½ after Saturday, 3½ after Ailsa's 4&3, 4½ — the cup — after Bram's 1 up.
    expect(r.progress.clinch).toBe(`${NAMES[1]} clinched it for Reds in Sunday singles, 1 up.`);
  });

  it("a casual round: the match's one line, no champion, and the settle-up as its picture", async () => {
    const r = await event(seeded.events.casual.eventId);
    expect(r.kind).toBe("casual");
    expect(r.lead[0].lines[0].names).toEqual([`${NAMES[0]} won 2&1`]);
    expect(r.first).toBeNull();
    expect(r.ribbon).toBe("");
    const page = html(r);
    expect(page).toContain('data-graphic="settle"');
    // One short screen: none of a tournament's long sections.
    for (const gone of ["The leaderboard", "Format and field", "Highlights", "In numbers"]) expect(h2s(page), gone).not.toContain(gone);
  });
});

/* ------------------------------------------------------------------------ */

describe("money is reported only once the amount cannot change — at the sink", () => {
  it("finished: the side games, the twos at a share each, the contests, the settle-up and each player's net", async () => {
    const r = await event(seeded.events.stableford.eventId);
    expect(r.skins.map((s) => s.title)).toEqual(["Skins (Net)"]);
    expect(r.onTheCourse[0]).toEqual({ what: "Twos", who: `${NAMES[0]} (2), ${NAMES[1]} and ${NAMES[3]}`, detail: "4 twos, $5.00 each" });
    expect(r.onTheCourse.map((c) => c.what)).toEqual(["Twos", "Nearest the pin, hole 3", "Longest drive, hole 9"]);
    expect(r.settleUp?.lines.length).toBeGreaterThan(0);
    expect(r.standing?.length).toBe(10);
    expect(r.moneyPending).toBe("");
    // The standing and the payments are one set of balances: what is paid in is paid out.
    const cents = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "")) * 100) * (s.startsWith("−") ? -1 : 1);
    expect(r.standing!.reduce((t, s) => t + (s.net === "square" ? 0 : cents(s.net)), 0)).toBe(0);
  });

  it("mid-round: skins, the twos, a birdie pot and a low gross are all absent, and one line says why", async () => {
    const { eventId, stageId } = seeded.events.stableford;
    // A birdie pot and a low gross on the same round, to show they wait too.
    const extra = await Promise.all(
      ["birdies", "low-gross"].map((kind) =>
        prisma.sideGame.create({ data: { eventId, stageId, kind, buyInCents: 100, entryMode: "opt-in", groupKey: "" } }),
      ),
    );
    const players: string[] = seeded.events.stableford.players.map((p: { id: string }) => p.id);
    for (const g of extra) await prisma.sideGameEntry.createMany({ data: players.map((playerId) => ({ sideGameId: g.id, playerId, confirmed: true })) });
    const card = await prisma.scorecard.findFirstOrThrow({ where: { stageId, playerId: players[0] } });
    try {
      // Control first: finished, both new games are reported.
      const done = await event(eventId);
      expect(done.sideGames.map((g) => g.title).sort()).toEqual(["Birdie pot", "Low gross"]);

      await prisma.event.update({ where: { id: eventId }, data: { status: "live" } });
      await prisma.stage.update({ where: { id: stageId }, data: { closedAt: null } });
      const short = (JSON.parse(card.strokes) as (number | null)[]).map((s, i) => (i === 17 ? null : s));
      await prisma.scorecard.update({ where: { id: card.id }, data: { strokes: JSON.stringify(short) } });

      const live = await event(eventId);
      expect(live.skins).toEqual([]);
      expect(live.sideGames).toEqual([]);
      expect(live.onTheCourse.some((c) => c.what === "Twos")).toBe(false);
      expect(live.settleUp).toBeNull();
      expect(live.standing).toBeNull();
      expect(live.moneyPending).toBe("Side games settle when the last card is in.");
      const page = html(live);
      expect(page).toContain("Side games settle when the last card is in.");
      expect(h2s(page)).not.toContain("Settle up");
      // And never "Champion" before it is over.
      expect(page).not.toMatch(/Champion/);
      expect(live.lead[0].lines[0].place).toBe("Leading");
    } finally {
      await prisma.scorecard.update({ where: { id: card.id }, data: { strokes: card.strokes } });
      await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
      await prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
      await prisma.sideGame.deleteMany({ where: { id: { in: extra.map((g) => g.id) } } });
    }
  });

  it("a Nassau's finished nine is reported while the rest of the match is played — and the settle-up waits", async () => {
    const { eventId } = seeded.events.casual;
    const match = await prisma.match.findFirstOrThrow({ where: { eventId } });
    const cards = await prisma.matchScorecard.findMany({ where: { matchId: match.id } });
    try {
      const holes = (JSON.parse(match.holes) as string[]).map((h, i) => (i < 9 ? h : null));
      await prisma.match.update({ where: { id: match.id }, data: { holes: JSON.stringify(holes) } });
      for (const c of cards) {
        const s = (JSON.parse(c.strokes) as (number | null)[]).map((v, i) => (i < 9 ? v : null));
        await prisma.matchScorecard.update({ where: { id: c.id }, data: { strokes: JSON.stringify(s) } });
      }
      const r = await event(eventId);
      const nassau = r.sideGames.find((g) => g.title === "Nassau");
      expect(nassau?.winners.map((w) => w.detail)).toEqual([`front nine to ${NAMES[0]}`]);
      // The skins can still move, so they are not there; nor the payments.
      expect(r.skins).toEqual([]);
      expect(r.settleUp).toBeNull();
      expect(r.moneyPending).toBe("Side games settle when the last card is in.");
    } finally {
      await prisma.match.update({ where: { id: match.id }, data: { holes: match.holes } });
      for (const c of cards) await prisma.matchScorecard.update({ where: { id: c.id }, data: { strokes: c.strokes } });
    }
  });

  it("no page says 'bet', or that money was paid, or that a pot was won — staff copy or public", async () => {
    for (const e of [seeded.events.stableford, seeded.events.medal, seeded.events.casual]) {
      for (const who of ["staff", "public"] as const) {
        const page = html(await event(e.eventId, who)).replace(/<[^>]+>/g, " ");
        expect(page, `${e.eventId} ${who}`).not.toMatch(/\bbets?\b|\bbetting\b/i);
        expect(page, `${e.eventId} ${who}`).not.toMatch(/\bhas paid\b|\bwas paid\b|\bpaid out\b|\bpay me\b|\bwon a pot\b|\bwon the pot\b/i);
      }
    }
    const c = renderToStaticMarkup(createElement(FinalReport, { report: await cup(seeded.events.cup.eventId) }));
    expect(c).not.toMatch(/\bbets?\b/i);
  });
});

/* ------------------------------------------------------------------------ */

/**
 * EVERY SECTION × EVERY FORMAT, enumerated: shown with data, or not shown. A
 * section's "not shown" is only worth having with a control that it IS shown
 * where the data is, so each row names the fixture that has it.
 */
const SECTIONS: Array<{ h2: RegExp; has: Array<keyof Seeded["events"]>; lacks: Array<keyof Seeded["events"]> }> = [
  { h2: /^(The prize list|Where it stands|The round)$/, has: ["stableford", "medal", "casual"], lacks: [] },
  { h2: /^The points$/, has: ["stableford"], lacks: ["medal", "casual"] },
  { h2: /^How the holes played$/, has: ["stableford", "medal"], lacks: ["casual"] },
  { h2: /^Twos and contests$/, has: ["stableford"], lacks: ["medal", "casual"] },
  { h2: /^Side games$/, has: ["stableford", "casual"], lacks: ["medal"] },
  { h2: /^Settle up$/, has: ["stableford", "casual"], lacks: ["medal"] },
  { h2: /^Entry fees and costs$/, has: ["casual"], lacks: ["stableford", "medal"] },
  { h2: /^Prize winners$/, has: ["medal"], lacks: ["stableford", "casual"] },
  { h2: /^The leaderboard$/, has: ["stableford", "medal"], lacks: ["casual"] },
  { h2: /^Place after each round$/, has: ["championship"], lacks: ["stableford", "medal", "casual", "knockout", "league"] },
  { h2: /^The draw$/, has: ["knockout"], lacks: ["stableford", "medal", "casual", "championship"] },
  { h2: /^The road to the title$/, has: ["knockout"], lacks: ["medal", "championship", "league"] },
  { h2: /^The winning card$/, has: ["fourball"], lacks: ["medal", "stableford", "knockout"] },
  { h2: /^The table, week by week$/, has: ["league"], lacks: ["medal", "stableford", "championship"] },
  // Counted off hole scores: a knockout kept by "who won" has nothing to count.
  { h2: /^In numbers$/, has: ["medal", "championship"], lacks: ["knockout"] },
  { h2: /^How it was won$/, has: ["championship"], lacks: ["medal", "knockout"] },
  { h2: /^Coming up$/, has: ["stableford", "medal", "casual"], lacks: [] },
];

describe("a section is drawn only when the tournament has it", () => {
  for (const s of SECTIONS) {
    it(`${s.h2.source}: drawn for ${s.has.join(", ") || "none here"}, not for ${s.lacks.join(", ") || "none"}`, async () => {
      for (const k of s.has) expect(h2s(html(await event(seeded.events[k].eventId))).some((h) => s.h2.test(h)), `${k} should have it`).toBe(true);
      for (const k of s.lacks) expect(h2s(html(await event(seeded.events[k].eventId))).some((h) => s.h2.test(h)), `${k} should not`).toBe(false);
    });
  }

  it("the public copy of a tournament with money has its side games and NO settle-up, costs or net", async () => {
    const pub = html(await event(seeded.events.casual.eventId, "public"));
    expect(h2s(pub)).toContain("Side games");
    for (const gone of ["Settle up", "Entry fees and costs"]) expect(h2s(pub)).not.toContain(gone);
    expect(pub).not.toContain("Where everybody ends up");
    expect(pub).not.toContain("$");
  });
});

/* ------------------------------------------------------------------------ */

describe("the public report carries nothing private", () => {
  const PHONE = /(?:\+?\d[\s.-]?){10,}/;
  const EMAIL = /@/;
  it("the detectors find what they look for (the control)", () => {
    expect(EMAIL.test("ann@example.invalid")).toBe(true);
    expect(PHONE.test("call 020 7946 0958 now")).toBe(true);
    expect(PHONE.test("72 gross / 66 net")).toBe(false);
  });

  it("no address, no phone number, no handicap index — on every fixture's public page", async () => {
    for (const k of ["stableford", "medal", "casual"] as const) {
      const page = html(await event(seeded.events[k].eventId, "public")).replace(/<style[\s\S]*?<\/style>/g, "");
      const words = page.replace(/<[^>]+>/g, " ");
      expect(words, k).not.toMatch(EMAIL);
      expect(words, k).not.toMatch(PHONE);
      expect(words, k).not.toMatch(/\b(index|handicap index|HCP)\b\s*\d/i);
    }
  });
});

/* ------------------------------------------------------------------------ */

describe("the share card", () => {
  it("names the champion of a finished report, on the board's own figure, and no amount", async () => {
    const found = (await reportFor(seeded.events.stableford.eventId, { kind: "public" })) as AnyReport;
    const card = reportCard(reportCardInput(found), "public");
    expect(card.kind).toBe("report");
    if (card.kind !== "report") return;
    expect([card.label, card.club, card.figure]).toEqual(["Champion", `${MARK} Larchfield Golf Club`, "45 points"]);
    expect(JSON.stringify(card)).not.toMatch(/\$/);
  });
});

/* ------------------------------------------------------------------------ */

describe("'Results by TourneyHQ' follows the launch switch", () => {
  const saved: Record<string, string | undefined> = {};
  let before: string | null = null;
  const set = async (value: string) =>
    prisma.platformSetting.upsert({ where: { key: SIGNINS_KEY }, update: { value }, create: { key: SIGNINS_KEY, value } });

  beforeAll(async () => {
    before = (await prisma.platformSetting.findUnique({ where: { key: SIGNINS_KEY } }))?.value ?? null;
    for (const k of ["VERCEL_ENV", "OWNER_EMAILS", "SIGNINS", "SIGNIN_ALLOW_EMAILS"]) saved[k] = process.env[k];
    // The deploy holds: production, with an owner to let through.
    process.env.VERCEL_ENV = "production";
    process.env.OWNER_EMAILS = `${MARK}-owner@example.invalid`;
    delete process.env.SIGNINS;
    delete process.env.SIGNIN_ALLOW_EMAILS;
  });
  afterAll(async () => {
    if (before === null) await prisma.platformSetting.deleteMany({ where: { key: SIGNINS_KEY } });
    else await set(before);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("held: it points at the early list, in the front door's own words; opened: at the front door", async () => {
    await set("held");
    const held = await event(seeded.events.medal.eventId, "public");
    expect(held.foot).toEqual({ text: "Results by TourneyHQ", href: "/interest", cta: HELD_FRONT_DOOR.cta });
    expect(html(held)).toContain(`href="/interest"`);
    expect(html(held)).toContain(HELD_FRONT_DOOR.cta);

    await set("open");
    const open = await event(seeded.events.medal.eventId, "public");
    expect(open.foot).toEqual({ text: "Results by TourneyHQ", href: "/", cta: "" });
    expect(html(open)).not.toContain(HELD_FRONT_DOOR.cta);
    expect(html(open)).not.toContain(`href="/interest"`);

    // And back: the switch is a switch, not a one-way door.
    await set("held");
    expect((await event(seeded.events.medal.eventId, "public")).foot.href).toBe("/interest");
  });
});
