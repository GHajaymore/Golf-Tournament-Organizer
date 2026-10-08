import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A POT IS NOT SETTLED WHILE ITS PLAYERS ARE STILL IN THE CLUBHOUSE (2026-10-08).
 *
 * A field of eight going out in two waves. The morning four finish — Ann
 * birdies the 1st, everything else is level — and the afternoon four have not
 * hit a shot, so they have no card at all. Every money check asked whether the
 * cards that EXIST were complete, and four complete cards are complete: Ann's
 * money screen read "You're owed $70.00" with seven "Mark settled" buttons,
 * four of them against players any one of whom can birdie the 1st and halve
 * her skin. `money-layout.ts`: ask "can the amount still change". Yes.
 *
 * The controls matter as much, because the cheap fix is wrong:
 *
 *   - a FOURBALL's own game is settled by the fourball. Nobody outside it can
 *     change it, so it must not wait for the last group of the day;
 *   - a member who has WITHDRAWN does not hold anything open;
 *   - the committee closing the round releases a no-show.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TWOWAVES";
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const NAMES = ["ann", "bea", "cat", "dot", "eve", "fay", "gus", "hal"] as const;
type Who = (typeof NAMES)[number];

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { moneyFor, roundMoneyFor } = await import("@/lib/services/expenses");
const { skinsPotFor } = await import("@/lib/services/skins-pot");

let eventId = "";
let stageId = "";
const id = {} as Record<Who, string>;
const email = (w: Who) => `${TAG}.${w}@example.invalid`.toLowerCase();

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const level = () => JSON.stringify(PARS);
const birdieOnFirst = () => JSON.stringify(PARS.map((p, i) => (i === 0 ? p - 1 : p)));

async function card(w: Who, strokes: string) {
  await prisma.scorecard.create({ data: { eventId, stageId, playerId: id[w], strokes, status: "entered" } });
}
/** The morning wave in: Ann birdies the 1st, the rest level. */
async function morning() {
  await card("ann", birdieOnFirst());
  for (const w of ["bea", "cat", "dot"] as const) await card(w, level());
}
async function afternoon() {
  for (const w of ["eve", "fay", "gus", "hal"] as const) await card(w, level());
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      shape: "single",
      moneyMode: "split",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  for (const [i, w] of NAMES.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${w}`, email: email(w), seed: i + 1, status: "confirmed", handicap: 10 },
    });
    id[w] = p.id;
  }
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Individual Stroke Play",
      holes: 18,
      scoringBasis: "gross",
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Morning", startHole: 1, time: "8:00 AM", playerIds: [id.ann, id.bea, id.cat, id.dot] },
          { name: "Afternoon", startHole: 1, time: "1:00 PM", playerIds: [id.eve, id.fay, id.gus, id.hal] },
        ],
      }),
      teeSheetPublished: true,
    },
  });
  stageId = stage.id;
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { eventId } });
  await prisma.skinsPot.deleteMany({ where: { eventId } });
  await prisma.sideGame.deleteMany({ where: { eventId } });
  await prisma.player.updateMany({ where: { eventId }, data: { status: "confirmed" } });
  await prisma.stage.update({ where: { id: stageId }, data: { closedAt: null } });
  session = null;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** The field's $10 gross skins, all eight in. */
async function fieldSkins() {
  const pot = await prisma.skinsPot.create({ data: { eventId, stageId, buyInCents: 1000, net: false } });
  await prisma.skinsEntry.createMany({ data: NAMES.map((w) => ({ potId: pot.id, playerId: id[w], confirmed: true })) });
}

describe("the field's skins, half the field still to go out", () => {
  it("are not settled — nobody is owed anything yet", async () => {
    await fieldSkins();
    await morning();
    const view = await skinsPotFor(eventId, stageId, false, "full", "");
    expect(view?.result?.provisional, "a pot with four entrants still to tee off is a result").toBe(true);
    expect(view?.transfers).toEqual([]);
    const ann = await moneyFor(eventId, email("ann"));
    expect(ann.gamesCents, "Ann is shown money four players can still take off her").toBe(0);
    expect(ann.transfers).toEqual([]);
  });

  it("settle once the afternoon is in — the control", async () => {
    await fieldSkins();
    await morning();
    await afternoon();
    // $80 pot, Ann the only skin: +$70, everyone else -$10.
    expect((await moneyFor(eventId, email("ann"))).gamesCents).toBe(7000);
    expect((await moneyFor(eventId, email("hal"))).gamesCents).toBe(-1000);
  });

  it("do not wait for a player who has withdrawn", async () => {
    await fieldSkins();
    await morning();
    // The afternoon withdrew — gone, not coming. Their stakes stay in (see
    // `skinsPotFor`), and nothing they could do is still to come.
    await prisma.player.updateMany({ where: { id: { in: [id.eve, id.fay, id.gus, id.hal] } }, data: { status: "withdrawn" } });
    expect((await moneyFor(eventId, email("ann"))).gamesCents).toBe(7000);
  });

  it("are released by the committee closing the round over a no-show", async () => {
    await fieldSkins();
    await morning();
    await afternoon();
    await prisma.scorecard.deleteMany({ where: { eventId, playerId: id.hal } });
    expect((await moneyFor(eventId, email("ann"))).gamesCents, "Hal never teed off: held").toBe(0);
    await prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
    // $80 pot (Hal's stake is in), Ann's one skin: +$70.
    expect((await moneyFor(eventId, email("ann"))).gamesCents).toBe(7000);
  });
});

describe("the field's birdie pot, the same", () => {
  async function birdiePot(groupKey = "") {
    await prisma.sideGame.create({ data: { eventId, stageId, kind: "birdies", buyInCents: 500, entryMode: "opt-out", groupKey } });
  }

  it("is not settled with the afternoon to go", async () => {
    await birdiePot();
    await morning();
    expect((await moneyFor(eventId, email("ann"))).gamesCents).toBe(0);
  });

  it("is settled once they are in — the control", async () => {
    await birdiePot();
    await morning();
    await afternoon();
    // $40 pot, Ann's the only birdie: +$35.
    expect((await moneyFor(eventId, email("ann"))).gamesCents).toBe(3500);
  });

  it("but a fourball's own pot settles on the fourball", async () => {
    // Nobody in the afternoon can change the morning group's game.
    await birdiePot("Morning");
    await morning();
    // $20 pot among the four, Ann's birdie: +$15.
    expect((await moneyFor(eventId, email("ann"))).gamesCents).toBe(1500);
  });
});

describe("the round card on Money", () => {
  it("says the round is not final until the whole field is in", async () => {
    await fieldSkins();
    await morning();
    session = null;
    const before = await roundMoneyFor(eventId, email("ann"));
    expect(before.rounds.find((r) => r.stageId === stageId)?.final).toBe(false);
    await afternoon();
    const after = await roundMoneyFor(eventId, email("ann"));
    expect(after.rounds.find((r) => r.stageId === stageId)?.final).toBe(true);
  });
});
