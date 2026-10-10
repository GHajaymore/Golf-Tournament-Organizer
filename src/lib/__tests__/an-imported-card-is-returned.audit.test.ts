import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * AN IMPORTED CARD IS A RETURNED CARD (2026-10-10).
 *
 * Rule 3.3b: the player returns the signed card; the committee records it. A
 * secretary importing a league night's cards is that record, so a finished
 * card arrives returned (certified) — and the committee's one-click
 * acceptance, which takes only returned cards, takes the night. It arrived
 * "entered", which on a 120-player league left 119 "Approve anyway" clicks and
 * a round that never read ready to close.
 *
 * And a file that changes an ACCEPTED card sends it back to returned: the
 * strokes were overwritten under "approved", so a result moved unseen.
 *
 * Controls: an unfinished card stays entered; a disputed card keeps its
 * dispute; re-importing an accepted card unchanged leaves it accepted.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-IMPORTRETURNED";
const PARS = new Array(18).fill(4);

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { importScores } = await import("@/app/actions/tournament");

let eventId = "";
let stageId = "";
const p: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id, name: `${TAG} league`, status: "live", shape: "series", dates: "", course: "",
        city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}`,
        customPars: JSON.stringify(PARS), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
  for (const [i, who] of ["new", "short", "accepted", "changed", "disputed"].entries()) {
    p[who] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`.toLowerCase(), status: "confirmed", seed: i },
      })
    ).id;
  }
  session = { eventId, email: `${TAG}-staff@example.invalid`.toLowerCase(), viewRole: "admin", name: "Sec", role: "admin", userId: "", accountId: "" };
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { stageId } });
  const json = JSON.stringify(PARS);
  for (const [who, status] of [["accepted", "approved"], ["changed", "approved"], ["disputed", "disputed"]] as const) {
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: p[who], strokes: json, status } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const statuses = async () =>
  Object.fromEntries(
    (await prisma.scorecard.findMany({ where: { stageId }, select: { playerId: true, status: true, certifiedBy: true } })).map((c) => [
      Object.keys(p).find((k) => p[k] === c.playerId),
      [c.status, c.certifiedBy],
    ]),
  );

describe("a file of a night's cards", () => {
  it("brings a finished card in returned, by whoever imported it", async () => {
    await importScores(stageId, "strokes", [{ playerId: p.new, strokes: PARS }]);
    expect((await statuses()).new).toEqual(["certified", "Sec (from a file)"]);
  });

  it("sends a CHANGED accepted card back to returned", async () => {
    await importScores(stageId, "strokes", [{ playerId: p.changed, strokes: PARS.map((s, i) => (i === 0 ? 5 : s)) }]);
    expect((await statuses()).changed[0]).toBe("certified");
  });

  it("CONTROL: leaves an unfinished card entered, a dispute disputed, an unchanged acceptance accepted", async () => {
    await importScores(stageId, "strokes", [
      { playerId: p.short, strokes: PARS.slice(0, 9) },
      { playerId: p.disputed, strokes: PARS.map((s, i) => (i === 0 ? 6 : s)) },
      { playerId: p.accepted, strokes: PARS },
    ]);
    const s = await statuses();
    expect([s.short[0], s.disputed[0], s.accepted[0]]).toEqual(["entered", "disputed", "approved"]);
  });
});
