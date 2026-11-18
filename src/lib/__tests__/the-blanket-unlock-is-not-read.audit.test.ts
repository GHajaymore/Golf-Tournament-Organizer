import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE BLANKET UNLOCK IS NOT READ; THE CASUAL RULE IS WRITTEN DOWN (state machine PR 9b; test
 * plan B3, B8, B9 and F5). Against real rows.
 *
 * Until 9b the old blanket flag on the row opened every part of a launched tournament, and it
 * was the ONLY thing that kept a casual round open: `createMatch` wrote it on purpose. 9b stops
 * reading it and writes the rule the proposal already ruled (8.2, "Casual: locks none") into
 * the one predicate, `setupLockedByLaunch(status, family)`. So:
 *
 *   B3  a casual round made the way the app makes it (`createMatch`, which no longer writes the
 *       flag) takes a change of setting, a change to its field and its round being closed while
 *       live — each press `ok: true`, asserted before any row is read. A second casual row made
 *       by Prisma with no flag (the column's default) is just as open.
 *   B8  a COMPLETED tournament whose row still holds the old flag is locked in every part, its
 *       way out Reopen, and no correction opens it.
 *   B9  a LIVE tournament holding the old flag is locked; the correction opens one part.
 *   F5  the fixture helper (`openCorrectionOn`) writes the row `openCorrection` writes, opens one
 *       part and not another, and refuses a tournament without the fixture mark.
 *
 * The old flag is written by raw SQL, the column named in a string: the wall (class A) allows
 * the name as an identifier nowhere outside its listed exceptions, and the column still exists
 * until it is dropped after launch (9d).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/the-blanket-unlock-is-not-read.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PR9B";

let session: { email: string; name: string; eventId: string; role: string; userId?: string } | null = null;

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

const { createMatch } = await import("@/app/actions/match-setup");
const { setRequirePhone, setStageScoreInput, setRoundClosed, openCorrection } = await import("@/app/actions/tournament");
const { lockFactsFor } = await import("@/lib/services/tournament-facts");
const { locksFor, scopeLockOf, LOCK_SCOPES } = await import("@/lib/domain/tournament-status");
const { openCorrectionOn, endCorrectionOn, fixtureMarkRefusal } = await import("./correction-fixture");

const ORGANIZER = `${TAG} organizer`;
let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

/** The old blanket flag, written the only way a test may now write it: as SQL, the column a string. */
const holdTheOldFlag = (id: string) => prisma.$executeRawUnsafe(`UPDATE "Event" SET "configUnlocked" = true WHERE id = $1`, id);
const holdsTheOldFlag = async (id: string) =>
  ((await prisma.$queryRawUnsafe<{ v: boolean }[]>(`SELECT "configUnlocked" AS v FROM "Event" WHERE id = $1`, id))[0]?.v ?? null);

/** A plain medal of the fixture's own, at a status. */
async function medal(label: string, status: "live" | "completed"): Promise<{ id: string; round: string }> {
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${label}`,
      organizationId: orgId,
      status,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${label}-${process.pid}`.toLowerCase().replace(/\s+/g, "-"),
    },
    select: { id: true },
  });
  const round = await prisma.stage.create({ data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 }, select: { id: true } });
  return { id: ev.id, round: round.id };
}

const asOrganizerOf = (eventId: string) => {
  session = { email: `${TAG.toLowerCase()}@example.invalid`, name: ORGANIZER, eventId, role: "admin" };
};

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: "Pacific/Auckland" }, select: { id: true } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("B3 — a casual round is open while live by the family rule, not by a flag", () => {
  it("made the way the app makes it, it takes a setting, a field change and its round closed — each press answered ok", async () => {
    session = { email: `${TAG.toLowerCase()}@example.invalid`, name: ORGANIZER, eventId: "", role: "admin" };
    const made = await createMatch({ players: [{ name: `${TAG} guest one` }, { name: `${TAG} guest two` }], format: "Match Play" });
    expect(made.ok, made.error).toBe(true);
    const id = made.eventId!;
    // `createMatch` names the round from its players; the fixture's mark is on them, and the org is scrubbed by name too.
    try {
      expect(await holdsTheOldFlag(id), "createMatch still writes the old flag").toBe(false);
      const row = await prisma.event.findUniqueOrThrow({ where: { id }, select: { status: true, shape: true } });
      expect(row).toEqual({ status: "live", shape: "match" });
      const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: id }, select: { id: true } });
      asOrganizerOf(id);

      // The presses first — a refused press answers ok:false, and a test that only read rows would pass on nothing.
      expect(await setStageScoreInput(stage.id, ""), "a setting of the round (rounds)").toEqual({ ok: true });
      expect(await setRequirePhone(true), "a term of the field (field)").toEqual({ ok: true });
      expect(await setRoundClosed(stage.id, true, true), "the round closed").toMatchObject({ ok: true });

      expect((await prisma.event.findUniqueOrThrow({ where: { id }, select: { requirePhone: true } })).requirePhone).toBe(true);
      const locks = locksFor((await lockFactsFor(id))!);
      expect(LOCK_SCOPES.filter((s) => locks[s].locked), "a live casual round locks nothing").toEqual([]);
    } finally {
      await prisma.event.deleteMany({ where: { id } });
    }
  });

  it("a casual row with no flag at all (the column's default) is as open", async () => {
    const ev = await prisma.event.create({
      data: { name: `${TAG} casual by hand`, organizationId: orgId, status: "live", shape: "match", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-casual-${process.pid}`.toLowerCase() },
      select: { id: true },
    });
    await prisma.stage.create({ data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
    expect(await holdsTheOldFlag(ev.id)).toBe(false);
    asOrganizerOf(ev.id);
    expect(await setRequirePhone(true)).toEqual({ ok: true });
    const locks = locksFor((await lockFactsFor(ev.id))!);
    expect(LOCK_SCOPES.filter((s) => locks[s].locked)).toEqual([]);
  });
});

describe("B8, B9 — a row that held the old flag is locked like any other", () => {
  it("B8: completed and holding the flag — every part locked by completion, the way out Reopen, no correction", async () => {
    const t = await medal("done old flag", "completed");
    await holdTheOldFlag(t.id);
    expect(await holdsTheOldFlag(t.id), "the fixture did not write the old flag").toBe(true);
    asOrganizerOf(t.id);
    const locks = locksFor((await lockFactsFor(t.id))!);
    for (const scope of ["details", "rounds", "field", "flights", "draw", "sides", "cup", "teeSheet"] as const) {
      expect(scopeLockOf(locks, scope), scope).toMatchObject({ by: "completed", wayOut: { says: "Reopen it on the dashboard" }, correctable: false });
    }
    expect(await setRequirePhone(true)).toMatchObject({ ok: false, lock: { scope: "field", by: "completed" } });
    expect(await openCorrection("field", "Correcting after the prize-giving")).toMatchObject({ ok: false, error: expect.stringMatching(/Reopen it on the dashboard/) });
  });

  it("B9: live and holding the flag — locked by launch; a correction opens the one part", async () => {
    const t = await medal("live old flag", "live");
    await holdTheOldFlag(t.id);
    asOrganizerOf(t.id);
    expect(await setRequirePhone(true)).toMatchObject({ ok: false, lock: { scope: "field", by: "launch", correctable: true } });
    expect(await openCorrection("field", "A late entrant's terms were wrong")).toEqual({ ok: true });
    expect(await setRequirePhone(true)).toEqual({ ok: true });
    // One part only: the rounds stay shut.
    expect(await setStageScoreInput(t.round, "")).toMatchObject({ ok: false, lock: { scope: "rounds", by: "launch" } });
  });
});

describe("F5 — the fixture's correction is the action's row, one part wide, and only on a fixture", () => {
  it("writes the same scope, reason, who and end of the club's day as openCorrection", async () => {
    const t = await medal("helper row", "live");
    asOrganizerOf(t.id);
    const reason = "zz fixture: a part opened for this test";
    const cols = { correctionScope: true, correctionReason: true, correctionBy: true, correctionUntil: true } as const;
    expect(await openCorrection("flights", reason)).toEqual({ ok: true });
    const byAction = await prisma.event.findUniqueOrThrow({ where: { id: t.id }, select: cols });
    await endCorrectionOn(prisma, t.id);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: t.id }, select: cols }))).toEqual({ correctionScope: null, correctionReason: null, correctionBy: null, correctionUntil: null });
    await openCorrectionOn(prisma, t.id, "flights", { reason, by: ORGANIZER });
    const byHelper = await prisma.event.findUniqueOrThrow({ where: { id: t.id }, select: cols });
    expect(byHelper).toEqual(byAction);
    // CONTROL: the row is not empty, so the equality is not two nulls.
    expect(byHelper.correctionScope).toBe("flights");
    expect(byHelper.correctionUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("a correction on the field does not open the rounds — the helper is not a blanket", async () => {
    const t = await medal("helper one part", "live");
    asOrganizerOf(t.id);
    await openCorrectionOn(prisma, t.id, "field");
    expect(await setRequirePhone(true)).toEqual({ ok: true });
    expect(await setStageScoreInput(t.round, "")).toMatchObject({
      ok: false,
      error: "Locked because the tournament is live. Make a committee correction to change how scores are entered.",
      lock: { scope: "rounds" },
    });
  });

  it("refuses a tournament without the fixture mark (Hard rule 1)", () => {
    expect(fixtureMarkRefusal("ZZ-AUDIT-PR9B helper")).toBeNull();
    expect(fixtureMarkRefusal("zz-pr9b medal")).toBeNull();
    expect(fixtureMarkRefusal("Spring Foursomes")).toMatch(/carries no zz mark/);
    expect(fixtureMarkRefusal("The Spring zz Cup")).toMatch(/carries no zz mark/);
  });
});
