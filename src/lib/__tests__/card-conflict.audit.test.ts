import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A card that was written while somebody was offline must not silently win.
 *
 * A scorecard is written WHOLE. Now that scoring survives a dead spot, a card
 * can be minutes old when it finally reaches the server — and replaying it
 * replaces everything stored, including a correction the committee made in
 * between. Nobody would see it happen: the write succeeds, the screen looks
 * right, and the corrected hole is simply gone.
 *
 * Tested against real rows because the whole mechanism is a comparison between
 * what a caller read and what the database now holds. A mocked Prisma would be
 * asserting that my own stub disagrees with itself.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CONFLICT";

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveScorecard } = await import("@/app/actions/tournament");
const { cardRevision } = await import("@/lib/domain/pending-card");

let eventId = "";
let stageId = "";
let playerId = "";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;
  const p = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} scorer`,
      email: `${TAG}.scorer@example.invalid`.toLowerCase(),
      seed: 1,
      status: "confirmed",
    },
  });
  playerId = p.id;
});

/** The card as the committee holds it, and the revision a phone read. */
async function given(strokes: (number | null)[]) {
  await prisma.scorecard.deleteMany({ where: { stageId, playerId } });
  await prisma.scorecard.create({
    data: { eventId, stageId, playerId, strokes: JSON.stringify(strokes), status: "entered" },
  });
  return cardRevision(strokes);
}

const stored = async () =>
  JSON.parse(
    (await prisma.scorecard.findFirst({ where: { stageId, playerId }, select: { strokes: true } }))!
      .strokes,
  ) as (number | null)[];

beforeEach(() => {
  session = {
    eventId,
    email: `${TAG}.staff@example.invalid`,
    viewRole: "admin",
    name: "Staff",
    role: "admin",
  };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a queued card that would land on somebody else's change", () => {
  it("is refused, and the stored card is left exactly as it was", async () => {
    /**
     * THE FAILURE THIS PREVENTS. The phone read the card at the turn, went out
     * of signal, and the committee corrected the 4th in the meantime. The
     * phone's card still carries the OLD 4th, so writing it whole would undo
     * their correction without anybody being told.
     */
    const readAt = await given(PARS.map((p, i) => (i < 9 ? p : null)));
    const committeeFixed = PARS.map((p, i) => (i === 3 ? 7 : i < 9 ? p : null));
    await prisma.scorecard.updateMany({
      where: { stageId, playerId },
      data: { strokes: JSON.stringify(committeeFixed) },
    });

    const mine = PARS.map((p, i) => (i < 12 ? p : null));
    const res = await saveScorecard(stageId, playerId, mine, readAt);

    expect(res.ok, "a stale card must not be written").toBe(false);
    if (res.ok) return;
    // And it comes back carrying THEIR card, because a person cannot choose
    // between two versions they have only been told about.
    expect(res.conflict.strokes[3]).toBe(7);
    expect(await stored()).toEqual(committeeFixed);
  });

  it("goes through when nobody else has touched it", async () => {
    const readAt = await given(PARS.map((p, i) => (i < 9 ? p : null)));
    const mine = PARS.map((p, i) => (i < 12 ? p : null));

    const res = await saveScorecard(stageId, playerId, mine, readAt);
    expect(res.ok).toBe(true);
    expect((await stored()).filter((s) => s != null)).toHaveLength(12);
  });

  it("hands back a revision the caller can keep saving from", async () => {
    // Otherwise every write after the first would look stale to itself and a
    // scorer would be asked to resolve a conflict with nobody.
    const readAt = await given(PARS.map((p, i) => (i < 9 ? p : null)));
    const first = await saveScorecard(stageId, playerId, PARS.map((p, i) => (i < 10 ? p : null)), readAt);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await saveScorecard(
      stageId,
      playerId,
      PARS.map((p, i) => (i < 11 ? p : null)),
      first.revision,
    );
    expect(second.ok, "the revision from a save must be usable for the next one").toBe(true);
  });

  it("does not call an identical rewrite a conflict", async () => {
    /**
     * The revision is the card's CONTENT, so a retry that already succeeded —
     * the commonest case by far once writes are queued — produces no
     * disagreement. A timestamp would stop the scorer and make them choose
     * between two identical cards.
     */
    const same = PARS.map((p, i) => (i < 9 ? p : null));
    const readAt = await given(same);
    await prisma.scorecard.updateMany({
      where: { stageId, playerId },
      data: { strokes: JSON.stringify(same) },
    });

    const res = await saveScorecard(stageId, playerId, same, readAt);
    expect(res.ok).toBe(true);
  });

  it("writes unconditionally when the caller names no revision", async () => {
    // The console's entry screen has the card in front of it. Requiring a
    // revision everywhere would have made this change break every other
    // caller, which is how a safety feature gets reverted.
    const before = PARS.map((p, i) => (i < 9 ? p : null));
    await given(before);
    await prisma.scorecard.updateMany({
      where: { stageId, playerId },
      data: { strokes: JSON.stringify(PARS.map((p, i) => (i === 3 ? 7 : i < 9 ? p : null))) },
    });

    const res = await saveScorecard(stageId, playerId, before);
    expect(res.ok).toBe(true);
    expect((await stored())[3]).toBe(PARS[3]);
  });
});
