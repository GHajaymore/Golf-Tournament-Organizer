import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A player cannot stake the field in a bet they invented.
 *
 * From the 2026-08-27 exploratory audit. `requirePotAccess` deliberately lets
 * ANY player in the field create a pot under a name the tee sheet does not
 * know — six friends spread across three fourballs is the case it exists for —
 * and says in its own comment that this is safe because "an ad-hoc name
 * resolves its audience to the whole field rather than to a group: there is no
 * set of players it can silently enter."
 *
 * True of the opt-out inference it was written about. False of the entrant
 * setter sitting beside it. `setSkinsEntrants` only narrows the list when the
 * key matches a group on the published sheet, so for an invented name it
 * narrowed nothing: one player could price "Sunday Special" at £500 a head and
 * write a confirmed stake for every confirmed player in the tournament. Forty
 * people owe £500 each in the settle-up and none of them agreed to anything.
 * The identical hole existed for derived pots, where `potAudience` returns the
 * whole field for an ad-hoc key by design.
 *
 * Confirming a stake somebody ASKED for is fine. Creating one on their behalf
 * is not.
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
import { saveSkinsPot, setSkinsEntrants, requestSkinsEntry } from "@/app/actions/skins";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ADHOC";
const KEY = "Sunday Special";

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const userIds: Record<string, string> = {};
const WHO = ["chancer", "mark", "ann", "rob"];

const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

async function signIn(who: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}

/** Confirmed stakes under the ad-hoc name, across every pot carrying it. */
async function stakedIn(): Promise<string[]> {
  const pots = await prisma.skinsPot.findMany({
    where: { stageId, groupKey: KEY },
    select: { entrants: { where: { confirmed: true }, select: { playerId: true } } },
  });
  return pots.flatMap((p) => p.entrants.map((e) => e.playerId));
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
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
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Skins", holes: 18 },
  });
  stageId = stage.id;

  for (const [i, who] of WHO.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed", handicap: 10 },
    });
    player[who] = p.id;
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
    userIds[who] = u.id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }
});

beforeEach(async () => {
  await prisma.skinsPot.deleteMany({ where: { stageId } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a player inventing a bet", () => {
  it("may still create one — that is the point of an ad-hoc name", async () => {
    // The guard must not close the door this feature exists for.
    await signIn("chancer");
    const res = await saveSkinsPot(stageId, {
      buyInCents: 50000,
      net: true,
      scope: "full",
      groupKey: KEY,
    });
    expect(res.ok, res.error ?? "").toBe(true);
  });

  it("may put THEMSELVES in it", async () => {
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 50000, net: true, scope: "full", groupKey: KEY });
    const res = await setSkinsEntrants(stageId, true, "full", [player.chancer], KEY);
    expect(res.ok, res.error ?? "").toBe(true);
    expect(await stakedIn()).toEqual([player.chancer]);
  });

  it("CANNOT stake the rest of the field in it", async () => {
    /**
     * The attack, in full. £500 a head, every confirmed player named.
     */
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 50000, net: true, scope: "full", groupKey: KEY });

    const everyone = WHO.map((w) => player[w]);
    const res = await setSkinsEntrants(stageId, true, "full", everyone, KEY);

    expect(res.ok, "staking the whole field must be refused").toBe(false);
    expect(res.error).toMatch(/hasn't asked|haven't asked/i);
  });

  it("writes no stake at all when it is refused", async () => {
    // A refusal that had already written half the rows would be worse than
    // no check: the money is what matters, not the message.
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 50000, net: true, scope: "full", groupKey: KEY });
    await setSkinsEntrants(stageId, true, "full", WHO.map((w) => player[w]), KEY);

    expect(await stakedIn()).toEqual([]);
  });

  it("cannot slip one stranger in beside themselves", async () => {
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 50000, net: true, scope: "full", groupKey: KEY });
    const res = await setSkinsEntrants(stageId, true, "full", [player.chancer, player.ann], KEY);
    expect(res.ok).toBe(false);
    expect(await stakedIn()).toEqual([]);
  });
});

describe("six friends who actually want the bet", () => {
  it("works once each of them has put their own name down", async () => {
    /**
     * The legitimate flow, and the reason the rule is "who asked" rather than
     * "only yourself": each player says they are in, and one of them ticks
     * everybody off. That is exactly what the pending-and-confirm machinery
     * is for, and `requestSkinsEntry` only ever writes its own caller.
     */
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 2000, net: true, scope: "full", groupKey: KEY });

    for (const who of ["mark", "ann"]) {
      await signIn(who);
      const asked = await requestSkinsEntry(stageId, true, "full", KEY, true);
      expect(asked.ok, asked.error ?? "").toBe(true);
    }

    await signIn("chancer");
    const res = await setSkinsEntrants(
      stageId,
      true,
      "full",
      [player.chancer, player.mark, player.ann],
      KEY,
    );
    expect(res.ok, res.error ?? "").toBe(true);
    expect((await stakedIn()).sort()).toEqual([player.chancer, player.mark, player.ann].sort());
  });

  it("still refuses the one who never asked", async () => {
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 2000, net: true, scope: "full", groupKey: KEY });
    await signIn("mark");
    await requestSkinsEntry(stageId, true, "full", KEY, true);

    await signIn("chancer");
    const res = await setSkinsEntrants(
      stageId,
      true,
      "full",
      [player.chancer, player.mark, player.rob],
      KEY,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/hasn't asked/i);
  });
});

describe("the organizer", () => {
  it("may still name anyone, because running the club's money is their job", async () => {
    await prisma.account.updateMany({
      where: { eventId, email: at("chancer") },
      data: { role: "admin" },
    });
    await signIn("chancer");
    await saveSkinsPot(stageId, { buyInCents: 2000, net: true, scope: "full", groupKey: KEY });

    const res = await setSkinsEntrants(stageId, true, "full", WHO.map((w) => player[w]), KEY);
    expect(res.ok, res.error ?? "").toBe(true);
    expect((await stakedIn()).length).toBe(WHO.length);

    await prisma.account.updateMany({
      where: { eventId, email: at("chancer") },
      data: { role: "player" },
    });
  });
});
