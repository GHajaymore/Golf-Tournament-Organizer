import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

let session: { email: string; name: string; eventId: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createMatch } = await import("@/app/actions/match-setup");
const { moneyFor } = await import("@/lib/services/expenses");
const { saveSideGame } = await import("@/app/actions/side-games");
const { saveSkinsPot } = await import("@/app/actions/skins");

/**
 * "We're playing for a pint" reaches the database as a game with no money in
 * it — and stays that way.
 *
 * Most Sunday golf is played for something that is not currency: a pint, lunch,
 * the next green fee, pride. The setup screen had one box, marked in money, and
 * `planMatch` refused a game with no stake in it — so a fourball agreeing a
 * round of drinks either invented a figure nobody said or left the game off the
 * round and kept it on a scorecard in somebody's pocket.
 *
 * WHY AN AUDIT TEST AND NOT THE UNIT SUITE NEXT DOOR. `quick-match.test.ts`
 * already asserts what `planMatch` decides, against values. What this proves is
 * the WIRING — that the decision survives the action, lands on a real row, and
 * that the money engine reading that row pays nobody. That is the join the
 * derived pots were stranded on twice, both times with the pure function
 * perfectly correct.
 *
 * THE THIRD TEST IS THE ONE THAT MATTERS. A game carries money or a note saying
 * what is being played for instead — never both, because both is two different
 * agreements about the same bet. That is enforced where the stake is WRITTEN
 * rather than checked by each reader, so a caller written later cannot store
 * the contradiction by forgetting a rule it has never heard of.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PINT";
const EMAIL = `${TAG}-owner@example.invalid`.toLowerCase();

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

let organizationId = "";
let courseId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({
    data: { email: EMAIL, name: `${TAG} owner` },
    select: { id: true },
  });
  const org = await prisma.organization.create({
    data: { name: `${TAG} personal`, kind: "personal" },
    select: { id: true },
  });
  organizationId = org.id;
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, role: "owner" },
  });
  const course = await prisma.course.create({
    data: {
      organizationId,
      name: `${TAG} course`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  courseId = course.id;
  session = { email: EMAIL, name: `${TAG} owner`, eventId: "", role: "admin", viewRole: "admin" };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Set a round up through the real action, and hand back what it wrote. */
async function roundFor(name: string, money: { game: string; stakeCents: number; stakeNote?: string }) {
  const res = await createMatch({
    players: [
      { name: `${TAG} ${name} one` },
      { name: `${TAG} ${name} two` },
    ],
    format: "Match Play",
    holes: 18,
    courseId,
    name: `${TAG} ${name}`,
    money,
  });
  expect(res.ok, `the round should be created: ${"error" in res ? res.error : ""}`).toBe(true);
  const event = await prisma.event.findFirst({
    where: { name: `${TAG} ${name}` },
    select: { id: true, stages: { select: { id: true } }, players: { select: { id: true, email: true } } },
  });
  expect(event, "the round exists").not.toBeNull();
  return event!;
}

describe("a round played for a pint", () => {
  it("writes the game, with the stake said in words and no money on it", async () => {
    const event = await roundFor("pint", { game: "birdies", stakeCents: 0, stakeNote: "a pint" });

    const game = await prisma.sideGame.findFirst({
      where: { eventId: event.id },
      select: { kind: true, buyInCents: true, stakeNote: true },
    });
    expect(game, "the game is created, not silently dropped").not.toBeNull();
    expect(game!.kind).toBe("birdies");
    expect(game!.stakeNote, "in the words they agreed").toBe("a pint");
    expect(game!.buyInCents, "and nothing anybody owes").toBe(0);
  });

  it("and the money engine pays nobody for it", async () => {
    /**
     * THE SAFETY PROPERTY, asked of the thing that actually decides. Every
     * settler returns nothing at a zero stake already, so this ought to hold
     * without anything new — and "ought to" is exactly the reasoning that
     * stranded a real birdie pot twice. Asked rather than assumed.
     */
    const event = await roundFor("pint2", { game: "birdies", stakeCents: 0, stakeNote: "a pint" });
    const players = event.players.filter((p) => p.email);
    for (const p of players) {
      const owed = await moneyFor(event.id, p.email!);
      expect(owed.gamesCents, `${p.email} owes and is owed nothing`).toBe(0);
    }
  });

  it("stops being a pint the moment somebody puts a stake on it", async () => {
    /**
     * THE INVARIANT, enforced at the WRITE.
     *
     * A game holds money or a note saying what is being played for instead.
     * Both at once is two different agreements about one bet, and there is no
     * honest way to resolve it afterwards: reading the money ignores what the
     * players said, and reading the note loses a figure somebody typed.
     *
     * So `saveSideGame` clears the note whenever it writes a stake. Checked
     * here through the real action rather than by reading the source, because
     * the thing that must be true is about the ROW.
     */
    const event = await roundFor("switch", { game: "birdies", stakeCents: 0, stakeNote: "a pint" });
    const stageId = event.stages[0].id;
    session = { email: EMAIL, name: `${TAG} owner`, eventId: event.id, role: "admin", viewRole: "admin" };

    const saved = await saveSideGame(stageId, "birdies", 500);
    expect(saved.ok, saved.error).toBe(true);

    const game = await prisma.sideGame.findFirst({
      where: { eventId: event.id },
      select: { buyInCents: true, stakeNote: true },
    });
    expect(game!.buyInCents, "the stake they typed").toBe(500);
    expect(game!.stakeNote, "and the pint is gone, rather than sitting beside it").toBe("");
  });

  it("can also be started mid-round, on the screen nearest to where it is agreed", async () => {
    /**
     * The same agreement, made three holes in.
     *
     * A round could be set up for a pint while the bet started halfway down
     * the 9th fairway could only be priced in cash — the same thing refused on
     * the screen NEARER to where people actually decide it. `saveSideGame` and
     * `saveSkinsPot` take the note now, and both apply the same rule at the
     * write: a stake wins, a note stands where there is no stake.
     */
    const event = await roundFor("adhoc", { game: "birdies", stakeCents: 500 });
    const stageId = event.stages[0].id;
    session = { email: EMAIL, name: `${TAG} owner`, eventId: event.id, role: "admin", viewRole: "admin" };

    const eagles = await saveSideGame(stageId, "eagles", 0, "zz-back nine", "lunch");
    expect(eagles.ok, eagles.error).toBe(true);
    const game = await prisma.sideGame.findFirst({
      where: { eventId: event.id, kind: "eagles" },
      select: { buyInCents: true, stakeNote: true },
    });
    expect(game!.stakeNote).toBe("lunch");
    expect(game!.buyInCents).toBe(0);

    const pot = await saveSkinsPot(stageId, {
      buyInCents: 0,
      net: true,
      scope: "full",
      groupKey: "zz-back nine",
      stakeNote: "lunch",
    });
    expect(pot.ok, pot.error).toBe(true);
    const skins = await prisma.skinsPot.findFirst({
      where: { eventId: event.id, groupKey: "zz-back nine" },
      select: { buyInCents: true, stakeNote: true },
    });
    expect(skins!.stakeNote).toBe("lunch");
    expect(skins!.buyInCents).toBe(0);
  });

  it("and a stake beats a note there too, rather than storing both", async () => {
    /**
     * THE INVARIANT AT THE WRITE, asked of the other door into it. Both at
     * once is two different agreements about one bet, and the rule cannot live
     * in one caller — a screen written later would not know it existed.
     */
    const event = await roundFor("both", { game: "birdies", stakeCents: 500 });
    const stageId = event.stages[0].id;
    session = { email: EMAIL, name: `${TAG} owner`, eventId: event.id, role: "admin", viewRole: "admin" };

    await saveSideGame(stageId, "eagles", 250, "zz-crew", "a pint");
    const game = await prisma.sideGame.findFirst({
      where: { eventId: event.id, kind: "eagles" },
      select: { buyInCents: true, stakeNote: true },
    });
    expect(game!.buyInCents, "the money they typed").toBe(250);
    expect(game!.stakeNote, "and no pint beside it").toBe("");

    await saveSkinsPot(stageId, {
      buyInCents: 250,
      net: true,
      scope: "full",
      groupKey: "zz-crew",
      stakeNote: "a pint",
    });
    const skins = await prisma.skinsPot.findFirst({
      where: { eventId: event.id, groupKey: "zz-crew" },
      select: { buyInCents: true, stakeNote: true },
    });
    expect(skins!.buyInCents).toBe(250);
    expect(skins!.stakeNote).toBe("");
  });

  it("still refuses a game with neither a stake nor a word about it", async () => {
    // THE ASSERTION THAT STOPS THIS BECOMING "ALLOW A ZERO STAKE". A pot
    // somebody believes they are in, worth nothing, is the failure the
    // original refusal was written for and it is still a failure.
    const res = await createMatch({
      players: [{ name: `${TAG} none one` }, { name: `${TAG} none two` }],
      format: "Match Play",
      holes: 18,
      courseId,
      name: `${TAG} none`,
      money: { game: "birdies", stakeCents: 0 },
    });
    expect(res.ok).toBe(false);
    expect(await prisma.event.count({ where: { name: `${TAG} none` } }), "and creates nothing").toBe(0);
  });
});
