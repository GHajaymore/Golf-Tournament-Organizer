import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PLAYER WITH NO HANDICAP INDEX IN A ROUND SCORED NET — CAUGHT AND GIVEN (lane N, PR A), against real rows.
 *
 * One tournament at a club on UTC: Round 1 net at 95%, Round 2 net on the same card, Round 3 gross. Two
 * confirmed players: one with an index (12.0), one with none (`handicapSource: "none"`, stored 0). Through
 * the real list, the real launch check, the real secretary's home and the real actions behind Give:
 *
 *   the list (`playersNeedingFigure`)   → the no-index player, in Rounds 1 and 2 only; never the gross round,
 *                                          never the player with an index
 *   the launch dialog                   → one warning, first, saying what PR A does ("scored as a scratch golfer (handicap index 0)")
 *   What's next                         → "1 player needs strokes from you for Round 1 (…)", opening the band
 *   Give, as an assistant organizer     → Round 1's figure stored ONCE, whole, on the round (never on the
 *                                          player, whose roster row still says no index); Rounds 2 and 3 take
 *                                          it as their own fact; the list, the warning and the line are gone;
 *                                          the round's list prices him by the Rule: 18 × 95% = 17.10 → 17
 *   Give, as a player                   → refused by the action; nothing written
 *   a gross-only tournament             → nothing on the list, in the launch dialog, on the home or the doors
 *
 * Fixtures: a zz-marked club and tournaments, invented names, @example.invalid, deleted in a `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts no-index-in-a-net-round
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, getSession, setActiveEvent } from "@/lib/auth";
import { applyRoundHandicapToRest, setRoundHandicapOverride } from "@/app/actions/tournament";
import { needsStrokesNoteFor, playersNeedingFigure } from "@/lib/services/committee-figure";
import { launchCheckFor } from "@/lib/services/setup-flow";
import { secretaryHomeFor } from "@/lib/services/whats-next";
import { freezeRoundHandicaps, roundHandicapsFor } from "@/lib/services/round-handicap";
import { correctRoundStrokes } from "@/app/actions/committee-figure";
import { BAND_REFUSAL, CORRECTION_NEEDS_REASON, correctionClosedSaid, correctionMatchSaid } from "@/lib/domain/committee-figure";
import { loadEventState } from "@/lib/services/tournament";
import { jobHref } from "@/lib/domain/needs-you-now";
import { warningText } from "@/lib/domain/launch-check";
import { clubToday } from "@/lib/domain/club-clock";

const prisma = new PrismaClient();
const TAG = "zz-audit-noindexnet";
const ZONE = "UTC";
const at = (who: string) => `${TAG}.${who}@example.invalid`;
let orgId = "";
const users: Record<string, string> = {};

const clubDayFrom = (n: number) => {
  const [y, m, d] = clubToday(ZONE).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.tee.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function as(who: string, eventId: string) {
  jar.clear();
  await createSession(users[who]);
  await setActiveEvent(eventId);
}

async function makeEvent(name: string, bases: string[]) {
  const e = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      startOn: clubDayFrom(7),
      endOn: clubDayFrom(9),
      shareToken: `${TAG}-${name}-${Date.now()}`,
      status: "draft",
    },
  });
  for (const who of ["admin", "assistant", "player"]) {
    await prisma.account.create({ data: { eventId: e.id, email: at(who), name: `${TAG} ${who}`, role: who } });
  }
  const stages: string[] = [];
  for (const [i, scoringBasis] of bases.entries()) {
    stages.push(
      (
        await prisma.stage.create({
          data: { eventId: e.id, position: i, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis, handicapAllowance: 95, playedOn: clubDayFrom(7 + i) },
        })
      ).id,
    );
  }
  const indexed = await prisma.player.create({
    data: { eventId: e.id, name: `${TAG} Indexed Ilsa`, email: at("ilsa"), handicap: 12, handicapSource: "manual", seed: 1, status: "confirmed" },
  });
  const nox = await prisma.player.create({
    data: { eventId: e.id, name: `${TAG} Noindex Okello`, email: at("okello"), handicap: 0, handicapSource: "none", seed: 2, status: "confirmed" },
  });
  return { eventId: e.id, stages, indexed: indexed.id, nox: nox.id };
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: ZONE } })).id;
  for (const who of ["admin", "assistant", "player"]) {
    users[who] = (await prisma.user.create({ data: { email: at(who), name: `${TAG} ${who}`, password: "x", emailVerifiedAt: new Date() } })).id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a player with no index in a net round is caught", () => {
  it("is on the list for the net rounds only, in the launch dialog, on What's next, and on the doors' note", async () => {
    const t = await makeEvent("caught", ["net", "net", "gross"]);
    const list = await playersNeedingFigure(t.eventId);
    expect(list.map((r) => [r.stageId, r.label, r.players.map((p) => p.id)])).toEqual([
      [t.stages[0], "Round 1", [t.nox]],
      [t.stages[1], "Round 2", [t.nox]],
    ]);

    const launch = await launchCheckFor(t.eventId);
    expect(launch.refusal === null || typeof launch.refusal === "string").toBe(true);
    const first = launch.warnings[0];
    expect(first?.says).toBe("1 player has no handicap index and Round 1 and Round 2 are scored net. Until you give them strokes they are scored as a scratch golfer (handicap index 0).");
    expect(first?.href).toBe("/stages");
    expect(warningText(first!)).toContain("you can still do this after launch");

    await as("admin", t.eventId);
    const home = await secretaryHomeFor((await getSession())!);
    const line = home.jobs.find((j) => j.eventId === t.eventId && j.key === "strokes");
    expect(line?.text).toMatch(/^1 player needs strokes from you for Round 1 \(.+\)$/);
    expect(jobHref(line!)).toBe(`/stages?round=${t.stages[0]}#needs-strokes`);

    expect(await needsStrokesNoteFor(t.eventId, true)).toEqual({ text: first!.says, link: true });
    const toPlayer = await needsStrokesNoteFor(t.eventId, false);
    expect(toPlayer?.link).toBe(false);
    expect(toPlayer?.text).toContain("Until the organizer gives them strokes");
  });
});

describe("Give: the band's write", () => {
  it("stores the round's figure once, whole, on the round — never as the player's index — and every surface clears", async () => {
    const t = await makeEvent("given", ["net", "net", "gross"]);
    const before = await prisma.player.findUniqueOrThrow({ where: { id: t.nox }, select: { handicap: true, handicapSource: true } });

    await as("assistant", t.eventId);
    expect(await setRoundHandicapOverride(t.stages[0], t.nox, 18)).toEqual({ ok: true });
    const rest = await applyRoundHandicapToRest(t.stages[0], t.nox);
    expect(rest.ok).toBe(true);
    expect(rest.written).toBe(2);

    // Once per round, whole strokes, on the round.
    const rows = await prisma.roundHandicap.findMany({ where: { eventId: t.eventId, playerId: t.nox }, select: { stageId: true, override: true, frozen: true } });
    expect(rows.filter((r) => r.stageId === t.stages[0])).toEqual([{ stageId: t.stages[0], override: 18, frozen: null }]);
    expect(new Map(rows.map((r) => [r.stageId, r.override]))).toEqual(new Map([[t.stages[0], 18], [t.stages[1], 18], [t.stages[2], 18]]));
    expect(rows.every((r) => Number.isInteger(r.override))).toBe(true);
    // Never an index: the roster still says no index, and nobody else's row was touched.
    expect(await prisma.player.findUniqueOrThrow({ where: { id: t.nox }, select: { handicap: true, handicapSource: true } })).toEqual(before);
    expect(await prisma.roundHandicap.count({ where: { eventId: t.eventId, playerId: t.indexed } })).toBe(0);

    // Priced by the Rule, by a route the code does not take: 18 strokes at 95% is 1710 hundredths, 17.10,
    // rounded once (Rules of Handicapping 6.2a, Appendix C): 17. No par strokes on one set of tees.
    const r1 = (await roundHandicapsFor(t.eventId, t.stages[0])).find((v) => v.playerId === t.nox)!;
    expect([r1.source, r1.handicap, r1.allowance, r1.playing]).toEqual(["override", 18, 95, 17]);

    // Every surface clears.
    expect(await playersNeedingFigure(t.eventId)).toEqual([]);
    expect((await launchCheckFor(t.eventId)).warnings.some((w) => w.says.includes("no handicap index"))).toBe(false);
    expect(await needsStrokesNoteFor(t.eventId, true)).toBeNull();
  });

  it("a figure typed with a decimal is stored whole (the band refuses it before the press; the server rounds)", async () => {
    const t = await makeEvent("whole", ["net"]);
    await as("admin", t.eventId);
    expect(await setRoundHandicapOverride(t.stages[0], t.nox, 12.4)).toEqual({ ok: true });
    expect((await prisma.roundHandicap.findFirstOrThrow({ where: { stageId: t.stages[0], playerId: t.nox } })).override).toBe(12);
  });

  it("is staff only: a player's call is refused and nothing is written", async () => {
    const t = await makeEvent("stranger", ["net"]);
    await as("player", t.eventId);
    await expect(setRoundHandicapOverride(t.stages[0], t.nox, 18)).rejects.toThrow(/Organizer access required/);
    await expect(applyRoundHandicapToRest(t.stages[0], t.nox)).rejects.toThrow(/Organizer access required/);
    expect(await prisma.roundHandicap.count({ where: { eventId: t.eventId } })).toBe(0);
    expect((await playersNeedingFigure(t.eventId)).map((r) => r.players.map((p) => p.id))).toEqual([[t.nox]]);
  });
});

describe("on rated tees whose Course Rating is not par, the words stay true", () => {
  /**
   * The chain converts the stored index 0 through the tees like any index (Rules of Handicapping 6.1):
   * Course Handicap = index × Slope / 113 + (Course Rating − par). Worked here in TENTHS, by a route the code
   * does not take: index 0 → 0 + (734 − 710) = 24 tenths = 2.4 → 2 whole. At 95%: 24 × 95 = 2280
   * thousandths = 2.28 → 2. So the player is scored off 2, not "off 0" — the words PR A first shipped
   * (review of #1144) were false here; "a scratch golfer (handicap index 0)" is true.
   */
  it("a player with no index plays off Course Rating minus par, and the warning says scratch golfer (index 0), never off 0", async () => {
    const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 4];
    expect(PARS.reduce((a, b) => a + b, 0)).toBe(71);
    const course = await prisma.course.create({
      data: { organizationId: orgId, name: `${TAG} rated links`, pars: JSON.stringify(PARS), yards: JSON.stringify(new Array(18).fill(400)), strokeIndex: JSON.stringify(PARS.map((_, i) => i + 1)) },
    });
    const tee = await prisma.tee.create({ data: { courseId: course.id, name: `${TAG} white`, courseRating: 73.4, slopeRating: 125, par: 71, position: 0 } });
    const t = await makeEvent("rated", ["net"]);
    await prisma.event.update({ where: { id: t.eventId }, data: { courseId: course.id, defaultTeeId: tee.id, customPars: JSON.stringify(PARS) } });
    await prisma.stage.update({ where: { id: t.stages[0] }, data: { courseId: course.id, teeId: tee.id } });

    const nox = (await roundHandicapsFor(t.eventId, t.stages[0])).find((v) => v.playerId === t.nox)!;
    expect([nox.handicap, nox.allowance, nox.playing], "index 0 off 73.4/125, par 71, at 95%").toEqual([2, 95, 2]);

    const says = (await launchCheckFor(t.eventId)).warnings[0]?.says ?? "";
    expect(says).toBe("1 player has no handicap index and Round 1 is scored net. Until you give them strokes they are scored as a scratch golfer (handicap index 0).");
    expect(says).not.toContain("off 0");
  });
});

describe("frozen at the scratch figure by the round's first card: still named, and corrected by staff with a reason", () => {
  async function cardIn(eventId: string, stageId: string, playerId: string) {
    await prisma.scorecard.create({ data: { eventId, stageId, playerId, strokes: JSON.stringify(new Array(18).fill(5)), status: "entered" } });
    await freezeRoundHandicaps(eventId, stageId);
  }

  it("stays on the list and on What's next; Give is refused; the correction sets that one row, keeps the reason, and clears them", async () => {
    const t = await makeEvent("frozen", ["net"]);
    await cardIn(t.eventId, t.stages[0], t.indexed);
    const ilsaBefore = await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId: t.stages[0], playerId: t.indexed } } });

    // Named, as a correction rather than a Give.
    const list = await playersNeedingFigure(t.eventId);
    expect(list.map((r) => [r.label, r.players.map((p) => p.id), r.scratch.map((p) => p.id)])).toEqual([["Round 1", [], [t.nox]]]);
    await as("admin", t.eventId);
    const line = (await secretaryHomeFor((await getSession())!)).jobs.find((j) => j.eventId === t.eventId && j.key === "strokes");
    expect([line?.text, line?.action]).toEqual(["1 player with no handicap index is scored as a scratch golfer (handicap index 0) in Round 1", "Correct the strokes"]);

    // Give cannot reach a round with a card in.
    expect((await setRoundHandicapOverride(t.stages[0], t.nox, 14)).ok).toBe(false);

    // Refused: no reason, a decimal, a string, a player with an index. Nothing written by any of them.
    expect(await correctRoundStrokes(t.stages[0], t.nox, 14, "  ")).toEqual({ ok: false, error: CORRECTION_NEEDS_REASON });
    expect(await correctRoundStrokes(t.stages[0], t.nox, 12.4, "card")).toEqual({ ok: false, error: BAND_REFUSAL });
    expect(await correctRoundStrokes(t.stages[0], t.nox, "14", "card")).toEqual({ ok: false, error: BAND_REFUSAL });
    expect((await correctRoundStrokes(t.stages[0], t.indexed, 14, "card")).ok).toBe(false);
    expect((await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId: t.stages[0], playerId: t.nox } } })).override).toBeNull();

    // As a player: refused by the gate.
    await as("player", t.eventId);
    await expect(correctRoundStrokes(t.stages[0], t.nox, 14, "card")).rejects.toThrow(/Organizer access required/);

    // As an assistant organizer, with a reason.
    await as("assistant", t.eventId);
    const before = (await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId: t.stages[0], playerId: t.nox } } })).frozen;
    expect(await correctRoundStrokes(t.stages[0], t.nox, 14, "Handicap card shown at the desk")).toEqual({ ok: true });
    const row = await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId: t.stages[0], playerId: t.nox } } });
    expect([row.override, row.frozen, row.frozenExact]).toEqual([14, 14, null]);
    // Nobody else's row moved, and the roster still says no index.
    expect(await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId: t.stages[0], playerId: t.indexed } } })).toEqual(ilsaBefore);
    expect(await prisma.player.findUniqueOrThrow({ where: { id: t.nox }, select: { handicap: true, handicapSource: true } })).toEqual({ handicap: 0, handicapSource: "none" });
    const audit = await prisma.auditLog.findFirst({ where: { eventId: t.eventId, action: "strokes-corrected" } });
    expect(audit?.detail).toBe(`Strokes corrected for ${TAG} Noindex Okello (no handicap index) in Round 1: ${before} to 14, the committee's figure. Reason: Handicap card shown at the desk`);

    // Priced by the Rule from the corrected figure: 14 × 95 = 1330 hundredths, 13.30 → 13.
    const v = (await roundHandicapsFor(t.eventId, t.stages[0])).find((x) => x.playerId === t.nox)!;
    expect([v.source, v.handicap, v.playing]).toEqual(["frozen", 14, 13]);
    expect(await playersNeedingFigure(t.eventId)).toEqual([]);
  });

  it("a stroke card's net follows the correction on the next read: 90 gross, off 0 → net 90; given 14 at 95% (13.30 → 13) → net 77", async () => {
    const t = await makeEvent("reprice", ["net"]);
    // A card to score against: par 72 and a stroke index, so the net is worked hole by hole.
    await prisma.event.update({
      where: { id: t.eventId },
      data: { customPars: JSON.stringify(new Array(18).fill(4)), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)) },
    });
    await prisma.scorecard.create({ data: { eventId: t.eventId, stageId: t.stages[0], playerId: t.nox, strokes: JSON.stringify(new Array(18).fill(5)), status: "entered" } });
    await cardIn(t.eventId, t.stages[0], t.indexed);
    const netOf = async () => (await loadEventState(t.eventId))!.strokeStandings.find((s) => s.player.id === t.nox)?.net;
    expect(await netOf(), "unrated tees: index 0 plays off 0").toBe(90);
    await as("admin", t.eventId);
    expect(await correctRoundStrokes(t.stages[0], t.nox, 14, "Card shown at the desk")).toEqual({ ok: true });
    expect(await netOf()).toBe(90 - 13);
  });

  it("is refused while the player has a match result stored in the round, naming the match and the way on", async () => {
    const t = await makeEvent("matched", ["net"]);
    const group = await prisma.group.create({ data: { eventId: t.eventId, name: `${TAG} match group`, position: 0 } });
    await prisma.match.create({
      data: { eventId: t.eventId, stageId: t.stages[0], groupId: group.id, round: 1, playerAId: t.nox, playerBId: t.indexed, holes: JSON.stringify(["A", "B", "H", ...new Array(15).fill(null)]) },
    });
    await cardIn(t.eventId, t.stages[0], t.indexed);
    await as("admin", t.eventId);
    expect(await correctRoundStrokes(t.stages[0], t.nox, 14, "card")).toEqual({
      ok: false,
      error: correctionMatchSaid(`${TAG} Noindex Okello`, "Round 1", `${TAG} Indexed Ilsa`),
    });
    const row = await prisma.roundHandicap.findUnique({ where: { stageId_playerId: { stageId: t.stages[0], playerId: t.nox } } });
    expect(row?.override ?? null).toBeNull();
  });

  it("is refused on a closed round: its results stand", async () => {
    const t = await makeEvent("closed", ["net"]);
    await cardIn(t.eventId, t.stages[0], t.indexed);
    await prisma.stage.update({ where: { id: t.stages[0] }, data: { closedAt: new Date() } });
    await as("admin", t.eventId);
    expect(await correctRoundStrokes(t.stages[0], t.nox, 14, "card")).toEqual({ ok: false, error: correctionClosedSaid("Round 1") });
    expect(await prisma.auditLog.count({ where: { eventId: t.eventId, action: "strokes-corrected" } })).toBe(0);
  });

  /**
   * A LATE ENTRANT ON TEES OF A HIGHER PAR (Rule 6.2b; re-review R3). Field on par 71 (71.0/113) and the
   * late entrant on par 72 (72.0/113): the field's lowest par is 71, so he receives 1 stroke for the par,
   * after the allowance and with none taken of it. By the Rule, not the code: 14 × 95 = 1330 hundredths,
   * 13.30 → 13; plus 1 → 14. Without the par strokes kept on the row he would play off 13 for ever.
   */
  it("a late entrant on higher-par tees keeps the difference: 14 at 95% → 13, + 1 for the par → 14", async () => {
    const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 4];
    const course = await prisma.course.create({
      data: { organizationId: orgId, name: `${TAG} two pars`, pars: JSON.stringify(PARS), yards: JSON.stringify(new Array(18).fill(400)), strokeIndex: JSON.stringify(PARS.map((_, i) => i + 1)) },
    });
    const yellow = await prisma.tee.create({ data: { courseId: course.id, name: `${TAG} yellow`, courseRating: 71, slopeRating: 113, par: 71, position: 0 } });
    const red = await prisma.tee.create({ data: { courseId: course.id, name: `${TAG} red`, courseRating: 72, slopeRating: 113, par: 72, position: 1 } });
    const t = await makeEvent("higher-par", ["net"]);
    await prisma.event.update({ where: { id: t.eventId }, data: { courseId: course.id, defaultTeeId: yellow.id, teePolicy: "own", customPars: JSON.stringify(PARS) } });
    await prisma.stage.update({ where: { id: t.stages[0] }, data: { courseId: course.id } });
    // The field is frozen at the first card; then the late entrant arrives, on the reds, with no index.
    await prisma.player.delete({ where: { id: t.nox } });
    await cardIn(t.eventId, t.stages[0], t.indexed);
    const late = await prisma.player.create({
      data: { eventId: t.eventId, name: `${TAG} Late Lorna`, email: at("lorna"), handicap: 0, handicapSource: "none", seed: 3, status: "confirmed", teeId: red.id },
    });
    const listed = await playersNeedingFigure(t.eventId);
    expect(listed.map((r) => [r.players.map((p) => p.id), r.scratch.map((p) => p.id)]), "a card is in: a correction, not a Give").toEqual([[[], [late.id]]]);
    expect((await roundHandicapsFor(t.eventId, t.stages[0])).find((v) => v.playerId === late.id)?.parStrokes, "the field gives her 1 for the par").toBe(1);

    await as("admin", t.eventId);
    expect(await correctRoundStrokes(t.stages[0], late.id, 14, "Late entry, card shown")).toEqual({ ok: true });
    const row = await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId: t.stages[0], playerId: late.id } } });
    expect([row.frozen, row.frozenParStrokes]).toEqual([14, 1]);
    const v = (await roundHandicapsFor(t.eventId, t.stages[0])).find((x) => x.playerId === late.id)!;
    expect([v.handicap, v.allowance, v.parStrokes, v.playing]).toEqual([14, 95, 1, 14]);
  });

  it("is refused once results are released", async () => {
    const t = await makeEvent("released", ["net"]);
    await cardIn(t.eventId, t.stages[0], t.indexed);
    await prisma.event.update({ where: { id: t.eventId }, data: { status: "completed" } });
    await as("admin", t.eventId);
    const done = await correctRoundStrokes(t.stages[0], t.nox, 14, "late");
    expect(done.ok).toBe(false);
    expect(await prisma.auditLog.count({ where: { eventId: t.eventId, action: "strokes-corrected" } })).toBe(0);
  });
});

describe("a gross-only tournament asks nothing", () => {
  it("no list, no launch warning, no What's next line, no note", async () => {
    const t = await makeEvent("gross", ["gross", "gross"]);
    expect(await playersNeedingFigure(t.eventId)).toEqual([]);
    expect((await launchCheckFor(t.eventId)).warnings.some((w) => w.says.includes("no handicap index"))).toBe(false);
    await as("admin", t.eventId);
    const home = await secretaryHomeFor((await getSession())!);
    expect(home.jobs.filter((j) => j.eventId === t.eventId && j.key === "strokes")).toEqual([]);
    expect(await needsStrokesNoteFor(t.eventId, true)).toBeNull();
  });
});
