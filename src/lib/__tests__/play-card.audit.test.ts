import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** The play session the round code produces. Set per test. */
let session: {
  eventId: string;
  stageId: string;
  playerId: string;
  playerName: string;
  roundLabel: string;
} | null = null;

vi.mock("@/lib/play-auth", () => ({
  getPlaySession: async () => session,
  createPlaySession: async () => {},
  destroyPlaySession: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { savePlayCard, certifyPlayCard } = await import("@/app/actions/play");

/**
 * A Round Code can score a MEDAL, not only a match.
 *
 * Walked on 2026-09-10. A charity day built from its own template turns player
 * self-scoring on and hands out a Round Code precisely so a roster of names can
 * score without accounts — and the whole `/play` surface knew only about
 * matches. Redeem the code, tap your name, and the flow ended at "No match for
 * you in Round 1. Check with your organizer": a sentence about a draw problem
 * that does not exist, on a round that has no draw by design.
 *
 * WHAT THIS ASSERTS is the join. The card is written through `writeScorecard`,
 * the same function the console's own entry screen uses, so the rules about
 * validation, partial cards, certification and freezing a round's handicaps are
 * one set rather than two. The AUTHORIZATION is this surface's own, and the
 * tests that matter here are the refusals: a round code is a shared secret
 * announced to a field, so it must write only its own player's card and only
 * where the tournament lets players report at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PLAYCARD";
const PARS = new Array(18).fill(4);
const FULL_CARD = new Array(18).fill(4);

let eventId = "";
let stageId = "";
let mine = "";
let theirs = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** The tournament's own settings, changed per test. */
async function setEvent(data: Record<string, unknown>) {
  await prisma.event.update({ where: { id: eventId }, data });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} society`, kind: "community" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} charity day`,
      status: "live",
      format: "stroke",
      shape: "single",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      // What the charity-day template sets: the field scores itself, with a
      // Round Code so a roster of names can get in without accounts.
      scoreEntryBy: "players",
      scoreEntryWindow: "after",
      playerAccess: "code",
    },
    select: { id: true },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "stableford",
      holes: 18,
    },
    select: { id: true },
  });
  stageId = stage.id;

  for (const who of ["mine", "theirs"]) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}-${who}@example.invalid`.toLowerCase(),
        status: "confirmed",
        handicap: 12,
        seed: who === "mine" ? 1 : 2,
      },
      select: { id: true },
    });
    if (who === "mine") mine = p.id;
    else theirs = p.id;
  }
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** A code holder, signed in as one player on one round. */
function asPlayer(playerId: string) {
  session = { eventId, stageId, playerId, playerName: `${TAG} player`, roundLabel: "Round 1" };
}

describe("a round code on a medal round", () => {
  it("writes the code holder's own card", async () => {
    asPlayer(mine);
    const res = await savePlayCard(FULL_CARD);
    expect(res.ok, res.error).toBe(true);

    const card = await prisma.scorecard.findFirst({
      where: { eventId, stageId, playerId: mine },
      select: { strokes: true },
    });
    expect(card, "the card exists at all — this whole surface had no way to make one").not.toBeNull();
    expect(JSON.parse(card!.strokes)).toEqual(FULL_CARD);
  });

  it("and writes it for the player the SESSION names, with no id from the caller", async () => {
    /**
     * THE SAFETY PROPERTY, and the reason the action takes no playerId. A
     * round code is a shared secret read out to a field, so every holder is
     * every other holder as far as the code is concerned — an id on the wire
     * would let any of them write anybody's card.
     *
     * Asserted as an absence, which is the direction that cannot be satisfied
     * by accident: after saving as one player, the other player's card is
     * still not there.
     */
    asPlayer(mine);
    await savePlayCard(FULL_CARD);
    const other = await prisma.scorecard.count({ where: { eventId, stageId, playerId: theirs } });
    expect(other, "somebody else's card was written").toBe(0);
  });

  it("refuses when the committee keeps the cards", async () => {
    /**
     * The same refusal the match path gives, for the same reason: an organizer
     * who handed out codes purely so the field could sign in believes only the
     * committee can touch a result. A score edit always resets approval, so a
     * code holder writing here would send a card the committee had confirmed
     * back to pending with nobody told.
     */
    await setEvent({ scoreEntryBy: "staff" });
    asPlayer(mine);
    const res = await savePlayCard(FULL_CARD);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/entered by the organizer/);
    await setEvent({ scoreEntryBy: "players" });
  });

  it("refuses a half-filled card when the round is submitted at the end", async () => {
    // `scoreEntryWindow: "after"` is the charity template's own setting, and
    // it is the whole of `canPlayerSavePartial`. Reported rather than thrown:
    // this is called straight from the client, which renders `res.error`.
    asPlayer(mine);
    const half = [...new Array(9).fill(4), ...new Array(9).fill(null)];
    const res = await savePlayCard(half);
    expect(res.ok).toBe(false);
    expect(res.error, "and says what to do").toMatch(/full round/i);
  });

  it("but takes one while the round is still being played", async () => {
    // THE ASSERTION THAT STOPS THIS BECOMING "NEVER TAKE A PARTIAL CARD". A
    // league scoring live is the case the window exists for.
    await setEvent({ scoreEntryWindow: "during" });
    asPlayer(mine);
    const half = [...new Array(9).fill(5), ...new Array(9).fill(null)];
    const res = await savePlayCard(half);
    expect(res.ok, res.error).toBe(true);
    const card = await prisma.scorecard.findFirst({
      where: { eventId, stageId, playerId: mine },
      select: { strokes: true },
    });
    expect(JSON.parse(card!.strokes)[0]).toBe(5);
    await setEvent({ scoreEntryWindow: "after" });
  });

  it("refuses a payload that is not a card, rather than storing it", async () => {
    /**
     * `writeScorecard` throws on this, exactly as it did inside the console
     * action; this surface catches and reports. The stored length is not
     * inert — it decides how a round is segmented and ranked — so a caller
     * posting forty entries must not get forty stored.
     */
    asPlayer(mine);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await savePlayCard("not a card" as any);
    expect(res.ok).toBe(false);
    /**
     * BY THE REFUSAL'S OWN WORDS, not merely by `ok: false`.
     *
     * `ok: false` was satisfied here by a CRASH. Deleting the validation left
     * `clean` null, the next line called `.filter` on it, and the TypeError
     * came back through the same catch — so the mutation looked green and the
     * test read as proving a guard it was not touching. Naming the sentence is
     * what tells a refusal apart from a fall-over.
     */
    expect(res.error, "refused, not crashed").toMatch(/aren't valid/i);
    const card = await prisma.scorecard.findFirst({
      where: { eventId, stageId, playerId: mine },
      select: { strokes: true },
    });
    expect(JSON.parse(card!.strokes), "the stored card is untouched").toHaveLength(18);
  });

  it("refuses with no session at all", async () => {
    session = null;
    const res = await savePlayCard(FULL_CARD);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/session expired/i);
  });
});

/**
 * AND THE PLAYER CAN SIGN IT — Rule 3.3b, from the surface the field uses.
 *
 * Without this every card a charity day's field submitted arrived at Score
 * entry reading "Not certified yet" and landed in "needs attention", where
 * the only control is "Approve anyway". Measured on 2026-09-10: the same
 * screen cites the rule in the sentence directly above the button that
 * overrides it, and the app gave the field no way to satisfy it.
 */
describe("signing a card entered with a round code", () => {
  it("certifies the code holder's own card, and records who", async () => {
    asPlayer(mine);
    await savePlayCard(FULL_CARD);
    const res = await certifyPlayCard();
    expect(res.ok, res.error).toBe(true);

    const card = await prisma.scorecard.findFirst({
      where: { eventId, stageId, playerId: mine },
      select: { status: true, certifiedBy: true, certifiedAt: true },
    });
    expect(card!.status).toBe("certified");
    // By NAME, because a code holder has no account — the record's job is to
    // say who claimed the scores were right, not to be a credential.
    expect(card!.certifiedBy, "somebody signed it").toBe(`${TAG} player`);
    expect(card!.certifiedAt, "and when").not.toBeNull();
  });

  it("refuses when the committee keeps the cards", async () => {
    // The same gate the write has. A tournament the committee scores must not
    // have its cards signed by a code holder either.
    await setEvent({ scoreEntryBy: "staff" });
    asPlayer(mine);
    const res = await certifyPlayCard();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/entered by the organizer/);
    await setEvent({ scoreEntryBy: "players" });
  });

  it("refuses to sign a card the committee has already accepted", async () => {
    /**
     * THE SAFETY PROPERTY, and the reason signing goes through the same
     * `certifyCard` the console uses. An approved card is the committee's,
     * not the marker's, to change — and a code is held by the whole field.
     */
    asPlayer(mine);
    await savePlayCard(FULL_CARD);
    await prisma.scorecard.updateMany({
      where: { eventId, stageId, playerId: mine },
      data: { status: "approved", approvedBy: "committee@example.invalid", approvedAt: new Date() },
    });

    const res = await certifyPlayCard();
    expect(res.ok).toBe(false);

    const card = await prisma.scorecard.findFirst({
      where: { eventId, stageId, playerId: mine },
      select: { status: true },
    });
    expect(card!.status, "the acceptance stands").toBe("approved");
    // Put it back for anything that runs after.
    await prisma.scorecard.updateMany({
      where: { eventId, stageId, playerId: mine },
      data: { status: "entered", approvedBy: "", approvedAt: null },
    });
  });

  it("refuses when there is no card to sign", async () => {
    // Signing nothing would be a signature over an empty row.
    asPlayer(theirs);
    const res = await certifyPlayCard();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no card to certify/i);
  });
});
