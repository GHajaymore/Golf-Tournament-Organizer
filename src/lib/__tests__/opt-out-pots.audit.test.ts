import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * An opt-out pot, from the player's side and the organizer's.
 *
 * From the 2026-08-27 exploratory audit. In an opt-out pot the premise is that
 * everybody is in and a player with NO row counts as a settled stake — so a row
 * saying `confirmed: false` does not mean "asked to join", it means "has not
 * paid", and `potMembership` moves that player OUT of the pot.
 *
 * Three separate places had never been told:
 *
 *   - `requestContestEntry` / `requestSideGameEntry` wrote exactly that row
 *     when a player tapped "I'm in", so the tap removed them from a pot they
 *     were already in, shrank it by their buy-in, and disqualified them from
 *     winning it.
 *   - `setContestEntrants` deleted every row for the contest before recreating
 *     the ids it was given, destroying both an organizer's explicit exclusion
 *     and an outstanding ask. Both sibling actions had been fixed for this.
 *   - `setContestWinners` created a row to record a win without saying
 *     `confirmed: false`, and the column defaults to TRUE — so recording a
 *     winner charged them a buy-in they had never staked.
 *
 * None of the three actions was invoked by any test, which is why 3,242 green
 * ones never saw it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  requestContestEntry,
  setContestEntrants,
  setContestWinners,
} from "@/app/actions/contests";
import { requestSideGameEntry } from "@/app/actions/side-games";
import { potMembership } from "@/lib/domain/pot-entry";
import { moneyFor } from "@/lib/services/expenses";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-OPTOUT";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let eventId = "";
let orgId = "";
const player: Record<string, string> = {};
const userIds: Record<string, string> = {};
const WHO = ["sam", "ann", "rob", "dave"];

async function signIn(who: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}

/** Who the pot actually counts as in, read the way the money reads it. */
async function entrantsOf(contestId: string, mode: "opt-in" | "opt-out") {
  const rows = await prisma.contestEntry.findMany({ where: { contestId } });
  return potMembership(
    mode,
    WHO.map((w) => player[w]),
    rows.map((r) => ({ playerId: r.playerId, confirmed: r.confirmed, excluded: r.excluded })),
  );
}

async function freshContest(entryMode: "opt-in" | "opt-out") {
  return prisma.contest.create({
    data: { eventId, name: `${TAG} low gross`, kind: "other", buyInCents: 1000, entryMode },
  });
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} outing`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      scoreEntryBy: "players",
      playerAccess: "email",
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  for (const [i, who] of WHO.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
    userIds[who] = u.id;
    // Sam is a player; the organizer runs the pot.
    await prisma.account.create({
      data: { eventId, email: at(who), name: who, role: who === "ann" ? "admin" : "player" },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("tapping the join button on an opt-out pot", () => {
  it("starts with the whole field in, holding no rows at all", async () => {
    const c = await freshContest("opt-out");
    const before = await entrantsOf(c.id, "opt-out");
    expect(before.entrants).toHaveLength(WHO.length);
    expect(await prisma.contestEntry.count({ where: { contestId: c.id } })).toBe(0);
  });

  it("does not take a player OUT when they tap to be in", async () => {
    // The defect. `{confirmed:false}` reads as "has not paid", which in
    // opt-out moves them to `pending` — so the tap on "I'm in" removed them.
    const c = await freshContest("opt-out");
    await signIn("sam");
    const res = await requestContestEntry(c.id, true);
    expect(res.ok).toBe(true);

    const after = await entrantsOf(c.id, "opt-out");
    expect(after.entrants).toContain(player.sam);
    expect(after.pending).not.toContain(player.sam);
  });

  it("leaves the pot the same size", async () => {
    const c = await freshContest("opt-out");
    await signIn("sam");
    await requestContestEntry(c.id, true);
    const after = await entrantsOf(c.id, "opt-out");
    // Four players at £10. It used to drop to £30 on Sam's own tap.
    expect(after.entrants).toHaveLength(4);
  });

  it("takes them out when they actually ask to be out", async () => {
    const c = await freshContest("opt-out");
    await signIn("sam");
    const res = await requestContestEntry(c.id, false);
    expect(res.ok).toBe(true);

    const after = await entrantsOf(c.id, "opt-out");
    expect(after.entrants).not.toContain(player.sam);
    expect(after.excluded).toContain(player.sam);
    expect(after.entrants).toHaveLength(3);
  });

  it("lets them opt back in afterwards", async () => {
    // There was no way back at all: the only action that clears an exclusion
    // has no caller anywhere in the app.
    const c = await freshContest("opt-out");
    await signIn("sam");
    await requestContestEntry(c.id, false);
    await requestContestEntry(c.id, true);

    const after = await entrantsOf(c.id, "opt-out");
    expect(after.entrants).toContain(player.sam);
    expect(after.excluded).not.toContain(player.sam);
  });

  it("still refuses to let them walk out on money the organizer holds", async () => {
    const c = await freshContest("opt-out");
    await prisma.contestEntry.create({
      data: { contestId: c.id, playerId: player.sam, confirmed: true },
    });
    await signIn("sam");
    const res = await requestContestEntry(c.id, false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ask them to take you out/i);
  });
});

describe("an organizer nudging the entrant list", () => {
  it("does not silently put an excluded player back in the pot", async () => {
    const c = await freshContest("opt-out");
    // Dave took himself out.
    await prisma.contestEntry.create({
      data: { contestId: c.id, playerId: player.dave, excluded: true, confirmed: false },
    });

    // The organizer ticks somebody else entirely.
    await signIn("ann");
    const res = await setContestEntrants(c.id, [player.rob]);
    expect(res.ok).toBe(true);

    const after = await entrantsOf(c.id, "opt-out");
    // Deleting Dave's row would leave him with none, and in opt-out that is
    // "in and settled" — charged £10 into somebody else's pot by a tick that
    // had nothing to do with him.
    expect(after.excluded).toContain(player.dave);
    expect(after.entrants).not.toContain(player.dave);
  });

  it("does not lose an outstanding ask", async () => {
    const c = await freshContest("opt-in");
    await prisma.contestEntry.create({
      data: { contestId: c.id, playerId: player.sam, confirmed: false },
    });

    await signIn("ann");
    await setContestEntrants(c.id, [player.rob]);

    const after = await entrantsOf(c.id, "opt-in");
    expect(after.pending).toContain(player.sam);
    expect(after.entrants).not.toContain(player.sam);
  });

  it("confirms the players it was actually given", async () => {
    const c = await freshContest("opt-in");
    await signIn("ann");
    await setContestEntrants(c.id, [player.rob, player.ann]);

    const after = await entrantsOf(c.id, "opt-in");
    expect(after.entrants.sort()).toEqual([player.rob, player.ann].sort());
  });

  it("removes a confirmed entrant who is left out of the list", async () => {
    const c = await freshContest("opt-in");
    await signIn("ann");
    await setContestEntrants(c.id, [player.rob, player.ann]);
    await setContestEntrants(c.id, [player.rob]);

    const after = await entrantsOf(c.id, "opt-in");
    expect(after.entrants).toEqual([player.rob]);
  });
});

describe("recording a winner who never staked", () => {
  it("does not charge them a buy-in for winning", async () => {
    // The action's own comment says "one is created without a stake". Omitting
    // `confirmed` took the column default, which is true.
    const c = await freshContest("opt-in");
    await signIn("ann");
    await setContestWinners(c.id, [player.dave]);

    const row = await prisma.contestEntry.findUniqueOrThrow({
      where: { contestId_playerId: { contestId: c.id, playerId: player.dave } },
    });
    expect(row.won).toBe(true);
    expect(row.confirmed).toBe(false);

    const after = await entrantsOf(c.id, "opt-in");
    expect(after.entrants).not.toContain(player.dave);
  });

  it("leaves a real entrant's stake alone when they win", async () => {
    const c = await freshContest("opt-in");
    await signIn("ann");
    await setContestEntrants(c.id, [player.rob]);
    await setContestWinners(c.id, [player.rob]);

    const row = await prisma.contestEntry.findUniqueOrThrow({
      where: { contestId_playerId: { contestId: c.id, playerId: player.rob } },
    });
    expect(row.confirmed).toBe(true);
    expect(row.won).toBe(true);
  });

  /**
   * THE OTHER MODE, which both cases above skip.
   *
   * Each builds its fixture with `freshContest("opt-in")`, so `confirmed:
   * false` was only ever asserted where it is right. In opt-out the ordinary
   * state is NO rows and the whole field in, and `potMembership` reads a
   * non-excluded row with `confirmed: false` as PENDING — so the row created
   * to record the win took the winner out of their own pot.
   *
   * The organizer causes it by doing the one thing the screen asks: tapping
   * the winner's chip.
   */
  it("does not take an opt-out winner out of the pot that pays them", async () => {
    const c = await freshContest("opt-out");
    await signIn("ann");

    const before = await entrantsOf(c.id, "opt-out");
    expect(before.entrants).toContain(player.dave);

    await setContestWinners(c.id, [player.dave]);

    const after = await entrantsOf(c.id, "opt-out");
    // Still in, still settled, and NOT sitting in the organizer's
    // "asked to join — take their money" list for a stake already handed over.
    expect(after.entrants).toContain(player.dave);
    expect(after.pending).not.toContain(player.dave);
    // The pot is the size it was: a winner is not a player who left.
    expect(after.entrants).toHaveLength(before.entrants.length);

    const row = await prisma.contestEntry.findUniqueOrThrow({
      where: { contestId_playerId: { contestId: c.id, playerId: player.dave } },
    });
    expect(row.won).toBe(true);
    expect(row.confirmed).toBe(true);
  });

  it("leaves the opt-out winner in even after the contest is reopened", async () => {
    /**
     * Reopening only sets `won: false` — the row itself persists — so a wrong
     * `confirmed` written here is permanent from the organizer's point of
     * view. Nothing on any screen offers to put it back.
     */
    const c = await freshContest("opt-out");
    await signIn("ann");
    await setContestWinners(c.id, [player.dave]);
    await setContestWinners(c.id, []);

    const after = await entrantsOf(c.id, "opt-out");
    expect(after.entrants).toContain(player.dave);
    expect(after.pending).not.toContain(player.dave);
  });
});

/**
 * The money screen and the settlement have to agree about who is in.
 *
 * They did not. The figures went through `potMembership`; the player's own
 * "am I in this" read whether a row existed. In opt-out mode the ordinary case
 * is NO row and the player IS in, so the button offered "I'm in" to somebody
 * who already was — and the button sends the opposite of what it shows.
 *
 * The side-game list had it worse: its pot and its head-count were
 * `entrants.filter(confirmed).length` off the rows, so an opt-out derived pot
 * read "0 in" while the settlement below it charged the whole field.
 */
describe("what the player's money screen says about an opt-out pot", () => {
  it("tells a player with no row that they are in, and settled", async () => {
    const c = await freshContest("opt-out");
    const view = await moneyFor(eventId, at("sam"));
    const row = view.contests.find((x) => x.id === c.id);
    expect(row).toBeTruthy();
    expect(row!.youIn).toBe(true);
    expect(row!.youConfirmed).toBe(true);
  });

  it("counts the whole field in the pot", async () => {
    const c = await freshContest("opt-out");
    const view = await moneyFor(eventId, at("sam"));
    const row = view.contests.find((x) => x.id === c.id)!;
    expect(row.entrants).toBe(WHO.length);
    expect(row.potCents).toBe(1000 * WHO.length);
  });

  it("says they are out once they have opted out", async () => {
    const c = await freshContest("opt-out");
    await signIn("sam");
    await requestContestEntry(c.id, false);

    const view = await moneyFor(eventId, at("sam"));
    const row = view.contests.find((x) => x.id === c.id)!;
    expect(row.youIn).toBe(false);
    expect(row.entrants).toBe(WHO.length - 1);
  });

  it("still shows an opt-in ask as an ask, not as a stake", async () => {
    // The pending state has to survive the change, or an opt-in signup would
    // read "I'm in" forever and the player could ask twice.
    const c = await freshContest("opt-in");
    await signIn("sam");
    await requestContestEntry(c.id, true);

    const view = await moneyFor(eventId, at("sam"));
    const row = view.contests.find((x) => x.id === c.id)!;
    expect(row.youIn).toBe(true);
    expect(row.youConfirmed).toBe(false);
    expect(row.entrants).toBe(0);
  });

  it("does not read an opt-out DERIVED pot as empty while charging for it", async () => {
    const stage = await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play", format: "Stroke Play", holes: 18 },
    });
    const game = await prisma.sideGame.create({
      data: { eventId, stageId: stage.id, kind: "low-gross", buyInCents: 500, entryMode: "opt-out" },
    });

    const view = await moneyFor(eventId, at("sam"));
    const row = view.sideGames.find((g) => g.id === game.id);
    expect(row).toBeTruthy();
    // It read "0 in" here while settling for the whole field.
    expect(row!.entrants).toBe(WHO.length);
    expect(row!.potCents).toBe(500 * WHO.length);
    expect(row!.youIn).toBe(true);
  });
});

/** The same inversion lived in the derived pots, and needs the same proof. */
describe("tapping the join button on an opt-out derived pot", () => {
  const freshGame = async (entryMode: "opt-in" | "opt-out") => {
    const stage = await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play", format: "Stroke Play", holes: 18 },
    });
    return prisma.sideGame.create({
      data: { eventId, stageId: stage.id, kind: "birdies", buyInCents: 500, entryMode },
    });
  };

  const membershipOf = async (sideGameId: string, mode: "opt-in" | "opt-out") => {
    const rows = await prisma.sideGameEntry.findMany({ where: { sideGameId } });
    return potMembership(
      mode,
      WHO.map((w) => player[w]),
      rows.map((r) => ({ playerId: r.playerId, confirmed: r.confirmed, excluded: r.excluded })),
    );
  };

  it("does not take a player out when they tap to be in", async () => {
    const g = await freshGame("opt-out");
    await signIn("sam");
    const res = await requestSideGameEntry(g.id, true);
    expect(res.ok).toBe(true);

    const after = await membershipOf(g.id, "opt-out");
    expect(after.entrants).toContain(player.sam);
    expect(after.entrants).toHaveLength(WHO.length);
  });

  it("takes them out when they ask to be out, and lets them back in", async () => {
    const g = await freshGame("opt-out");
    await signIn("sam");

    await requestSideGameEntry(g.id, false);
    const out = await membershipOf(g.id, "opt-out");
    expect(out.excluded).toContain(player.sam);
    expect(out.entrants).not.toContain(player.sam);

    await requestSideGameEntry(g.id, true);
    const back = await membershipOf(g.id, "opt-out");
    expect(back.entrants).toContain(player.sam);
    expect(back.excluded).not.toContain(player.sam);
  });

  it("leaves an opt-in game asking to join, as before", async () => {
    const g = await freshGame("opt-in");
    await signIn("sam");
    await requestSideGameEntry(g.id, true);

    const after = await membershipOf(g.id, "opt-in");
    expect(after.pending).toContain(player.sam);
    expect(after.entrants).not.toContain(player.sam);
  });
});
