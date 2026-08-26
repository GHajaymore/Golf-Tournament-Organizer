import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Taking a player out of a tournament.
 *
 * D3 of the 2026-08-12 audit had two halves. The first was in the browser: one
 * `selected` Set shared by the confirmed, waitlist and pending tables, and a
 * button that counted only the rows in front of you — tick three confirmed and
 * two waitlisted, press "Delete 2 selected", lose all five. That half is fixed
 * where it lives and asserted in the component.
 *
 * This is the second half, which is the one that cannot be undone.
 * `removeSignup` hard-deletes the `Player` row, and `Scorecard.playerId` /
 * `Match.playerAId` / `Match.playerBId` are plain String columns with no
 * relation and no cascade — so removing someone mid-event left their scorecard
 * and every match they played pointing at a person who no longer exists. The
 * schema has documented `status "withdrawn"` as the intended soft path since
 * it was written, and nothing ever set it.
 *
 * Excluded from the default run — needs a live DATABASE_URL and writes rows,
 * all of which are deleted in afterAll.
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
import { removeSignup, removeSignups } from "@/app/actions/tournament";
import { loadEventState } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-REMOVAL";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let orgId = "";
let eventId = "";
let stageId = "";
let groupId = "";
let organizerId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A signup, with the status the field screen would show it under. */
async function addPlayer(key: string, status: string, seed: number) {
  const p = await prisma.player.create({
    data: { eventId, name: `${TAG} ${key}`, email: at(key), seed, status, handicap: 10 },
  });
  player[key] = p.id;
  return p.id;
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} spring medal`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      capacity: 0,
      status: "draft",
    },
  });
  eventId = event.id;

  const [stage, group] = await Promise.all([
    prisma.stage.create({ data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 } }),
    prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0 } }),
  ]);
  stageId = stage.id;
  groupId = group.id;

  // Three confirmed, two waitlisted, one pending: the exact mix the three
  // tables on the registration screen are built from.
  await addPlayer("ainsley", "confirmed", 1);
  await addPlayer("brody", "confirmed", 2);
  await addPlayer("cass", "confirmed", 3);
  await addPlayer("dee", "waitlisted", 4);
  await addPlayer("eli", "waitlisted", 5);
  await addPlayer("fern", "pending", 6);

  // Ainsley and Brody have played each other. Cass has a stroke card.
  await prisma.match.create({
    data: {
      eventId,
      stageId,
      groupId,
      round: 1,
      playerAId: player.ainsley,
      playerBId: player.brody,
      holes: JSON.stringify([...new Array(16).fill("A"), null, null]),
      scoreStatus: "confirmed",
    },
  });
  await prisma.scorecard.create({
    data: { eventId, stageId, playerId: player.cass, strokes: JSON.stringify(new Array(18).fill(4)) },
  });

  const user = await prisma.user.create({ data: { email: at("organizer"), name: "Organizer", password: "x" } });
  organizerId = user.id;
  await prisma.account.create({
    data: { eventId, email: at("organizer"), name: "Organizer", role: "admin" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });

  jar.clear();
  await createSession(organizerId);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a bulk delete takes exactly what was selected", () => {
  it("removes the ids it was given and nothing else", async () => {
    // The server side of the shared-Set bug: whatever the screen sends is what
    // goes, so the screen must send only what it counted — and this action
    // must not widen it either.
    const before = await prisma.player.count({ where: { eventId } });
    const res = await removeSignups([player.dee]);

    expect(res).toEqual({ deleted: 1, withdrawn: 0, missing: 0 });
    expect(await prisma.player.count({ where: { eventId } })).toBe(before - 1);
    // Everyone else is untouched, in the status they were in.
    expect(await prisma.player.findUnique({ where: { id: player.eli } })).not.toBeNull();
    expect((await prisma.player.findUnique({ where: { id: player.fern } }))?.status).toBe("pending");
  });

  it("reports each outcome separately, so the screen can say which happened", async () => {
    // A mixed selection is the normal case: some of these people have played
    // and some have not, and they cannot be described in one word.
    const res = await removeSignups([player.eli, player.cass]);
    expect(res).toEqual({ deleted: 1, withdrawn: 1, missing: 0 });
  });

  it("ignores an id from another tournament rather than deleting it", async () => {
    const other = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} other event`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-other-${Date.now()}`,
      },
    });
    const stranger = await prisma.player.create({
      data: { eventId: other.id, name: `${TAG} stranger`, seed: 1, status: "confirmed" },
    });

    expect(await removeSignups([stranger.id])).toEqual({ deleted: 0, withdrawn: 0, missing: 1 });
    expect(await prisma.player.findUnique({ where: { id: stranger.id } }), "still there").not.toBeNull();

    await prisma.event.delete({ where: { id: other.id } });
  });
});

describe("a player who has played is withdrawn, not deleted", () => {
  it("keeps the row, so the match they played still has a name on it", async () => {
    // The orphan: Match.playerAId is a plain String with no relation and no
    // cascade. Deleting Ainsley leaves a confirmed result between a name and a
    // gap, and no screen can render it or explain it.
    expect(await removeSignup(player.ainsley)).toBe("withdrawn");

    const row = await prisma.player.findUnique({ where: { id: player.ainsley } });
    expect(row, "the row must survive").not.toBeNull();
    expect(row?.status).toBe("withdrawn");

    const match = await prisma.match.findFirst({ where: { eventId, playerAId: player.ainsley } });
    expect(match, "their match is still there").not.toBeNull();
  });

  it("takes them out of the field all the same", async () => {
    // Withdrawn needs no special handling downstream, which is why it is the
    // right status rather than a new one: the field, the standings and every
    // handicap map are built from `confirmed`.
    const state = await loadEventState(eventId);
    expect(state, "the event must still load with a withdrawn player in it").not.toBeNull();
    if (!state) return;
    expect(state.confirmed.map((p) => p.id)).not.toContain(player.ainsley);
    expect(state.waitlist.map((p) => p.id)).not.toContain(player.ainsley);
    // But the row is still readable, which is what keeps the name on the card.
    expect(state.players.map((p) => p.id)).toContain(player.ainsley);
  });

  it("deletes an entry with no history outright", async () => {
    // A signup added by mistake this morning is not a withdrawal, and leaving
    // a withdrawn row for it would put a person in the record who never
    // entered.
    await addPlayer("typo", "confirmed", 9);
    expect(await removeSignup(player.typo)).toBe("deleted");
    expect(await prisma.player.findUnique({ where: { id: player.typo } })).toBeNull();
  });

  it("promotes the waitlist either way, because the place is free either way", async () => {
    await addPlayer("gale", "confirmed", 10);
    await addPlayer("hana", "waitlisted", 11);
    // Gale has a card, so this is a withdrawal rather than a deletion — and a
    // withdrawal still opens a place in the field.
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId: player.gale, strokes: JSON.stringify(new Array(18).fill(5)) },
    });

    expect(await removeSignup(player.gale)).toBe("withdrawn");
    expect((await prisma.player.findUnique({ where: { id: player.hana } }))?.status).toBe("confirmed");
  });

  it("leaves no scorecard or match pointing at a player who is gone", async () => {
    // The invariant the whole change exists for, swept across the event rather
    // than asserted about one row.
    const ids = new Set((await prisma.player.findMany({ where: { eventId }, select: { id: true } })).map((p) => p.id));
    const cards = await prisma.scorecard.findMany({ where: { eventId }, select: { playerId: true } });
    const matches = await prisma.match.findMany({
      where: { eventId },
      select: { playerAId: true, playerBId: true },
    });

    for (const c of cards) expect(ids.has(c.playerId), `orphaned card: ${c.playerId}`).toBe(true);
    for (const m of matches) {
      for (const side of [m.playerAId, m.playerBId].filter(Boolean)) {
        expect(ids.has(side), `orphaned match side: ${side}`).toBe(true);
      }
    }
  });
});
