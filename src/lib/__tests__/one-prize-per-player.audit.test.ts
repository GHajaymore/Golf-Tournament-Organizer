import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ONE PRIZE PER PLAYER, THROUGH THE REAL ACTIONS (Ajay, 2026-10-21, C1).
 *
 * The rule is kept where an award is SAVED (`setPrizeWinner`), so a screen that
 * forgets to draw the picker's marks cannot hand anybody a second placing
 * prize. Against real rows, because "what this player already holds" is a
 * query over the prize table and the rule is only as good as that query.
 *
 *   the refusal, and its words         — Best net to the Best gross winner
 *   the exemption                      — nearest the pin to the same player
 *   re-awarding and clearing           — never refused
 *   the box off                        — CONTROL: two placing prizes allowed
 *   the tick while a clash exists      — refused, naming who and what; nothing changes
 *   a line switched to counting        — refused where it would make a clash
 *
 * Invented names, `@example.invalid` addresses, a throwaway club; deleted in a
 * `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-one-prize";
const EMAIL = `${TAG}.sec@example.invalid`;
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("server-only", () => ({}));

const { setPrizeWinner, setOnePrizePerPlayer, setPrizeCounts, applyPrizeStructure } = await import("@/app/actions/tournament");

let eventId = "";
const ids = { ann: "", bea: "", gross: "", net: "", pin: "", winner: "" };

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: { organizationId: org.id, name: `${TAG} medal`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}-${Date.now()}` },
    })
  ).id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  ids.ann = (await prisma.player.create({ data: { eventId, name: "Ann Example", email: `${TAG}.ann@example.invalid`, status: "confirmed", seed: 1 } })).id;
  ids.bea = (await prisma.player.create({ data: { eventId, name: "Bea Example", email: `${TAG}.bea@example.invalid`, status: "confirmed", seed: 2 } })).id;
  // The lines as a club starts them: the structures, through the real action.
  expect((await applyPrizeStructure("gross-net")).ok).toBe(true);
  expect((await applyPrizeStructure("specials")).ok).toBe(true);
  expect((await applyPrizeStructure("overall-top-3")).ok).toBe(true);
  const rows = await prisma.prize.findMany({ where: { eventId }, select: { id: true, category: true } });
  const by = (c: string) => rows.find((r) => r.category === c)!.id;
  ids.gross = by("Best gross");
  ids.net = by("Best net");
  ids.pin = by("Nearest the pin");
  ids.winner = by("Winner");
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const winnerOf = async (prizeId: string) => (await prisma.prize.findUnique({ where: { id: prizeId }, select: { winnerId: true } }))?.winnerId ?? null;
const ruleOn = async () => (await prisma.event.findUnique({ where: { id: eventId }, select: { onePrizePerPlayer: true } }))?.onePrizePerPlayer;
async function clearAll() {
  await prisma.prize.updateMany({ where: { eventId }, data: { winnerId: null } });
}

describe("one prize per player, where the award is saved", () => {
  it("is off for a new tournament, and the structures mark their skill lines as not counting", async () => {
    expect(await ruleOn()).toBe(false);
    const counts = await prisma.prize.findMany({ where: { eventId }, select: { category: true, countsForOnePrize: true }, orderBy: { position: "asc" } });
    expect(counts.filter((c) => !c.countsForOnePrize).map((c) => c.category)).toEqual(["Nearest the pin", "Longest drive"]);
  });

  it("CONTROL: with the box off, one player may take Best gross and Best net", async () => {
    await clearAll();
    expect(await setPrizeWinner(ids.gross, ids.ann)).toEqual({ ok: true });
    expect(await setPrizeWinner(ids.net, ids.ann)).toEqual({ ok: true });
    expect(await winnerOf(ids.net)).toBe(ids.ann);
  });

  it("refuses the tick while somebody holds two counting prizes, naming them, and changes nothing", async () => {
    // Ann still holds Best gross and Best net from the control above.
    const res = await setOnePrizePerPlayer(true);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Ann Example has Best gross and Best net. Clear one of them before giving one prize per player.");
    expect(await ruleOn()).toBe(false);
    expect(await winnerOf(ids.gross)).toBe(ids.ann);
    expect(await winnerOf(ids.net)).toBe(ids.ann);
  });

  it("takes the tick once the clash is cleared", async () => {
    expect(await setPrizeWinner(ids.net, "")).toEqual({ ok: true });
    expect(await setOnePrizePerPlayer(true)).toEqual({ ok: true });
    expect(await ruleOn()).toBe(true);
  });

  it("refuses Best net to the Best gross winner, in words, and stores nothing", async () => {
    const res = await setPrizeWinner(ids.net, ids.ann);
    expect(res.ok).toBe(false);
    expect(res.choose).toBe(true);
    expect(res.error).toBe("Ann Example already has Best gross. This tournament gives one prize per player — choose the next player.");
    expect(await winnerOf(ids.net)).toBeNull();
    // And the next player takes it.
    expect(await setPrizeWinner(ids.net, ids.bea)).toEqual({ ok: true });
    expect(await winnerOf(ids.net)).toBe(ids.bea);
  });

  it("refuses the overall Winner to either of them too — a placing is a placing", async () => {
    const res = await setPrizeWinner(ids.winner, ids.bea);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Bea Example already has Best net.");
  });

  it("lets the Best gross winner take nearest the pin as well — a skill prize does not count", async () => {
    expect(await setPrizeWinner(ids.pin, ids.ann)).toEqual({ ok: true });
    expect(await winnerOf(ids.pin)).toBe(ids.ann);
  });

  it("does not refuse re-awarding a prize to its own winner, or clearing one", async () => {
    expect(await setPrizeWinner(ids.gross, ids.ann)).toEqual({ ok: true });
    expect(await setPrizeWinner(ids.gross, "")).toEqual({ ok: true });
    expect(await setPrizeWinner(ids.gross, ids.ann)).toEqual({ ok: true });
  });

  it("refuses switching a line to counting where its winner already holds a counting prize", async () => {
    // Ann holds Best gross (counts) and nearest the pin (does not).
    const res = await setPrizeCounts(ids.pin, true);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Ann Example already has Best gross, so Nearest the pin can't count as well. Clear one of the two awards first.");
    expect((await prisma.prize.findUnique({ where: { id: ids.pin } }))?.countsForOnePrize).toBe(false);
    // CONTROL: a line with no winner switches freely, both ways.
    expect(await setPrizeCounts(ids.winner, false)).toEqual({ ok: true });
    expect(await setPrizeCounts(ids.winner, true)).toEqual({ ok: true });
  });

  it("the final report names each placing winner once, and the skill prize beside it", async () => {
    const { reportFor } = await import("@/lib/services/event-report");
    const report = await reportFor(eventId);
    expect(report?.kind).toBe("event");
    const prizes = report?.kind === "event" ? report.report.prizes : [];
    expect(prizes).toEqual([
      { what: "Best gross", winners: ["Ann Example"] },
      { what: "Best net", winners: ["Bea Example"] },
      { what: "Nearest the pin", winners: ["Ann Example"] },
    ]);
  });

  it("unticking is never refused, and then the second prize is allowed again", async () => {
    expect(await setOnePrizePerPlayer(false)).toEqual({ ok: true });
    expect(await setPrizeWinner(ids.winner, ids.ann)).toEqual({ ok: true });
  });

  it("refuses a prize of another tournament, whatever the rule", async () => {
    const res = await setPrizeWinner("not-a-prize-of-this-event", ids.ann);
    expect(res).toEqual({ ok: false, error: "That prize isn't in this tournament." });
  });
});
