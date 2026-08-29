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

/**
 * A signature survives a rewrite that changes nothing.
 *
 * `statusAfterEdit` was applied to every save without comparing the incoming
 * strokes to the stored ones, so writing back the identical eighteen numbers
 * set a card from certified to entered and blanked the signature.
 *
 * Two ways that happened for real. The console's group save loops over every
 * player in the tee group with any score and re-saves each card unchanged — so
 * marking one player's 15th silently de-certified a playing partner who signed
 * on their phone twenty minutes earlier, and `approveAll` then listed them
 * under "Not certified yet" for a card they believed they had signed. And the
 * retry queue could replay a card up to fifteen seconds after certification,
 * while the screen still read "Certified. It's with the committee now."
 */
describe("re-saving a card that has already been signed", () => {
  const signed = async (strokes: (number | null)[]) => {
    await prisma.scorecard.deleteMany({ where: { stageId, playerId } });
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId,
        strokes: JSON.stringify(strokes),
        status: "certified",
        certifiedBy: `${TAG} scorer`,
        certifiedAt: new Date(),
      },
    });
    return cardRevision(strokes);
  };

  const statusNow = async () =>
    (await prisma.scorecard.findFirstOrThrow({
      where: { stageId, playerId },
      select: { status: true, certifiedBy: true, certifiedAt: true },
    }));

  it("keeps the certification when the numbers are identical", async () => {
    const card = PARS.map((p, i) => (i < 18 ? p : null));
    const rev = await signed(card);

    const res = await saveScorecard(stageId, playerId, card, rev);
    expect(res.ok).toBe(true);

    const after = await statusNow();
    expect(after.status).toBe("certified");
    expect(after.certifiedBy).not.toBe("");
    expect(after.certifiedAt).not.toBeNull();
  });

  it("keeps it for a save that names no revision either", async () => {
    // The console's group save passes no revision — it has the card in front
    // of it — which is exactly the path that de-certified a playing partner.
    const card = PARS.map((p, i) => (i < 18 ? p : null));
    await signed(card);

    const res = await saveScorecard(stageId, playerId, card);
    expect(res.ok).toBe(true);
    expect((await statusNow()).status).toBe("certified");
  });

  it("still retracts it the moment a hole actually changes", async () => {
    // The rule this is protecting, not weakening: new strokes retract a
    // signature given for the old ones.
    const card = PARS.map((p, i) => (i < 18 ? p : null));
    const rev = await signed(card);

    const edited = card.map((s, i) => (i === 5 ? 9 : s));
    const res = await saveScorecard(stageId, playerId, edited, rev);
    expect(res.ok).toBe(true);

    const after = await statusNow();
    expect(after.status).toBe("entered");
    expect(after.certifiedBy).toBe("");
    expect(after.certifiedAt).toBeNull();
  });

  it("retracts it when a hole is rubbed out, too", async () => {
    const card = PARS.map((p, i) => (i < 18 ? p : null));
    const rev = await signed(card);

    const erased = card.map((s, i) => (i === 5 ? null : s));
    const res = await saveScorecard(stageId, playerId, erased, rev);
    expect(res.ok).toBe(true);
    expect((await statusNow()).status).toBe("entered");
  });
});

/**
 * A card stored shorter than its round does not invent a conflict.
 *
 * `importScores` slices to eighteen without padding, so an organizer uploading
 * the front nine at the turn leaves a nine-element array in the row. Every
 * other producer of a revision hashes a ROUND-SIZED array — `me.ts` says so
 * explicitly — so the phone and the server hashed two different shapes of the
 * same card. The next save came back as a conflict naming a hole the committee
 * had never touched, and (before the queue was fixed) that response also wiped
 * the device copy.
 */
describe("a card the committee stored short", () => {
  it("does not report a conflict against a card nobody touched", async () => {
    const front = PARS.slice(0, 9);
    await prisma.scorecard.deleteMany({ where: { stageId, playerId } });
    await prisma.scorecard.create({
      // NINE elements on an eighteen-hole round, exactly as importScores leaves it.
      data: { eventId, stageId, playerId, strokes: JSON.stringify(front), status: "entered" },
    });

    // What the phone read: the same card, fitted to the round.
    const asThePhoneSawIt = Array.from({ length: 18 }, (_, i) => front[i] ?? null);
    const readAt = cardRevision(asThePhoneSawIt);

    const res = await saveScorecard(
      stageId,
      playerId,
      asThePhoneSawIt.map((s, i) => (i === 9 ? 4 : s)),
      readAt,
    );
    expect(res.ok, "a short stored card is the same card, not a conflict").toBe(true);
  });

  it("hands back a revision the next save can use", async () => {
    const now = await stored();
    const res = await saveScorecard(stageId, playerId, now, cardRevision(now));
    expect(res.ok).toBe(true);
  });

  it("still reports a real conflict on a short card", async () => {
    // The fitting must not blind it to an actual disagreement.
    const front = PARS.slice(0, 9);
    await prisma.scorecard.deleteMany({ where: { stageId, playerId } });
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId, strokes: JSON.stringify(front), status: "entered" },
    });

    const stale = cardRevision(Array.from({ length: 18 }, (_, i) => (i === 2 ? 9 : front[i] ?? null)));
    const res = await saveScorecard(stageId, playerId, PARS, stale);
    expect(res.ok).toBe(false);
  });
});
