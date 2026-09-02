import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncPlayerAccount, revokePlayerAccount } from "../services/player-access";

/**
 * Revoking one entry's access must not lock somebody else out.
 *
 * G3 of the 2026-09-02 exploratory audit. An `Account` is keyed on the event
 * and the email, not on the Player row that prompted it — so
 * `revokePlayerAccount` deleted access for EVERYONE entered under that address.
 *
 * That mattered because `addSignup` had no duplicate check, which is the one
 * entry path without one. An organizer typing in somebody who had already
 * self-registered — the ordinary "put me down" after a player has used the
 * link — created a second row for one person. Tidying up the extra row then
 * deleted the Account and locked the REAL entry out of the app, while the
 * surviving row went on looking perfectly healthy.
 *
 * Shared household addresses make the same shape legitimately (a junior and a
 * parent, a couple, one inbox), which is why the fix asks whether anyone still
 * in the field needs the address rather than whether it is duplicated — and why
 * a database unique index would have been the wrong instrument.
 *
 * Real rows: the whole fault is which rows a delete is scoped by.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DUPE";
const SHARED = "zz-audit-dupe.household@example.invalid";

let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent() {
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
      shareToken: `${TAG}-${process.pid}-${org.id.slice(-6)}`,
      format: "stroke",
    },
  });
  return event.id;
}

const addPlayer = (name: string, email: string, status = "confirmed", seed = 1) =>
  prisma.player.create({
    data: { eventId, name: `${TAG} ${name}`, email, seed, status, handicap: 10 },
  });

const accountsFor = (email: string) =>
  prisma.account.count({ where: { eventId, email, role: "player" } });

beforeEach(async () => {
  await scrub();
  eventId = await makeEvent();
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("revoking access when two entries share an address", () => {
  it("KEEPS the account while somebody entered still uses it", async () => {
    /**
     * The regression. Two rows, one address — a duplicate, or a parent and a
     * junior. Removing one row used to delete the shared Account outright, and
     * the person still in the field could no longer sign in.
     */
    const a = await addPlayer("first", SHARED, "confirmed", 1);
    await addPlayer("second", SHARED, "confirmed", 2);
    await syncPlayerAccount(eventId, `${TAG} first`, SHARED);
    expect(await accountsFor(SHARED)).toBe(1);

    // The duplicate is deleted, exactly as removeSignup does for a player with
    // no history, and access is revoked afterwards.
    await prisma.player.delete({ where: { id: a.id } });
    await revokePlayerAccount(eventId, SHARED);

    expect(
      await accountsFor(SHARED),
      "the player still in the field must keep their sign-in",
    ).toBe(1);
  });

  it("REVOKES once the last entry on that address is gone", async () => {
    // The other half: a guard that never revokes leaves access behind for
    // somebody who is no longer in the tournament at all.
    const a = await addPlayer("only", SHARED, "confirmed", 1);
    await syncPlayerAccount(eventId, `${TAG} only`, SHARED);
    expect(await accountsFor(SHARED)).toBe(1);

    await prisma.player.delete({ where: { id: a.id } });
    await revokePlayerAccount(eventId, SHARED);

    expect(await accountsFor(SHARED)).toBe(0);
  });

  it("revokes for a WITHDRAWN player, whose row survives", async () => {
    /**
     * A withdrawal keeps the row — `removeSignup` takes the soft path when the
     * player has history worth keeping — so counting every row with the address
     * would mean access was never revoked from anybody who had ever played.
     * Withdrawn is not "still in the field".
     */
    const a = await addPlayer("quitter", SHARED, "confirmed", 1);
    await syncPlayerAccount(eventId, `${TAG} quitter`, SHARED);

    await prisma.player.update({ where: { id: a.id }, data: { status: "withdrawn" } });
    await revokePlayerAccount(eventId, SHARED);

    expect(await accountsFor(SHARED)).toBe(0);
  });

  it("keeps the account when the OTHER entry is merely waitlisted", async () => {
    // Waitlisted is still in the tournament — they are waiting for a place, not
    // gone — so they must not lose their sign-in when a duplicate is tidied up.
    const a = await addPlayer("confirmed-one", SHARED, "confirmed", 1);
    await addPlayer("waiting-one", SHARED, "waitlisted", 2);
    await syncPlayerAccount(eventId, `${TAG} confirmed-one`, SHARED);

    await prisma.player.delete({ where: { id: a.id } });
    await revokePlayerAccount(eventId, SHARED);

    expect(await accountsFor(SHARED)).toBe(1);
  });

  it("matches the address whatever its casing", async () => {
    // One address arrives from a CSV, a phone keyboard and a committee laptop
    // in three different casings; they are one person either way.
    const a = await addPlayer("lower", SHARED, "confirmed", 1);
    await addPlayer("upper", SHARED.toUpperCase(), "confirmed", 2);
    await syncPlayerAccount(eventId, `${TAG} lower`, SHARED);

    await prisma.player.delete({ where: { id: a.id } });
    await revokePlayerAccount(eventId, SHARED);

    expect(await accountsFor(SHARED)).toBe(1);
  });

  it("does not reach into another event", async () => {
    // Accounts are per-event. A shared address in a different tournament is
    // somebody else's business.
    const a = await addPlayer("here", SHARED, "confirmed", 1);
    await syncPlayerAccount(eventId, `${TAG} here`, SHARED);

    const otherEventId = eventId;
    eventId = await makeEvent();
    await addPlayer("there", SHARED, "confirmed", 1);
    await syncPlayerAccount(eventId, `${TAG} there`, SHARED);
    const secondEventId = eventId;

    // Remove the entry in the FIRST event only.
    eventId = otherEventId;
    await prisma.player.delete({ where: { id: a.id } });
    await revokePlayerAccount(eventId, SHARED);

    expect(await accountsFor(SHARED), "the first event's access is gone").toBe(0);
    eventId = secondEventId;
    expect(await accountsFor(SHARED), "the second event is untouched").toBe(1);
  });
});
