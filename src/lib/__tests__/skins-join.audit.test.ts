import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Asking to get in on a skins pot.
 *
 * Skins was the only pot nobody could ask to join. Every other bet carried a
 * `confirmed` flag, so a name could be put down as an INTENTION and become a
 * stake when the cash appeared; a skins entry was instantly real money, which
 * left no way to say "I want in" that did not also say "I have paid".
 *
 * Three properties, and each is a different way to lose somebody's money:
 *
 *   - a request is NOT money. It must not enter the pot, not dilute the
 *     payout, and not appear as a stake;
 *   - a request is NOT permission. Putting your name on somebody's game must
 *     not then let you re-price it, empty it or rename it;
 *   - a request is bounded by the pot's AUDIENCE. An ad-hoc bet is open to
 *     anyone in the field — that is how a game across three fourballs works —
 *     while a bet named after a tee-sheet group stays that group's.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-JOIN";

let session: { eventId: string; email: string; viewRole: string; name: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { requestSkinsEntry, confirmSkinsEntry, setSkinsEntrants, saveSkinsPot } = await import(
  "@/app/actions/skins"
);
const { skinsPotFor } = await import("@/lib/services/skins-pot");

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

/** An ad-hoc bet, open to the field, and a fourball's own. */
const ADHOC = "Saturday sweep";

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

  for (const [i, who] of ["ann", "bob", "cat"].entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.ann] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.bob, player.cat] },
        ],
      }),
    },
  });
});

beforeEach(async () => {
  await prisma.skinsPot.deleteMany({ where: { stageId } });
  // Ann's ad-hoc bet, with her stake in it.
  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: ADHOC },
  });
  await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: player.ann, confirmed: true } });
  // And Group 1's own, which is Ann's fourball and nobody else's.
  const own = await prisma.skinsPot.create({
    data: { eventId, stageId, buyInCents: 500, net: true, scope: "full", groupKey: "Group 1" },
  });
  await prisma.skinsEntry.create({ data: { potId: own.id, playerId: player.ann, confirmed: true } });

  session = { eventId, email: email.cat, viewRole: "player", name: "cat" };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const entriesOn = (groupKey: string) =>
  prisma.skinsEntry.findMany({
    where: { pot: { stageId, groupKey } },
    select: { playerId: true, confirmed: true },
    orderBy: { playerId: "asc" },
  });

describe("a player from another fourball asking into a bet", () => {
  it("lets somebody in another group ask into an ad-hoc bet", async () => {
    // Cat plays in Group 2. THIS IS THE POINT OF THE FEATURE: a bet across
    // fourballs, arranged without an organizer.
    expect(await requestSkinsEntry(stageId, true, "full", ADHOC, true)).toEqual({ ok: true });
    const rows = await entriesOn(ADHOC);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.playerId === player.cat)?.confirmed).toBe(false);
  });

  it("keeps the ask out of the money until somebody takes the cash", async () => {
    await requestSkinsEntry(stageId, true, "full", ADHOC, true);
    const view = await skinsPotFor(eventId, stageId, true, "full", ADHOC);
    // An intention is not a stake. Paying a pot out across people who have put
    // nothing in leaves whoever holds it personally short the difference.
    expect(view?.entrantIds).toEqual([player.ann]);
    expect(view?.pendingIds).toEqual([player.cat]);
  });

  it("turns the ask into a stake when somebody in the bet confirms it", async () => {
    await requestSkinsEntry(stageId, true, "full", ADHOC, true);
    session = { eventId, email: email.ann, viewRole: "player", name: "ann" };
    expect(await confirmSkinsEntry(stageId, true, "full", ADHOC, player.cat, true)).toEqual({
      ok: true,
    });
    const view = await skinsPotFor(eventId, stageId, true, "full", ADHOC);
    expect(view?.entrantIds.sort()).toEqual([player.ann, player.cat].sort());
    expect(view?.pendingIds).toEqual([]);
  });

  it("refuses an ask into a fourball's own game from outside it", async () => {
    // Cat is in Group 2. Group 1's pot is not offered to her, and appearing on
    // their collect list is not something she gets to do to them.
    expect(await requestSkinsEntry(stageId, true, "full", "Group 1", true)).toMatchObject({
      ok: false,
    });
    expect(await entriesOn("Group 1")).toHaveLength(1);
  });

  it("does NOT make asking a way to get control of somebody's bet", async () => {
    /**
     * THE HOLE THIS CLOSES. If an unconfirmed row counted as membership,
     * putting your name down on any bet would let you re-price it, empty it
     * or rename it — asking to join would BE the way in.
     */
    await requestSkinsEntry(stageId, true, "full", ADHOC, true);
    const r = await saveSkinsPot(stageId, {
      buyInCents: 999999,
      net: true,
      scope: "full",
      groupKey: ADHOC,
    });
    expect(r).toMatchObject({ ok: false });
    const pot = await prisma.skinsPot.findFirst({
      where: { stageId, groupKey: ADHOC },
      select: { buyInCents: true },
    });
    expect(pot?.buyInCents, "an unpaid ask re-priced somebody else's bet").toBe(2000);
  });

  it("lets a player withdraw an ask, but not a stake", async () => {
    await requestSkinsEntry(stageId, true, "full", ADHOC, true);
    expect(await requestSkinsEntry(stageId, true, "full", ADHOC, false)).toEqual({ ok: true });
    expect(await entriesOn(ADHOC)).toHaveLength(1);

    // Ann's money is in. Walking out of a losing bet on the last green is not
    // a thing the app lets somebody do to the people they are playing.
    session = { eventId, email: email.ann, viewRole: "player", name: "ann" };
    expect(await requestSkinsEntry(stageId, true, "full", ADHOC, false)).toMatchObject({
      ok: false,
    });
    expect(await entriesOn(ADHOC)).toHaveLength(1);
  });

  it("does not wipe an outstanding ask when somebody nudges the entrant list", async () => {
    /**
     * The bug `setSideGameEntrants` already had to be taught about, now that
     * skins entries carry the same flag. Replacing the list used to delete
     * every row not in it, so a pending request vanished the moment anybody
     * touched the chips — the player's ask lost with nothing to show for it.
     */
    await requestSkinsEntry(stageId, true, "full", ADHOC, true);
    session = { eventId, email: email.ann, viewRole: "player", name: "ann" };
    await setSkinsEntrants(stageId, true, "full", [player.ann], ADHOC);

    const rows = await entriesOn(ADHOC);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.playerId === player.cat)?.confirmed).toBe(false);
    expect(rows.find((r) => r.playerId === player.ann)?.confirmed).toBe(true);
  });

  it("says so when there is no pot to ask into", async () => {
    expect(await requestSkinsEntry(stageId, true, "front", ADHOC, true)).toMatchObject({
      ok: false,
    });
  });

  it("refuses somebody who is not signed in, without throwing", async () => {
    session = null;
    expect(await requestSkinsEntry(stageId, true, "full", ADHOC, true)).toEqual({
      ok: false,
      error: "Not signed in",
    });
  });
});
