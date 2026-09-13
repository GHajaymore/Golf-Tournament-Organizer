import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A POT WITH MONEY IN IT IS EMPTIED BEFORE IT IS DELETED.
 *
 * `removeSideGame` was the last of the four unreachable actions the
 * reachability guard found (#339), and giving it a button is what turned a
 * theoretical hazard into a real one: `SideGameEntry.sideGameId` CASCADES, so
 * deleting the game deletes every stake with it — including the confirmed
 * ones, which are the record that somebody handed over cash.
 *
 * One tap, on a screen four friends share, and nothing is left saying who
 * paid what.
 *
 * So the refusal lives on the ACTION rather than beside the button: the rule
 * is about the data, and a caller written later cannot forget a rule it never
 * has to remember. The remedy is in the refusal and is two taps away — take
 * the paid players out of the pot, which is what actually hands their money
 * back, and the empty pot can then go.
 *
 * An UNCONFIRMED entry is an intention rather than a stake — this file and
 * every pot screen already agree about that — so it does not hold the pot
 * open.
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
import { removeSideGame } from "@/app/actions/side-games";
import { readSource } from "./source";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-POTDELETE";

let eventId = "";
let stageId = "";
const players: string[] = [];

async function makeGame(kind: string) {
  const g = await prisma.sideGame.create({
    data: { eventId, stageId, kind, groupKey: "", buyInCents: 500 },
    select: { id: true },
  });
  return g.id;
}

const exists = async (id: string) => (await prisma.sideGame.count({ where: { id } })) > 0;

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
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    select: { id: true },
  });
  stageId = stage.id;

  for (let i = 0; i < 3; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} P${i + 1}`,
        email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    players.push(p.id);
  }

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable" },
    select: { id: true },
  });
  await prisma.account.create({
    data: { eventId, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

describe("taking a side game off a round", () => {
  it("removes an empty one", async () => {
    // The control. Without it every assertion below could pass against an
    // action that simply never deletes anything.
    const id = await makeGame("birdies");
    const res = await removeSideGame(id);
    expect(res.ok, res.error).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it("refuses one somebody has paid into", async () => {
    const id = await makeGame("eagles");
    await prisma.sideGameEntry.create({
      data: { sideGameId: id, playerId: players[0], confirmed: true, excluded: false },
    });

    const res = await removeSideGame(id);
    expect(res.ok, "a pot holding real money was deleted").toBe(false);
    expect(await exists(id), "the pot went anyway").toBe(true);
  });

  it("says how many have paid, and what to do instead", async () => {
    /**
     * A refusal that does not say the way out is a dead end — the idiom this
     * codebase uses everywhere else, from `resolveThirdPlace` to the draw
     * button. The count matters too: "2 players have paid" is checkable
     * against the chips on the screen, and "you can't do that" is not.
     */
    const id = await makeGame("low-gross");
    for (const p of players.slice(0, 2)) {
      await prisma.sideGameEntry.create({
        data: { sideGameId: id, playerId: p, confirmed: true, excluded: false },
      });
    }
    const res = await removeSideGame(id);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("2 players");
    expect(res.error, "the refusal does not say the way out").toMatch(/take them out of the pot/i);
  });

  it("lets it go once the money is out", async () => {
    /**
     * THE WAY THROUGH, and the reason refusing is reasonable rather than
     * obstructive. Un-ticking the payers is what hands their money back; the
     * pot is then an ordinary empty one.
     */
    const id = await makeGame("low-net");
    await prisma.sideGameEntry.create({
      data: { sideGameId: id, playerId: players[0], confirmed: true, excluded: false },
    });
    expect((await removeSideGame(id)).ok).toBe(false);

    await prisma.sideGameEntry.deleteMany({ where: { sideGameId: id } });
    const res = await removeSideGame(id);
    expect(res.ok, res.error).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it("does not count an unconfirmed name as money", async () => {
    /**
     * "A name in the app is an intention, and only cash is a stake" — this
     * app's own words, on the screens that show these pots. Holding a pot open
     * for somebody who has not paid would make it undeletable by anyone but
     * the person who asked to join.
     */
    const id = await makeGame("twos");
    await prisma.sideGameEntry.create({
      data: { sideGameId: id, playerId: players[0], confirmed: false, excluded: false },
    });
    const res = await removeSideGame(id);
    expect(res.ok, res.error).toBe(true);
    expect(await exists(id)).toBe(false);
  });
});

describe("the screens that reach them", () => {
  it("offers the delete, and only once the game exists", () => {
    /**
     * A row with no game behind it is an OFFER — a stake box waiting to be
     * filled in — not a thing to delete. Read through `readSource`, which
     * strips comments: the note explaining this change names the action.
     */
    const src = readSource("src", "components", "ContestsClient.tsx");
    expect(src, "nothing reaches removeSideGame").toContain("removeSideGame(");
    const block = src.slice(src.indexOf("removeSideGame(") - 700, src.indexOf("removeSideGame(") + 100);
    expect(block, "the delete is offered on a row with no game").toContain("{game && (");
    expect(block, "a pot is deleted without asking").toContain("ConfirmButton");
  });

  it("lets a side be renamed in place", () => {
    /**
     * `renameTeam` was reachable from nothing, so the only way to change
     * "Team 3" to "The Wanderers" was to delete the side and rebuild it,
     * re-adding every member.
     */
    const src = readSource("src", "components", "TeamsClient.tsx");
    expect(src).toContain("renameTeam(");
    // A blank must not be sent — the action refuses it, and the input puts the
    // old name back rather than leaving the field empty on screen.
    const block = src.slice(src.indexOf("renameTeam(") - 500, src.indexOf("renameTeam(") + 60);
    expect(block).toContain("e.target.value = t.name");
  });
});
