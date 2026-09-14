import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { ensureRoundCodes, revokeRoundCodes } from "@/lib/services/round-codes";

/**
 * ROUND CODES, AGAINST REAL ROWS.
 *
 * `every-round-can-be-entered.test.ts` reads source and proves every creation
 * path CALLS the sink. This proves the sink does the right thing when it is
 * called, which no amount of source reading can: whether a blank is filled,
 * whether a live code survives, and whether "off" is honoured.
 *
 * The bug it was written for is the one measured on 2026-09-14 — all three
 * code-using tournaments in the development database had rounds nobody could
 * enter, because issuing was gated on the access setting CHANGING rather than
 * on it being on.
 */

const MARK = "zz-round-codes";

let organizationId = "";

/**
 * Deleting the ORGANIZATION cascades to its events and their stages, so one
 * statement by name is the whole teardown — and it works whether or not the
 * run got as far as creating anything. Run before as well as after: a killed
 * run leaves rows, and a fixture left in the database is a fixture somebody
 * will later mistake for real.
 */
async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
}

async function makeEvent(playerAccess: string, rounds: number): Promise<string> {
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${MARK}-cup`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `${MARK}-${Math.random().toString(36).slice(2)}`,
      playerAccess,
    },
    select: { id: true },
  });
  for (let i = 0; i < rounds; i += 1) {
    await prisma.stage.create({
      data: { eventId: event.id, position: i, type: "Stroke Play Round", format: "Stroke Play" },
    });
  }
  return event.id;
}

const codesOf = (eventId: string) =>
  prisma.stage
    .findMany({ where: { eventId }, select: { accessCode: true }, orderBy: { position: "asc" } })
    .then((rows) => rows.map((r) => r.accessCode));

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${MARK}-club`, kind: "club" } });
  organizationId = org.id;
});

afterAll(scrub);

describe("every round of a code-using tournament gets a code", () => {
  it("fills every blank, with no transition to trigger it", async () => {
    /**
     * THE CASE THE BUG WAS FOUND IN. The tournament is created with
     * `playerAccess` already "code", so the access setting never changes and
     * the old transition guard never fired — two of the three affected
     * tournaments were in exactly this state, with zero of their rounds coded.
     */
    const eventId = await makeEvent("code", 4);
    expect(await codesOf(eventId), "fixture should start with no codes").toEqual(["", "", "", ""]);

    await ensureRoundCodes(eventId);

    const codes = await codesOf(eventId);
    expect(codes.filter((c) => c).length, "a round with no code cannot be entered").toBe(4);
    // Distinct, because redemption looks a code up on its own with no event to
    // narrow by — two rounds sharing one would resolve to whichever came back
    // first.
    expect(new Set(codes).size, "two rounds share a code").toBe(4);
  });

  it("issues for a round added later without touching the ones already out", async () => {
    /**
     * The other half, and the dangerous one. Re-issuing is not a harmless
     * no-op: `getPlaySession` refuses a session whose stage code has changed,
     * so a reissue during play signs out a field standing on the course.
     */
    const eventId = await makeEvent("code", 2);
    await ensureRoundCodes(eventId);
    const before = await codesOf(eventId);

    await prisma.stage.create({
      data: { eventId, position: 2, type: "Stroke Play Round", format: "Stroke Play" },
    });
    await ensureRoundCodes(eventId);

    const after = await codesOf(eventId);
    expect(after.slice(0, 2), "a code already in players' hands was reissued").toEqual(before);
    expect(after[2], "the round added later got no code").not.toBe("");
  });

  it("issues nothing for a tournament that is not using codes", async () => {
    // "Off" has to mean off, or the setting is decoration — and a code that
    // exists is a code somebody can redeem.
    const eventId = await makeEvent("email", 3);
    await ensureRoundCodes(eventId);
    expect(await codesOf(eventId), "codes were issued for an email-only tournament").toEqual([
      "",
      "",
      "",
    ]);
  });

  it("issues for 'both', which accepts a code as well as an address", async () => {
    /**
     * The control on the test above: "issues nothing" would also be true of a
     * function that has stopped issuing at all. `both` and `code` are the two
     * values `usesAccessCodes` accepts, and one of the affected tournaments
     * was on `both`.
     */
    const eventId = await makeEvent("both", 2);
    await ensureRoundCodes(eventId);
    expect((await codesOf(eventId)).filter((c) => c).length).toBe(2);
  });

  it("revokes every code when access is turned off", async () => {
    const eventId = await makeEvent("code", 3);
    await ensureRoundCodes(eventId);
    expect((await codesOf(eventId)).filter((c) => c).length).toBe(3);

    await revokeRoundCodes(eventId);
    expect(await codesOf(eventId), "turning codes off left codes behind").toEqual(["", "", ""]);
  });
});
