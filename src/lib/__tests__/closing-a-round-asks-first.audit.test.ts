import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * CLOSING A ROUND WITH CARDS OUTSTANDING — the Tournament Director's ruling
 * (proposal 3 Nov, panel 8.1 Q4), shipped in the state machine's PR 4.
 *
 * `setRoundClosed` checked only the cut (F4): any other round closed over a
 * card nobody had signed and over one somebody had disputed, and the board then
 * read Final. Now, against real rows:
 *
 *   a disputed card or match result   REFUSED until the committee rules on it
 *                                      (Rule 20.1c(3), Rule 20.2b) — even when
 *                                      the caller says it has asked
 *   a card not signed off             ASKED, naming whose (Rule 3.3b(2)); a
 *                                      caller that did not ask is answered with
 *                                      the question, as completing answers
 *                                      `confirmUnplayed`
 *   a withdrawn player's card          nobody's result: not asked about (the
 *                                      field is the confirmed field, as the
 *                                      cut's refusal reads it)
 *   re-opening                         never asks
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLOSE-ROUND";
const session = { email: `${TAG}.sec@example.invalid`.toLowerCase(), name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setRoundClosed } = await import("@/app/actions/tournament");

const ids = { org: "", event: "", r1: "", r2: "", ines: "", bram: "", suki: "", cardBram: "", match: "" };
const card = (strokes: number) => JSON.stringify(new Array(18).fill(strokes));
const closedAt = async (stageId: string) => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).closedAt;

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  ids.org = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
  const event = await prisma.event.create({
    data: {
      organizationId: ids.org, name: `${TAG} medal`, status: "live", dates: "Saturday", course: "Home", city: "", address: "",
      regDeadline: "", shareToken: `${TAG}-${process.pid}`, configUnlocked: false,
      // The committee accepts cards (the default): only an approved card is final.
      scoreApproval: "staff",
    },
  });
  ids.event = event.id;
  session.eventId = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: session.email, name: session.name, role: "admin" } });
  ids.r1 = (await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
  ids.r2 = (await prisma.stage.create({ data: { eventId: event.id, position: 1, type: "Single Match Stage", format: "Match Play", holes: 18 } })).id;
  const person = async (name: string, i: number, status = "confirmed") =>
    (await prisma.player.create({ data: { eventId: event.id, name: `Zz ${name}`, email: `${TAG}.${i}@example.invalid`.toLowerCase(), seed: i + 1, handicap: 10, status } })).id;
  ids.ines = await person("Ines Corvo", 0);
  ids.bram = await person("Bram Ellery", 1);
  // Withdrawn, with a card still on the record that nobody signed.
  ids.suki = await person("Suki Thorne", 2, "withdrawn");
  await prisma.scorecard.create({ data: { eventId: event.id, stageId: ids.r1, playerId: ids.ines, strokes: card(4), status: "approved", approvedBy: "zz", approvedAt: new Date() } });
  ids.cardBram = (await prisma.scorecard.create({ data: { eventId: event.id, stageId: ids.r1, playerId: ids.bram, strokes: card(5), status: "entered" } })).id;
  await prisma.scorecard.create({ data: { eventId: event.id, stageId: ids.r1, playerId: ids.suki, strokes: card(6), status: "entered" } });
  const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: ids.r2, groupId: group.id, round: 1, playerAId: ids.ines, playerBId: ids.bram, holes: JSON.stringify(["A", ...new Array(17).fill(null)]), scoreStatus: "disputed" },
    })
  ).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("closing a round asks over an unsigned card and refuses over a disputed one", () => {
  it("ASKS, naming whose card — the withdrawn player's is nobody's result and is not named", async () => {
    expect(await setRoundClosed(ids.r1, true)).toEqual({
      ok: false,
      needsUnsignedConfirm: true,
      error: "Zz Bram Ellery’s card is not signed off yet. Close Round 1 anyway? It counts once it is signed.",
    });
    expect(await closedAt(ids.r1), "asked, and closed anyway").toBeNull();
  });

  it("REFUSES over a disputed card, even from a caller that says it asked", async () => {
    await prisma.scorecard.update({ where: { id: ids.cardBram }, data: { status: "disputed" } });
    const words = "1 result in Round 1 is disputed, so it can’t be closed yet. Settle it on Score entry, then close the round.";
    expect(await setRoundClosed(ids.r1, true)).toEqual({ ok: false, error: words });
    expect(await setRoundClosed(ids.r1, true, true)).toEqual({ ok: false, error: words });
    expect(await closedAt(ids.r1)).toBeNull();
  });

  it("REFUSES over a disputed match result too", async () => {
    const res = await setRoundClosed(ids.r2, true, true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^1 result in Round 2 is disputed/);
    expect(await closedAt(ids.r2)).toBeNull();
  });

  it("closes once asked and answered, and re-opening never asks", async () => {
    await prisma.scorecard.update({ where: { id: ids.cardBram }, data: { status: "entered" } });
    expect(await setRoundClosed(ids.r1, true, true)).toEqual({ ok: true });
    expect(await closedAt(ids.r1), "Close anyway did not close it").not.toBeNull();
    const logged = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "round-closed" }, orderBy: { createdAt: "desc" } });
    expect(logged?.detail).toMatch(/^Closed Round 1\./);
    expect(await setRoundClosed(ids.r1, false)).toEqual({ ok: true });
    expect(await closedAt(ids.r1)).toBeNull();
  });

  it("CONTROL: every card final and nothing disputed — it closes on the first press", async () => {
    await prisma.scorecard.update({ where: { id: ids.cardBram }, data: { status: "approved", approvedBy: "zz", approvedAt: new Date() } });
    expect(await setRoundClosed(ids.r1, true)).toEqual({ ok: true });
    expect(await closedAt(ids.r1)).not.toBeNull();
  });
});
