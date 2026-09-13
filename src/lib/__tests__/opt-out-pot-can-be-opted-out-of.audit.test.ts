import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * AN OPT-OUT POT HAS TO BE POSSIBLE TO OPT OUT OF.
 *
 * `potMembership` supports two modes and the second is the interesting one:
 * in an opt-out pot "everyone PLAYING" is in, and a player is out only if a
 * row says so. Every piece of that exists — the `excluded` column, the
 * `potMembership` rule, `setPotExcluded` (organizer-only, id-scoped to the
 * tournament, audited), and an `excluded` list threaded all the way into
 * `ContestsClient`'s props.
 *
 * Nothing calls it. Found on 2026-09-13 by sweeping every `"use server"`
 * export for one that no other file in the repo references: `setPotExcluded`
 * was one of eight, and the only one that leaves a user-facing rule with no
 * way to exercise it. The same shape as `removeSettlement`, which this
 * codebase already records as having "shipped fully authorized and
 * audit-tested and wired to no screen at all".
 *
 * WHAT THE ORGANIZER ACTUALLY HAS is the "In the pot" chip grid, which calls
 * `setContestEntrants`. In an opt-in pot that is exactly right. In an opt-out
 * pot it cannot work, and the reason is in `setContestEntrants`' own comment:
 * an exclusion row "is the only record of that decision, and in an opt-out pot
 * a player with no row is in and settled". Passing everyone-but-one leaves
 * that one with NO row — so they are still in, and the chip springs back.
 *
 * These assert the RULE, not the current behaviour: an organizer who takes
 * somebody out of a pot has taken them out of it.
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
import { setContestEntrants } from "@/app/actions/contests";
import { setPotExcluded } from "@/app/actions/money-setup";
import { potMembership } from "@/lib/domain/pot-entry";
import { readSource } from "./source";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-OPTOUT";

let eventId = "";
let contestId = "";
const players: Array<{ id: string; name: string }> = [];

/** Who the pot currently holds, read the way every screen reads it. */
async function inThePot() {
  const rows = await prisma.contestEntry.findMany({
    where: { contestId },
    select: { playerId: true, confirmed: true, excluded: true },
  });
  const fieldIds = players.map((p) => p.id);
  return potMembership("opt-out", fieldIds, rows, fieldIds);
}

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} outing`,
      organizationId: org.id,
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
    },
    select: { id: true },
  });
  eventId = ev.id;

  for (let i = 0; i < 4; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} P${i + 1}`,
          email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`,
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true, name: true },
      }),
    );
  }

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    select: { id: true },
  });

  // A £5 closest-to-the-pin that the whole field is in by default.
  const contest = await prisma.contest.create({
    data: { eventId, stageId: stage.id, kind: "closest-pin", name: `${TAG} KP`, hole: 7, buyInCents: 500, entryMode: "opt-out" },
    select: { id: true },
  });
  contestId = contest.id;

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable" },
    select: { id: true },
  });
  await prisma.account.create({ data: { eventId, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" } });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

describe("taking somebody out of an opt-out pot", () => {
  it("starts with the whole field in, which is what opt-out means", async () => {
    const m = await inThePot();
    expect(m.entrants.length, "an opt-out pot should hold everyone playing").toBe(4);
  });

  it("actually removes them", async () => {
    /**
     * THE RULE. An organizer who takes somebody out of a pot has taken them
     * out of it — the money follows directly, because the pot is priced at the
     * buy-in times the number of entrants and the settle-up charges each of
     * them.
     *
     * Asserted through `setPotExcluded`, which is the action written for this
     * and is what the screen must call. Before this was wired to anything,
     * nothing in the app could make this assertion pass.
     */
    const victim = players[2];
    const res = await setPotExcluded("contest", contestId, victim.id, true);
    expect(res.ok, res.error).toBe(true);

    const m = await inThePot();
    expect(m.entrants).not.toContain(victim.id);
    expect(m.entrants.length).toBe(3);
    expect(m.excluded).toContain(victim.id);
  });

  it("puts them back when the organizer changes their mind", async () => {
    // The other direction, and the one that decides whether this is a control
    // or a trapdoor.
    const victim = players[2];
    const res = await setPotExcluded("contest", contestId, victim.id, false);
    expect(res.ok, res.error).toBe(true);

    const m = await inThePot();
    expect(m.entrants).toContain(victim.id);
    expect(m.entrants.length).toBe(4);
    expect(m.excluded).toEqual([]);
  });

  it("is not what the entrant setter does, which is why the screen needed it", async () => {
    /**
     * THE MEASUREMENT THIS FILE WAS WRITTEN FOR, kept as an assertion.
     *
     * The chip grid calls `setContestEntrants` with everyone-but-one. In an
     * opt-in pot that removes them. In an opt-out pot it cannot: the comment
     * inside that action says an excluded row "is the only record of that
     * decision, and in an opt-out pot a player with no row is in and settled",
     * and passing everyone-but-one leaves that one with no row.
     *
     * So the chip appeared to work, did nothing, and sprang back on the next
     * render. This pins WHY a separate action is needed rather than leaving
     * the next person to rediscover it.
     */
    const victim = players[1];
    const everyoneElse = players.filter((p) => p.id !== victim.id).map((p) => p.id);
    const res = await setContestEntrants(contestId, everyoneElse);
    expect(res.ok, res.error).toBe(true);

    const m = await inThePot();
    expect(
      m.entrants,
      "the entrant setter removed somebody from an opt-out pot — if this is now true the screen can use it and this file is obsolete",
    ).toContain(victim.id);
  });
});

describe("the screen calls the action that can do it", () => {
  /**
   * The half the database cannot see. Everything above proves `setPotExcluded`
   * works and that the entrant setter is not a substitute for it — and both
   * were already true on the day the bug was found. What was missing is that
   * anything called it.
   *
   * Read through `readSource`, which strips comments: the note explaining this
   * change names both actions and would otherwise satisfy every assertion here
   * on its own. That is the trap `source-guard.test.ts` exists for.
   */
  const client = () => readSource("src", "components", "ContestsClient.tsx");

  it("reaches for setPotExcluded, from something that actually runs", () => {
    /**
     * BOTH HALVES. The first attempt at this file asserted only that the
     * helper existed and branched correctly — and a mutation that unwired both
     * chips left the helper sitting there, unreferenced, with two of the three
     * assertions still green. A helper nothing calls is the exact bug this
     * whole file is about, one level up.
     */
    const src = client();
    expect(src, "nothing in the app calls the exclusion action").toContain("setPotExcluded(");
    expect(
      src.split("togglePot(\"").length - 1,
      "the helper is defined but no chip calls it",
    ).toBeGreaterThan(1);
  });

  it("chooses between the two writes on the pot's own mode", () => {
    const src = client();
    const helper = src.slice(src.indexOf("const togglePot"), src.indexOf("const modeToggle"));
    expect(helper, "the helper is gone").not.toBe("");
    // And reachable, for the reason above: the branches only matter if
    // something runs them.
    expect(src.split("togglePot(\"").length - 1).toBeGreaterThan(1);
    expect(helper).toContain('mode === "opt-out"');
    expect(helper).toContain("setPotExcluded(");
    // And still sets entrants in the other mode, which is correct there.
    expect(helper).toContain("setEntrants(");
  });

  it("routes both pots through it, not just the contest one", () => {
    /**
     * A side game has the same two modes and the same `excluded` column, so
     * fixing one chip and not the other would leave the identical bug on the
     * half of the screen a fourball actually uses.
     */
    const src = client();
    expect(src).toContain('togglePot("contest"');
    expect(src).toContain('togglePot("sideGame"');
    // Neither chip writes entrants directly any more — that is what let the
    // opt-out case call the wrong action.
    expect(src, "a chip is still calling the entrant setter itself").not.toMatch(
      /run\(\(\) => setContestEntrants\(/,
    );
    expect(src).not.toMatch(/run\(\(\) => setSideGameEntrants\(/);
  });
});
