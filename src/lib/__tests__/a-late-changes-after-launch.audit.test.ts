import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE MORNING OF PLAY, AGAINST REAL ROWS — day-of field changes, PR A.
 *
 * A stroke medal launched as `launchTournament` leaves it (live, setup
 * locked), with a field of three and two on the waiting list. Through the real
 * actions and real sessions, in the order a desk meets them:
 *
 *   withdraw a drawn player with no card  → KEPT as withdrawn (before this it was
 *                                            deleted); the first reserve moves in and
 *                                            the organizer is told they have no tee time
 *   put them back                         → the place is taken, so the waiting list,
 *                                            where they first queued
 *   withdraw another                      → the one put back moves in, ahead of the
 *                                            later reserve: the queue's order, by seed
 *   a late entry                          → in the field, offered a flight
 *   place them                            → in the flight, nobody else moved
 *   details, a list, a placed player's flight, the format → still refused, in words
 *   an Assistant                          → may withdraw and put back
 *   Round 1 has a card                    → no more late entries or approvals; a
 *                                            withdrawal still goes through
 *   a knockout                            → the draw is the field: no late entry
 *   completed                             → nothing changes
 *   not launched (the control)            → a typo with no history is still deleted
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
  addSignup,
  approveSignup,
  endCorrection,
  importCsvSignups,
  movePlayerToGroup,
  openCorrection,
  placeInFlight,
  reinstateWithdrawn,
  removeSignup,
  removeSignups,
  setConfigUnlocked,
  setStageFormat,
  updateSignup,
} from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DAYOF";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let organizerId = "";
let assistantId = "";
const ids: Record<string, string> = {};
let medal = "";
let stageId = "";
let flightA = "";
let flightB = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.member.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A tournament of this club, run by the organizer, with an assistant on its staff. */
async function tournament(name: string, data: { status: string; capacity?: number; stage?: { type: string; format: string } }) {
  const e = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${Date.now()}`,
      capacity: data.capacity ?? 0,
      status: data.status,
      configUnlocked: false,
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: e.id, position: 0, type: data.stage?.type ?? "Stroke Play Round", format: data.stage?.format ?? "Stroke Play", holes: 18 },
  });
  await prisma.account.create({ data: { eventId: e.id, email: at("organizer"), name: `${TAG} Organizer`, role: "admin" } });
  await prisma.account.create({ data: { eventId: e.id, email: at("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
  return { id: e.id, stageId: stage.id };
}

async function player(eventId: string, key: string, seed: number, status: string, groupId: string | null = null) {
  const p = await prisma.player.create({
    data: { eventId, name: `${TAG} ${key}`, email: at(key), handicap: 10 + seed, seed, status, groupId },
  });
  ids[key] = p.id;
  return p.id;
}

async function as(userId: string, eventId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

const statusOf = async (key: string) => (await prisma.player.findUnique({ where: { id: ids[key] }, select: { status: true } }))?.status ?? "deleted";

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const organizer = await prisma.user.create({ data: { email: at("organizer"), name: `${TAG} Organizer`, password: "x", emailVerifiedAt: new Date() } });
  const assistant = await prisma.user.create({ data: { email: at("assistant"), name: `${TAG} Assistant`, password: "x", emailVerifiedAt: new Date() } });
  organizerId = organizer.id;
  assistantId = assistant.id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: organizer.id, role: "owner" } });

  const m = await tournament("medal", { status: "live", capacity: 3 });
  medal = m.id;
  stageId = m.stageId;
  flightA = (await prisma.group.create({ data: { eventId: medal, name: "Flight A", position: 0 } })).id;
  flightB = (await prisma.group.create({ data: { eventId: medal, name: "Flight B", position: 1 } })).id;
  await player(medal, "ann", 1, "confirmed", flightA);
  await player(medal, "bob", 2, "confirmed", flightA);
  await player(medal, "cat", 3, "confirmed", flightB);
  await player(medal, "wes", 4, "waitlisted");
  await player(medal, "xia", 5, "waitlisted");
  await as(organizerId, medal);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a launched stroke medal, before anybody has played", () => {
  it("a drawn player with no card is withdrawn and KEPT, and the first reserve moves in", async () => {
    const res = await removeSignup(ids.ann);
    expect(res).toMatchObject({ ok: true, outcome: "withdrawn" });
    expect(await statusOf("ann"), "a drawn player with no card was deleted on the morning").toBe("withdrawn");
    expect(await statusOf("wes"), "the first on the waiting list did not move in").toBe("confirmed");
    expect(await statusOf("xia"), "the later reserve jumped the queue").toBe("waitlisted");
    if (res.ok) {
      expect(res.said).toContain(`${TAG} wes moved in from the waiting list.`);
      expect(res.said).toContain("has no tee time yet: put them in a group on the Tee sheet.");
      expect(res.said).toContain("The app records who owes what; you settle outside it.");
    }
    const line = await prisma.auditLog.findFirst({ where: { eventId: medal, action: "removed" }, orderBy: { createdAt: "desc" } });
    expect(line?.detail).toBe(`${TAG} ann was withdrawn from the field.`);
  });

  it("put back while the place is taken goes to the waiting list, where they first queued", async () => {
    const res = await reinstateWithdrawn(ids.ann);
    expect(res).toEqual({ ok: true, said: `The field is full, so ${TAG} ann is back on the waiting list.` });
    expect(await statusOf("ann")).toBe("waitlisted");
    // Put back twice is refused in words: they have not withdrawn now.
    const again = await reinstateWithdrawn(ids.ann);
    expect(again).toEqual({ ok: false, error: `${TAG} ann hasn’t withdrawn.` });
  });

  it("the next place goes to the one put back, ahead of the later reserve (seed order)", async () => {
    const res = await removeSignup(ids.bob);
    expect(res).toMatchObject({ ok: true, outcome: "withdrawn" });
    expect(await statusOf("ann")).toBe("confirmed");
    expect(await statusOf("xia")).toBe("waitlisted");
  });

  it("put back with room returns them to the field", async () => {
    await prisma.event.update({ where: { id: medal }, data: { capacity: 10 } });
    const res = await reinstateWithdrawn(ids.bob);
    expect(res).toEqual({ ok: true, said: `${TAG} bob is back in the field. Check they still have a group on the Tee sheet.` });
    expect(await statusOf("bob")).toBe("confirmed");
    const line = await prisma.auditLog.findFirst({ where: { eventId: medal, action: "put-back" }, orderBy: { createdAt: "desc" } });
    expect(line?.detail).toBe(`${TAG} bob was put back in the field.`);
  });

  it("a late entry is taken, and told to find a tee time and a flight", async () => {
    const res = await addSignup({ name: `${TAG} lee`, email: at("lee"), handicap: 14.2 });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    // Taken with the warning and the unplaced flag, in the panel's words (J04, state machine PR 7a).
    expect(res.said).toBe(`${TAG} lee is in the field but in no flight. Put them in one. Put them in a group on the Tee sheet.`);
    const lee = await prisma.player.findFirstOrThrow({ where: { eventId: medal, email: at("lee") } });
    ids.lee = lee.id;
    expect(lee.status).toBe("confirmed");
    expect(lee.groupId).toBeNull();
  });

  it("the late entrant is placed in a flight, and nobody else moves", async () => {
    const before = await prisma.player.findMany({ where: { eventId: medal, id: { not: ids.lee } }, select: { id: true, groupId: true }, orderBy: { id: "asc" } });
    // With the draw CONFIRMED (panel review of #1028, must-fix 1): placing an unplaced player in a
    // prize division moves nobody, so the confirmed draw does not hold it in a stroke medal.
    await prisma.event.update({ where: { id: medal }, data: { flightsConfirmed: true } });
    try {
      expect(await placeInFlight(ids.lee, flightB)).toEqual({ ok: true });
    } finally {
      await prisma.event.update({ where: { id: medal }, data: { flightsConfirmed: false } });
    }
    expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.lee } })).groupId).toBe(flightB);
    const after = await prisma.player.findMany({ where: { eventId: medal, id: { not: ids.lee } }, select: { id: true, groupId: true }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
    // A placed player is not "placed" again by this door.
    const placed = await placeInFlight(ids.cat, flightA);
    expect(placed.ok).toBe(false);
    expect(placed.error).toBe(`${TAG} cat is in a flight already. Moving a player between flights is done on Flights.`);
  });

  it("what stays locked refuses in words, and changes nothing", async () => {
    expect(await updateSignup(ids.cat, { name: `${TAG} renamed` })).toEqual({
      ok: false,
      error: "A player’s details are locked once the tournament is launched. To correct one, an Organizer can make a committee correction to the field on the dashboard.",
    });
    expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.cat } })).name).toBe(`${TAG} cat`);
    const bulk =
      "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or ask an Organizer to make a committee correction to the field on the dashboard.";
    expect((await importCsvSignups(`name,email\n${TAG} csv,${at("csv")}\n`)).error).toBe(bulk);
    expect(await removeSignups([ids.cat])).toEqual({ deleted: 0, withdrawn: 0, missing: 0, error: bulk });
    expect(await statusOf("cat")).toBe("confirmed");
    expect(await movePlayerToGroup(ids.cat, flightA)).toEqual({
      ok: false,
      error: "Flights are fixed once the tournament is launched. To move a player, an Organizer can make a committee correction to the flights on the dashboard.",
    });
    expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.cat } })).groupId).toBe(flightB);
    // The format is setup, and the rounds stay locked — returned in words, never thrown (state machine PR 5b).
    await expect(setStageFormat(stageId, "Stableford")).resolves.toMatchObject({
      ok: false,
      error: "Locked because the tournament is live. Make a committee correction to change a round’s format.",
      lock: { scope: "rounds", by: "launch" },
    });
  });

  it("an Assistant may withdraw and put back", async () => {
    await as(assistantId, medal);
    try {
      expect(await removeSignup(ids.cat)).toMatchObject({ ok: true, outcome: "withdrawn" });
      expect(await statusOf("cat")).toBe("withdrawn");
      expect(await reinstateWithdrawn(ids.cat)).toMatchObject({ ok: true });
      expect(await statusOf("cat")).toBe("confirmed");
    } finally {
      await as(organizerId, medal);
    }
  });
});

describe("once Round 1 has a card", () => {
  beforeAll(async () => {
    // One card, as a scorer would leave it: entered, not yet approved — play has begun.
    await prisma.scorecard.create({ data: { eventId: medal, stageId, playerId: ids.cat, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    await player(medal, "pam", 9, "pending");
  });

  it("a late entry and an approval are refused, naming the round", async () => {
    const begun = "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can make a committee correction to the field on the dashboard.";
    expect(await addSignup({ name: `${TAG} too-late`, email: at("too-late"), handicap: 9 })).toEqual({ ok: false, error: begun });
    expect(await prisma.player.count({ where: { eventId: medal, email: at("too-late") } })).toBe(0);
    expect(await approveSignup(ids.pam)).toEqual({ ok: false, error: begun });
    expect(await statusOf("pam")).toBe("pending");
  });

  /**
   * THE ASSISTANT ON THE DESK (panel review of #1028, must-fix 2): they cannot
   * unlock (`setConfigUnlocked` is the Organizer's), so the refusal they are
   * handed must name who can — not end on "unlock the tournament".
   */
  it("an Assistant refused a walk-in is told an Organizer can unlock it, because they cannot", async () => {
    await as(assistantId, medal);
    try {
      const res = await addSignup({ name: `${TAG} walk-in`, email: at("walk-in"), handicap: 20 });
      expect(res.ok).toBe(false);
      expect(res.error).toBe(
        "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can make a committee correction to the field on the dashboard.",
      );
      // The reason the words matter: the Assistant has no Unlock of their own.
      await expect(setConfigUnlocked(true)).rejects.toThrow();
      expect((await prisma.event.findUniqueOrThrow({ where: { id: medal } })).configUnlocked).toBe(false);
    } finally {
      await as(organizerId, medal);
    }
  });

  it("a withdrawal still goes through: it reopens nothing", async () => {
    // A reserve waiting, and room for them (capacity 10 since the put-back above).
    await player(medal, "zed", 20, "waitlisted");
    expect(await removeSignup(ids.lee)).toMatchObject({ ok: true, outcome: "withdrawn" });
    expect(await statusOf("lee")).toBe("withdrawn");
    // Nobody moves in: Round 1 has a card, so a new name would have no score for it, and a promotion
    // is a late entry that asks the same rule (J12, `promoteFromWaitlist`).
    expect(await statusOf("zed"), "the queue moved a reserve in after Round 1 had begun").toBe("waitlisted");
    await prisma.player.delete({ where: { id: ids.zed } });
  });

  it("an unplaced player can no longer be placed", async () => {
    await reinstateWithdrawn(ids.lee);
    await prisma.player.update({ where: { id: ids.lee }, data: { groupId: null } });
    const res = await placeInFlight(ids.lee, flightA);
    expect(res).toEqual({ ok: false, error: "The first card of Round 1 is in, so the flights are fixed. To place a player, an Organizer can make a committee correction to the field on the dashboard." });
  });

  /**
   * THE WAY OUT THE REFUSALS NAME, TAKEN (panel review of 5b, must-fix 1). Every
   * refusal above ends "an Organizer can make a committee correction to the
   * field" — and until this, a correction to the field opened nothing here: the
   * TD's worst case, the desk locked out on the day with no working way out.
   * Through the real actions: the Organizer opens the field, the walk-in is
   * taken, placed in a division and a name corrected; a move between flights
   * is still the flights' (refused, naming them); Done shuts the field again,
   * and the record says who opened what, why, until when, and who closed it.
   */
  it("a committee correction to the field takes the walk-in, places them and corrects a name; Done shuts it again", async () => {
    await prisma.auditLog.deleteMany({ where: { eventId: medal, action: "committee-correction" } });
    expect(await openCorrection("field", "A walk-in arrived after the first card")).toEqual({ ok: true });
    try {
      const res = await addSignup({ name: `${TAG} walk-in`, email: at("walk-in"), handicap: 20 });
      expect(res.ok, res.error).toBe(true);
      const walkIn = await prisma.player.findFirstOrThrow({ where: { eventId: medal, email: at("walk-in") } });
      expect(walkIn.status).toBe("confirmed");
      // Placed in a prize division: part of the late entry, so the field's correction covers it. With a
      // card in, Entries' own door sends the placement to Flights, where the move asks first (`force`).
      expect(await placeInFlight(walkIn.id, flightA)).toEqual({ ok: false, error: "Matches have been scored. Place them on Flights, where the move asks first." });
      expect(await movePlayerToGroup(walkIn.id, flightA, true)).toMatchObject({ ok: true });
      expect((await prisma.player.findUniqueOrThrow({ where: { id: walkIn.id } })).groupId).toBe(flightA);
      expect(await approveSignup(ids.pam)).toMatchObject({ ok: true });
      expect(await statusOf("pam")).toBe("confirmed");
      expect(await updateSignup(ids.cat, { name: `${TAG} catherine` })).toMatchObject({ ok: true });
      expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.cat } })).name).toBe(`${TAG} catherine`);
      // The flights' change is not the field's: still refused, naming the part to open.
      expect(await movePlayerToGroup(ids.cat, flightA)).toEqual({
        ok: false,
        error: "Flights are fixed once the tournament is launched. To move a player, an Organizer can make a committee correction to the flights on the dashboard.",
      });
    } finally {
      expect(await endCorrection()).toEqual({ ok: true });
    }
    // Shut again: the next walk-in is refused as before.
    expect((await addSignup({ name: `${TAG} second-walk-in`, email: at("second-walk-in"), handicap: 20 })).ok).toBe(false);
    const lines = (await prisma.auditLog.findMany({ where: { eventId: medal, action: "committee-correction" }, orderBy: { createdAt: "asc" } })).map((l) => l.detail);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(new RegExp(`^${TAG} Organizer opened the field for a correction: A walk-in arrived after the first card — until midnight on .+, club time$`));
    expect(lines[1]).toBe(`${TAG} Organizer closed the correction ${TAG} Organizer opened on the field`);
  });

  it("a committee correction to the flights moves a placed player — the move's own refusal named it", async () => {
    expect(await openCorrection("flights", "One player drawn in the wrong flight")).toEqual({ ok: true });
    try {
      // Flights asks first over a scored round (`force`), then the move goes through.
      expect(await movePlayerToGroup(ids.cat, flightA)).toMatchObject({ ok: false, needsConfirm: true });
      expect(await movePlayerToGroup(ids.cat, flightA, true)).toMatchObject({ ok: true });
      expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.cat } })).groupId).toBe(flightA);
      // The field's changes are not the flights': a name stays locked.
      expect((await updateSignup(ids.cat, { name: `${TAG} cat` })).ok).toBe(false);
    } finally {
      expect(await endCorrection()).toEqual({ ok: true });
    }
  });
});

describe("other families and stages", () => {
  it("a knockout: the draw is the field — no late entry, but a withdrawal is kept", async () => {
    const k = await tournament("knockout", { status: "live", stage: { type: "Bracket Stage", format: "Match Play" } });
    await player(k.id, "kay", 1, "confirmed");
    await player(k.id, "kim", 2, "confirmed");
    await as(organizerId, k.id);
    try {
      expect(await addSignup({ name: `${TAG} ko-late`, email: at("ko-late"), handicap: 9 })).toEqual({
        ok: false,
        error:
          "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. An Organizer can open the field with a committee correction.",
      });
      // The way out (J12, panel Q3): a reserve, on the waiting list, whatever the room.
      expect(await addSignup({ name: `${TAG} ko-late`, email: at("ko-late"), handicap: 9, reserve: true })).toEqual({
        ok: true,
        said: `${TAG} ko-late is on the waiting list as a reserve. The draw does not change.`,
      });
      const reserve = await prisma.player.findFirstOrThrow({ where: { eventId: k.id, email: at("ko-late") } });
      ids.reserve = reserve.id;
      expect(reserve.status).toBe("waitlisted");
      expect(reserve.groupId).toBeNull();
      const res = await removeSignup(ids.kay);
      expect(res).toMatchObject({ ok: true, outcome: "withdrawn" });
      if (res.ok) expect(res.said).toContain("If their tie is still to play, record it as a walkover on the Bracket.");
      expect(await statusOf("kay")).toBe("withdrawn");
      // The field is open (capacity 0), and still the reserve does not move in by itself: a promotion is
      // a late entry and asks the same rule (`promoteFromWaitlist`). Before J12 they were promoted here.
      expect(await statusOf("reserve"), "the queue moved a reserve into a knockout whose draw is made").toBe("waitlisted");
    } finally {
      await as(organizerId, medal);
    }
  });

  it("a round robin in flights: a late entrant only with a flight, and their matches drawn against it (J12)", async () => {
    const r = await tournament("robin", { status: "live", stage: { type: "Round Robin", format: "Match Play" } });
    const a = (await prisma.group.create({ data: { eventId: r.id, name: "Flight A", position: 0 } })).id;
    const b = (await prisma.group.create({ data: { eventId: r.id, name: "Flight B", position: 1 } })).id;
    await player(r.id, "rae", 1, "confirmed", a);
    await player(r.id, "roy", 2, "confirmed", a);
    await player(r.id, "ria", 3, "confirmed", b);
    await as(organizerId, r.id);
    try {
      expect(await addSignup({ name: `${TAG} rr-late`, email: at("rr-late"), handicap: 9 })).toEqual({
        ok: false,
        error: "In a round robin, a late entrant needs a flight. Without one they have no matches. Choose their flight in the Add form.",
      });
      expect(await prisma.player.count({ where: { eventId: r.id, email: at("rr-late") } })).toBe(0);
      // Another tournament's flight is not a flight of this one.
      expect(await addSignup({ name: `${TAG} rr-late`, email: at("rr-late"), handicap: 9, flightId: flightA })).toEqual({ ok: false, error: "Flight not found in this tournament." });
      const res = await addSignup({ name: `${TAG} rr-late`, email: at("rr-late"), handicap: 9, flightId: a });
      expect(res).toEqual({
        ok: true,
        said: `${TAG} rr-late is in the field. Put them in a group on the Tee sheet. ${TAG} rr-late’s matches against Flight A are drawn. Each player in it has one more to play.`,
      });
      const late = await prisma.player.findFirstOrThrow({ where: { eventId: r.id, email: at("rr-late") } });
      expect(late.groupId).toBe(a);
      const theirs = await prisma.match.findMany({ where: { eventId: r.id, OR: [{ playerAId: late.id }, { playerBId: late.id }] } });
      expect(theirs.map((m) => (m.playerAId === late.id ? m.playerBId : m.playerAId)).sort()).toEqual([ids.rae, ids.roy].sort());
      // Flight B's player is untouched: nobody else's pairing changed.
      expect(await prisma.match.count({ where: { eventId: r.id, OR: [{ playerAId: ids.ria }, { playerBId: ids.ria }] } })).toBe(0);
    } finally {
      await as(organizerId, medal);
    }
  });

  it("completed: nothing changes, and it says how to reopen", async () => {
    const c = await tournament("completed", { status: "completed" });
    await player(c.id, "cob", 1, "confirmed");
    await as(organizerId, c.id);
    try {
      expect(await removeSignup(ids.cob)).toEqual({
        ok: false,
        error: "The tournament is completed, so its field is as it finished. An Organizer can reopen it on the dashboard.",
      });
      expect(await statusOf("cob")).toBe("confirmed");
    } finally {
      await as(organizerId, medal);
    }
  });

  it("not launched (the control): a typo with no history is still deleted, as before", async () => {
    const d = await tournament("draft", { status: "draft" });
    await player(d.id, "typo", 1, "confirmed");
    await as(organizerId, d.id);
    try {
      expect(await removeSignup(ids.typo)).toMatchObject({ ok: true, outcome: "deleted" });
      expect(await statusOf("typo")).toBe("deleted");
    } finally {
      await as(organizerId, medal);
    }
  });
});
