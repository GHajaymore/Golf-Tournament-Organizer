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
 *   the launch dialog                   → one warning, first, saying what PR A does ("scored as scratch, off 0")
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
import { roundHandicapsFor } from "@/lib/services/round-handicap";
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
    expect(first?.says).toBe("1 player has no handicap index and Round 1 and Round 2 are scored net. Until you give them strokes they are scored as scratch, off 0.");
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
