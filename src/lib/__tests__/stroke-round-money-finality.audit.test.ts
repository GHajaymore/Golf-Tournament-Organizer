import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { roundMoneyFor } from "@/lib/services/expenses";

/**
 * A STROKE ROUND IS NOT FINISHED BECAUSE ONE PLAYER IS.
 *
 * `roundMoneyFinality` counted a hole as returned if ANY card had a score on
 * it, so the first player to finish eighteen made the whole round "in" — and
 * a round's money was reported, and its skins settled, with the rest of the
 * field still on the course. CLAUDE.md's money rule is "final only, never
 * live": the question is whether the amount can still change, and with a
 * player on the 10th tee every skin from there in is still open.
 *
 * It is the medal-round twin of the match-round defect `cardsCanSettle` was
 * written for — "an incomplete ROUND paid out on somebody else's card" —
 * fixed there and left here. Every existing cell passed ONE card, which cannot
 * tell `some` from `every`.
 *
 * Proven here against real rows, through `roundMoneyFor`, which is what the
 * player's own money screen reads.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-stroke-money-final";

const FULL = JSON.stringify(new Array(18).fill(4));
const NINE = JSON.stringify([...new Array(9).fill(4), ...new Array(9).fill(null)]);

interface Round {
  eventId: string;
  stageId: string;
  email: string;
}

/** Two confirmed players, the first finished; `second` is the other's card. */
async function round(
  label: string,
  second: string,
  secondStatus = "confirmed",
  secondCardStatus = "entered",
): Promise<Round> {
  const org = await prisma.organization.create({
    data: { name: `${TAG}-${label}`, kind: "club" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG}-${label}-ev`,
      // NOT "completed": closing the tournament makes every round final on
      // its own, which would pass these whatever the cards said.
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
    },
    select: { id: true },
  });

  let mine = "";
  for (let i = 0; i < 2; i += 1) {
    const email = `${TAG}-${label}-p${i}@example.invalid`;
    if (i === 0) mine = email;
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} P${i}`,
        email,
        handicap: 8,
        seed: i + 1,
        status: i === 0 ? "confirmed" : secondStatus,
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        playerId: p.id,
        strokes: i === 0 ? FULL : second,
        status: i === 0 ? "entered" : secondCardStatus,
      },
    });
  }
  return { eventId: event.id, stageId: stage.id, email: mine };
}

async function row(r: Round) {
  const view = await roundMoneyFor(r.eventId, r.email);
  const found = view.rounds.find((x) => x.stageId === r.stageId);
  expect(found, "the round is missing from the player's money screen").toBeTruthy();
  return found!;
}

/** Collected by the mark, so a run that dies before teardown is cleaned next time. */
afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } }).catch(() => {});
  await prisma.$disconnect();
});

let midRound: Round;
let finished: Round;
let walkedOff: Round;
let disputed: Round;

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  midRound = await round("mid", NINE);
  finished = await round("done", FULL);
  walkedOff = await round("wd", NINE, "withdrawn");
  // Both cards complete; the second is DISPUTED. Differs from `finished` in
  // that one field alone, which is what makes it a test of the status.
  disputed = await round("disp", FULL, "confirmed", "disputed");
});

describe("a stroke round with a disputed card", () => {
  it("is not final while the dispute stands", async () => {
    /**
     * The gap #470 named and left: a disputed card's strokes can still
     * change, so the amount can, so CLAUDE.md's money rule says not final.
     * `roundStrokes` now carries the status from `Scorecard` — the only one
     * of its three tables that has one.
     */
    const r = await row(disputed);
    expect(r.final, "skins settled on a card somebody said was wrong").toBe(false);
  });
});

describe("a stroke round with one player still out", () => {
  it("is not final", async () => {
    const r = await row(midRound);
    expect(r.final, "the money was reported with a player on the 10th tee").toBe(false);
  });

  it("says nine holes are in, not eighteen", async () => {
    const r = await row(midRound);
    expect(r.holesReturned, "a hole is in when every card has it").toBe(9);
  });

  // Deliberately NO assertion on winnings here. With no pot on this fixture
  // there is nothing to pay either way, so "yourCents is 0" passed on the old
  // code too — a cell that cannot fail. `final` is what gates every payout
  // (`gameNets` settles only final rounds), so it is the thing asserted.
});

describe("the controls", () => {
  it("a round every player has finished is final", async () => {
    // Without this, every assertion above is satisfied by a reader that
    // never calls anything final.
    const r = await row(finished);
    expect(r.final).toBe(true);
    expect(r.holesReturned).toBe(18);
  });

  it("a withdrawn player's half card does not hold the round open", async () => {
    const r = await row(walkedOff);
    expect(r.final, "a player who walked off held the pot for ever").toBe(true);
  });
});
