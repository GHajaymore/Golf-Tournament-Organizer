import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE CODES ARE STILL THERE AFTER A REFUSED SAVE.
 *
 * `saveTournamentSettings` revokes every Round Code when `playerAccess` moves
 * away from codes — deliberately, because "off" has to mean off. For a field
 * entered without email addresses that is a lockout: those players have no
 * `Account` to sign in with, `getPlaySession` refuses a stage with no code, and
 * anybody out on the course loses their card mid-round.
 *
 * The domain rule is unit-tested. What can only be proved against real rows is
 * that the refusal happens BEFORE the write — a rule that fires after
 * `event.update` would leave the settings saved and the codes gone while
 * telling the organizer nothing had happened, which is worse than no rule.
 *
 * So every test here asserts the DATABASE afterwards, not just the return
 * value.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LOCKOUT";
const ORGANIZER = `${TAG}-organizer@example.invalid`.toLowerCase();

let eventId = "";
const session = { email: ORGANIZER, name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { saveTournamentSettings } = await import("@/app/actions/settings");

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: ORGANIZER } });
}

/**
 * A tournament on Round Codes with one round, and a field of `withEmail` +
 * `withoutEmail` players.
 */
async function tournament(opts: { withEmail: number; withoutEmail: number; withdrawnWithout?: number }) {
  await scrub();
  await prisma.user.upsert({
    where: { email: ORGANIZER },
    update: {},
    create: { email: ORGANIZER, name: `${TAG} organizer` },
  });
  const org = await prisma.organization.create({
    data: { name: `${TAG} society`, kind: "community" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      name: `${TAG} spring meeting`,
      organizationId: org.id,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      playerAccess: "code",
    },
    select: { id: true },
  });
  eventId = event.id;
  session.eventId = event.id;

  // `position` and `type` are Stage's only required scalars; the code is what
  // this file is about and everything else takes its default.
  await prisma.stage.create({
    data: { eventId, position: 1, type: "Stroke Play Round", accessCode: `${TAG}CODE` },
  });

  let seed = 0;
  const add = (n: number, email: boolean, status: string) =>
    Array.from({ length: n }, (_, i) => ({
      eventId,
      name: `${TAG} Player ${email ? "E" : "N"}${status[0]}${i + 1}`,
      email: email ? `${TAG}-p-${status}-${i + 1}@example.invalid`.toLowerCase() : "",
      status,
      seed: (seed += 1),
    }));
  const rows = [
    ...add(opts.withEmail, true, "confirmed"),
    ...add(opts.withoutEmail, false, "confirmed"),
    ...add(opts.withdrawnWithout ?? 0, false, "withdrawn"),
  ];
  if (rows.length) await prisma.player.createMany({ data: rows });
  return event.id;
}

/** What the round's code is right now — "" means revoked. */
const codeNow = async () =>
  (await prisma.stage.findFirst({ where: { eventId }, select: { accessCode: true } }))?.accessCode ?? null;
const accessNow = async () =>
  (await prisma.event.findUnique({ where: { id: eventId }, select: { playerAccess: true } }))?.playerAccess ?? null;

beforeEach(scrub);
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("switching a code-entered field to email sign-in", () => {
  it("is refused, and NOTHING is written", async () => {
    await tournament({ withEmail: 2, withoutEmail: 3 });
    const res = await saveTournamentSettings({ playerAccess: "email" });

    expect(res.ok, "the switch went through").toBe(false);
    expect(res.error).toContain("3 players");

    /**
     * THE TWO ASSERTIONS THE UNIT TEST CANNOT MAKE. A refusal placed after the
     * update would return exactly the same error while having already saved
     * the setting and blanked the code — the field locked out, and the
     * organizer told it had not happened.
     */
    expect(await accessNow(), "the setting was saved anyway").toBe("code");
    expect(await codeNow(), "the code was revoked anyway").toBe(`${TAG}CODE`);
  });

  it("counts only entrants still in the field", async () => {
    /**
     * A withdrawn player has no card to be locked out of, so they must not be
     * the reason a club cannot move to email sign-in. The whole field here is
     * address-less; only the confirmed one counts.
     */
    await tournament({ withEmail: 1, withoutEmail: 1, withdrawnWithout: 4 });
    const res = await saveTournamentSettings({ playerAccess: "email" });
    expect(res.ok).toBe(false);
    expect(res.error, "counted the withdrawn four as well").toContain("1 player in this tournament has");
  });
});

describe("what it must not block", () => {
  it("lets the switch through when every entrant has an address", async () => {
    /**
     * THE ORDINARY CASE — a club growing out of Round Codes. If this ever goes
     * red the refusal has become a wall, which is a worse product than the
     * lockout it was built to prevent.
     */
    await tournament({ withEmail: 4, withoutEmail: 0 });
    const res = await saveTournamentSettings({ playerAccess: "email" });
    expect(res.ok, res.error).toBe(true);
    expect(await accessNow()).toBe("email");
    // And "off" still means off.
    expect(await codeNow(), "the codes survived a switch that should revoke them").toBe("");
  });

  it("lets the switch through on an empty field", async () => {
    // Setting this up BEFORE entering anybody is the sane order, and the one a
    // careful organizer takes.
    await tournament({ withEmail: 0, withoutEmail: 0 });
    const res = await saveTournamentSettings({ playerAccess: "email" });
    expect(res.ok, res.error).toBe(true);
    expect(await accessNow()).toBe("email");
  });

  it("lets every OTHER setting be saved on the same tournament", async () => {
    /**
     * THE ASSERTION THAT KEEPS THIS NARROW. Every setting on that screen goes
     * through this one action. A rule that fired on any save would freeze the
     * scoring basis, the tee policy and the public board for exactly the
     * society — one entered by name, on Round Codes — that it exists to
     * protect.
     */
    await tournament({ withEmail: 0, withoutEmail: 5 });
    const res = await saveTournamentSettings({ leaderboardVisibility: "public" });
    expect(res.ok, res.error).toBe(true);
    expect(await accessNow(), "codes were switched off as a side effect").toBe("code");
    expect(await codeNow()).toBe(`${TAG}CODE`);
  });
});
