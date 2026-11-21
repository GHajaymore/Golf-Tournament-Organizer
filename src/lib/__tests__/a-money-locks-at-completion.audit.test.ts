import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WHAT MONEY OFFERED LOCKS AT COMPLETION, AND THE LEDGER NEVER DOES (state machine PR L; Ajay, 19 Nov 2026).
 *
 * Driven through the real actions against real rows, as the Organizer would press them. A LIVE tournament takes every
 * offer-side press (nothing about money locks at launch — the control). Once COMPLETED, each one comes back
 * `{ ok: false }` with the machine's reason and way out in the Organizer's words, the lock it came from, and nothing
 * written. The ledger beside them — awarding a prize, who has won a contest, the kitty — still works on the completed
 * tournament, because settling up happens after the result is final. Reopen unlocks the offer side again.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { addPrize, updatePrize, removePrize, applyPrizeStructure, setOnePrizePerPlayer, setPrizeCounts, setPrizeWinner } from "@/app/actions/tournament";
import { addContest, removeContest, setContestWinners, setContestEntrants } from "@/app/actions/contests";
import { saveSkinsPot, removeSkinsPot, setSkinsEntrants } from "@/app/actions/skins";
import { saveSideGame, removeSideGame } from "@/app/actions/side-games";
import { setEventMoneyMode, setPotEntryMode, addFundLine } from "@/app/actions/money-setup";
import { PRIZE_STRUCTURES } from "@/lib/domain/prize-structures";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PRL";

let eventId = "";
let stageId = "";
let playerId = "";
let prizeId = "";
let contestId = "";
let sideGameId = "";

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} medal`,
      organizationId: org.id,
      status: "live",
      launchedAt: new Date(),
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      moneyMode: "split",
    },
    select: { id: true },
  });
  eventId = ev.id;
  stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 }, select: { id: true } })).id;
  playerId = (
    await prisma.player.create({
      data: { eventId, name: `${TAG} player`, email: `${TAG.toLowerCase()}-player@example.invalid`, seed: 1, status: "confirmed", handicap: 10 },
      select: { id: true },
    })
  ).id;
  prizeId = (await prisma.prize.create({ data: { eventId, position: 1, category: `${TAG} Best gross`, amount: 50 }, select: { id: true } })).id;
  contestId = (await prisma.contest.create({ data: { eventId, stageId, kind: "closest-pin", name: `${TAG} closest`, buyInCents: 500, createdBy: "zz" }, select: { id: true } })).id;
  sideGameId = (await prisma.sideGame.create({ data: { eventId, stageId, kind: "birdies", buyInCents: 500, groupKey: "", createdBy: "zz" }, select: { id: true } })).id;
  await prisma.skinsPot.create({ data: { eventId, stageId, net: true, scope: "full", groupKey: "", buyInCents: 500 } });

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.account.create({ data: { eventId, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" } });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** Everything a refused offer-side press could have written. */
async function snapshot() {
  const [prizes, contests, sideGames, pots, event] = await Promise.all([
    prisma.prize.findMany({ where: { eventId }, select: { id: true, category: true, amount: true, countsForOnePrize: true }, orderBy: { id: "asc" } }),
    prisma.contest.findMany({ where: { eventId }, select: { id: true, entryMode: true }, orderBy: { id: "asc" } }),
    prisma.sideGame.findMany({ where: { eventId }, select: { id: true, buyInCents: true }, orderBy: { id: "asc" } }),
    prisma.skinsPot.findMany({ where: { eventId }, select: { id: true, buyInCents: true }, orderBy: { id: "asc" } }),
    prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { moneyMode: true, onePrizePerPlayer: true } }),
  ]);
  return { prizes, contests, sideGames, pots, event };
}

const DONE = (what: string) => `Locked because the tournament is completed. Reopen it on the dashboard to ${what}.`;

type Press = { name: string; what: string; press: () => Promise<{ ok: boolean; error?: string; lock?: { scope: string; by: string } } | undefined> };
const OFFERS: Press[] = [
  { name: "addPrize", what: "change the prizes", press: () => addPrize(`${TAG} Best net`, 30) },
  { name: "updatePrize", what: "change the prizes", press: () => updatePrize(prizeId, { amount: 99 }) },
  { name: "removePrize", what: "change the prizes", press: () => removePrize(prizeId) },
  { name: "applyPrizeStructure", what: "change the prizes", press: () => applyPrizeStructure(PRIZE_STRUCTURES[0].key) },
  { name: "setOnePrizePerPlayer", what: "change the one-prize rule", press: () => setOnePrizePerPlayer(true) },
  { name: "setPrizeCounts", what: "change the one-prize rule", press: () => setPrizeCounts(prizeId, false) },
  { name: "addContest", what: "add a contest", press: () => addContest({ kind: "long-drive", name: `${TAG} drive`, buyInCents: 100, stageId }) },
  { name: "removeContest", what: "remove a contest", press: () => removeContest(contestId) },
  { name: "saveSkinsPot", what: "change a skins game", press: () => saveSkinsPot(stageId, { buyInCents: 900, net: true, scope: "full", groupKey: "" }) },
  { name: "removeSkinsPot", what: "remove a skins game", press: () => removeSkinsPot(stageId, true, "full", "") },
  { name: "saveSideGame", what: "change a side game", press: () => saveSideGame(stageId, "birdies", 900, "") },
  { name: "removeSideGame", what: "remove a side game", press: () => removeSideGame(sideGameId) },
  { name: "setEventMoneyMode", what: "change how money is handled", press: () => setEventMoneyMode("float") },
  { name: "setPotEntryMode", what: "change how a pot is entered", press: () => setPotEntryMode("contest", contestId, "opt-out") },
];

describe("money's offer side shuts at completion, and the ledger does not (PR L)", () => {
  it("CONTROL: live, an offer-side press goes through — nothing about money locks at launch", async () => {
    const r = await addPrize(`${TAG} Live prize`, 10);
    expect(r).toEqual({ ok: true });
    expect(await saveSideGame(stageId, "birdies", 700, "")).toMatchObject({ ok: true });
    expect(await setEventMoneyMode("split")).toEqual({ ok: true });
    await prisma.prize.deleteMany({ where: { eventId, category: `${TAG} Live prize` } });
    await prisma.sideGame.updateMany({ where: { eventId }, data: { buyInCents: 500 } });
  });

  it("completed: every offer-side press is refused in the Organizer's words, from the money lock, with nothing written", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
    const before = await snapshot();
    for (const p of OFFERS) {
      const r = await p.press();
      expect(r, `${p.name} answered nothing`).toBeDefined();
      expect(r!.ok, `${p.name} was not refused`).toBe(false);
      expect(r!.error, p.name).toBe(DONE(p.what));
      expect(r!.lock, p.name).toMatchObject({ scope: "money", by: "completed" });
    }
    expect(await snapshot(), "a refused press wrote something").toEqual(before);
  });

  it("completed: the ledger still works — awarding a prize, who is in and who won a contest, the kitty", async () => {
    expect(await setPrizeWinner(prizeId, playerId)).toEqual({ ok: true });
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prizeId } })).winnerId).toBe(playerId);
    expect(await setContestEntrants(contestId, [playerId])).toMatchObject({ ok: true });
    expect(await setContestWinners(contestId, [playerId])).toMatchObject({ ok: true });
    expect(await addFundLine({ direction: "in", description: `${TAG} entry fees`, amount: "25" })).toEqual({ ok: true });
    expect(await prisma.tournamentFund.count({ where: { eventId } })).toBe(1);
  });

  it("completed: naming entrants for a pot that is not there would START it, so it is refused; for a pot that is there it still saves", async () => {
    const pots = () => prisma.skinsPot.count({ where: { eventId } });
    const before = await pots();
    const started = await setSkinsEntrants(stageId, false, "full", [playerId], "");
    expect(started).toMatchObject({ ok: false, error: DONE("start a skins game"), lock: { scope: "money", by: "completed" } });
    expect(await pots(), "a pot was created on a completed tournament").toBe(before);
    expect(await setSkinsEntrants(stageId, true, "full", [playerId], "")).toEqual({ ok: true });
    expect(await prisma.skinsEntry.count({ where: { pot: { eventId }, playerId } })).toBe(1);
    expect(await pots()).toBe(before);
  });

  it("Reopen unlocks the offer side again", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: "live" } });
    expect(await updatePrize(prizeId, { amount: 60 })).toEqual({ ok: true });
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prizeId } })).amount).toBe(60);
  });
});
