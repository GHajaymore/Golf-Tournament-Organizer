import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND THE COMMITTEE HAS CLOSED IS CLOSED (2026-10-08).
 *
 * Walked as the tournament grid's 36-hole aggregate, both rounds closed, as a
 * player with no round-2 card. The board was right — "Not ranked · didn't play
 * Round 2" — and that player's Today read "YOUR CARD · FINAL · START MY CARD ·
 * 2 of 3 cards in — these standings will change". Nothing stopped them saving
 * a card, which would have put them back on the board over the committee's
 * close. Now:
 *
 *   - a PLAYER's card on a closed round is refused, on the server;
 *   - STAFF can still write one — the committee corrects, or reopens;
 *   - Today says the round is closed instead of offering a card.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLOSEDROUND";
const PARS = new Array(18).fill(4);

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveScorecard } = await import("@/app/actions/tournament");
const { loadEventState } = await import("@/lib/services/tournament");
const { meFor } = await import("@/lib/services/me");

let eventId = "";
let r2 = "";
let cat = "";
let annId = "";
const catEmail = `${TAG}.cat@example.invalid`.toLowerCase();
const staffEmail = `${TAG}.staff@example.invalid`.toLowerCase();

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} aggregate`,
      status: "live",
      shape: "series",
      scoreEntryBy: "players",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  const r1 = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, closedAt: new Date() },
  });
  const round2 = await prisma.stage.create({
    data: { eventId, position: 1, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18 },
  });
  r2 = round2.id;
  const p = await prisma.player.create({
    data: { eventId, name: `${TAG} Cat`, email: catEmail, seed: 1, status: "confirmed" },
  });
  cat = p.id;
  await prisma.scorecard.create({ data: { eventId, stageId: r1.id, playerId: cat, strokes: JSON.stringify(PARS), status: "approved" } });
  // Somebody who DID play round 2, so it is the round the tournament is on —
  // the state that was walked. Without it round 1 is the latest with results.
  const ann = await prisma.player.create({
    data: { eventId, name: `${TAG} Ann`, email: `${TAG}.ann@example.invalid`.toLowerCase(), seed: 2, status: "confirmed" },
  });
  annId = ann.id;
  await prisma.scorecard.create({ data: { eventId, stageId: r1.id, playerId: ann.id, strokes: JSON.stringify(PARS), status: "approved" } });
  await prisma.account.create({ data: { eventId, name: "zz staff", email: staffEmail, role: "admin" } });
  await prisma.account.create({ data: { eventId, name: "zz cat", email: catEmail, role: "player" } });
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { stageId: r2 } });
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: annId, strokes: JSON.stringify(PARS), status: "approved" } });
  await prisma.stage.update({ where: { id: r2 }, data: { closedAt: null } });
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

const asPlayer = () => {
  session = { eventId, email: catEmail, viewRole: "player", name: "zz cat", role: "player", userId: "zz", accountId: "" };
};
const asStaff = () => {
  session = { eventId, email: staffEmail, viewRole: "admin", name: "zz staff", role: "admin", userId: "zz", accountId: "" };
};

describe("a player's card", () => {
  it("is taken on an open round — the control", async () => {
    asPlayer();
    const res = await saveScorecard(r2, cat, PARS);
    expect(res.ok).toBe(true);
  });

  it("is refused once the committee has closed the round", async () => {
    await prisma.stage.update({ where: { id: r2 }, data: { closedAt: new Date() } });
    asPlayer();
    await expect(saveScorecard(r2, cat, PARS)).rejects.toThrow(/closed this round/);
    expect(await prisma.scorecard.count({ where: { stageId: r2, playerId: cat } })).toBe(0);
  });

  it("is still the committee's to write on a closed round", async () => {
    await prisma.stage.update({ where: { id: r2 }, data: { closedAt: new Date() } });
    asStaff();
    const res = await saveScorecard(r2, cat, PARS);
    expect(res.ok).toBe(true);
  });
});

describe("Today, for a closed round with nothing of yours on it", () => {
  it("names the closed round and offers no card", async () => {
    await prisma.stage.update({ where: { id: r2 }, data: { closedAt: new Date() } });
    const me = await meFor((await loadEventState(eventId))!, catEmail);
    expect(me.round?.stageId).toBe(r2);
    expect(me.round?.closedWithout).toMatch(/Round 2/);
    expect(me.round?.ownCard).toBe(false);
  });

  it("is an ordinary card while the round is open — the control", async () => {
    const me = await meFor((await loadEventState(eventId))!, catEmail);
    expect(me.round?.closedWithout).toBe("");
    expect(me.round?.ownCard).toBe(true);
  });
});
