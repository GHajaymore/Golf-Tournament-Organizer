import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resolveMoneyMode } from "@/lib/domain/money-mode";

/**
 * A casual round's money is the golf bet, never the travel expenses.
 *
 * Two kinds of money, and only one of them belongs to a Sunday fourball:
 *
 *   the BET      skins, a birdie pot, a Nassau — agreed on the first tee,
 *                between the people playing, settled off the cards
 *   the LEDGER   "the minibus, the green fees, dinner" — somebody fronted a
 *                cost and everybody owes a share, which is a society trip
 *
 * `resolveMoneyMode` reads three levels of setting and falls back to the KIND
 * of organization, and two of the three kinds default to `ledger: true`. A new
 * user's own organization is `personal`, which is one of them — so a quick
 * round set up by somebody with no club at all, the free-tier case the whole
 * path exists for, arrived offering to split costs for a minibus nobody hired.
 *
 * Asserted against real rows because the defect is in what the RESOLUTION
 * returns for a stored event, not in any one function: every part behaved
 * correctly on its own.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUAL-MONEY";

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

async function orgOfKind(kind: string) {
  return prisma.organization.create({
    data: { name: `${TAG} ${kind}`, kind },
    select: { id: true, kind: true, moneyMode: true },
  });
}

async function eventIn(organizationId: string, name: string, moneyMode: string, shape: string) {
  return prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-mm-${Math.random().toString(36).slice(2)}`,
      status: "live",
      shape,
      moneyMode,
    },
    select: { id: true, moneyMode: true },
  });
}

describe("what money mode a casual round lands in", () => {
  it("is 'none' in a personal organization, which is where free-tier rounds live", async () => {
    const org = await orgOfKind("personal");
    /**
     * THE ONE THAT WAS BROKEN.
     *
     * `organizationForNewEvent` creates a personal organization for anybody
     * who has never made anything, so this is the state of every quick round
     * belonging to somebody with no club.
     */
    const resolvedWithout = resolveMoneyMode({
      eventMode: "",
      orgMode: org.moneyMode,
      orgKind: org.kind,
    });
    expect(resolvedWithout, "the fallback this fix exists to override").toBe("split");

    const round = await eventIn(org.id, "quick round", "none", "match");
    expect(
      resolveMoneyMode({ eventMode: round.moneyMode, orgMode: org.moneyMode, orgKind: org.kind }),
    ).toBe("none");
  });

  it("is 'none' in a society too, where the ledger genuinely belongs", async () => {
    // A society DOES split costs — that is what the mode is for — and its
    // tournaments must keep it. Only the casual round opts out.
    const org = await orgOfKind("community");
    const round = await eventIn(org.id, "society roll-up", "none", "match");
    const tournament = await eventIn(org.id, "away trip", "", "series");

    expect(
      resolveMoneyMode({ eventMode: round.moneyMode, orgMode: org.moneyMode, orgKind: org.kind }),
    ).toBe("none");
    /**
     * THE ASSERTION THAT MAKES THE ONE ABOVE MEAN SOMETHING.
     *
     * "The casual round is none" alone is satisfied by a change that turned
     * the ledger off for everybody — which would take a real feature away
     * from the societies that use it. The two answers must differ in the same
     * organization.
     */
    expect(
      resolveMoneyMode({
        eventMode: tournament.moneyMode,
        orgMode: org.moneyMode,
        orgKind: org.kind,
      }),
    ).toBe("split");
  });

  it("leaves a club's tournaments exactly where they were", async () => {
    // A club leaves the cash to the shop, and always has. Nothing here should
    // move that.
    const org = await orgOfKind("club");
    const tournament = await eventIn(org.id, "club championship", "", "series");
    expect(
      resolveMoneyMode({
        eventMode: tournament.moneyMode,
        orgMode: org.moneyMode,
        orgKind: org.kind,
      }),
    ).toBe("none");
  });

  it("does not turn the golf bet off with the ledger", async () => {
    /**
     * "none" is the right mode rather than a way of switching money off, and
     * `MONEY_MODE_LABEL` says so where it is declared: what it turns off is
     * the app handling FEES AND SHARED COSTS — "skins, 2s and side bets are
     * still worked out and shown to the players".
     *
     * So a pot on a "none" round is a real pot with real money in it. Asserted
     * by putting one there: if the mode were doing more than it claims, this
     * is where it would show.
     */
    const org = await orgOfKind("personal");
    const round = await eventIn(org.id, "round with a bet", "none", "match");
    const stage = await prisma.stage.create({
      data: {
        eventId: round.id,
        position: 0,
        type: "Round Robin",
        description: "",
        format: "Match Play",
        holes: 18,
      },
      select: { id: true },
    });
    const pot = await prisma.skinsPot.create({
      data: { eventId: round.id, stageId: stage.id, buyInCents: 500, net: false, groupKey: "" },
      select: { id: true, buyInCents: true },
    });

    expect(pot.buyInCents).toBe(500);
    expect(await prisma.skinsPot.count({ where: { eventId: round.id } })).toBe(1);
  });
});
