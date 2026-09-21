import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertMember, memberHistory } from "@/lib/services/roster";
import { randomBytes } from "node:crypto";

/**
 * A blank handicap box must not wipe the index the club already had.
 *
 * D7 of the 2026-08-12 audit. `cleanRegistration` returns `handicap: 0` with
 * `handicapSource: "none"` when somebody leaves the box empty — deliberately,
 * because an empty box is the absence of a claim and not a scratch handicap.
 * `upsertMember` then checked `Number.isFinite(0)`, which is true, and never
 * looked at the source. A member on the roster at 12.4 who registered for the
 * Saturday medal without retyping their index came back as a 0 — and 0 is the
 * one wrong value nobody queries, because it looks like a very good golfer
 * rather than like missing data.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-HCP";

let orgId = "";

async function cleanup() {
  // Players and events first — the history cells at the bottom need a member
  // to have actually entered something, and a row left behind here is a row
  // the next run counts.
  await prisma.player.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const member = (who: string) =>
  prisma.member.findFirstOrThrow({ where: { organizationId: orgId, name: `${TAG} ${who}` } });

/**
 * Every case below is an ORGANIZER writing the roster — the blank-box rule is
 * about what a club types, and it applies whether the typing happens in the
 * roster screen or a CSV import.
 *
 * Who is writing became a required argument when public self-registration was
 * found to be reaching this function with no session at all; that half is
 * covered in its own describe at the bottom.
 */
const staffUpsert = (input: Parameters<typeof upsertMember>[1]) =>
  upsertMember(orgId, input, "staff");

describe("a member already on the roster with an index", () => {
  it("keeps it when they register without entering one", async () => {
    await staffUpsert({
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 12.4,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("rita")).handicap).toBe(12.4);

    // The same person, registering again, blank box.
    await staffUpsert({
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "none",
    });
    expect((await member("rita")).handicap).toBe(12.4);
  });

  it("still accepts a new index they did enter", async () => {
    // The guard must not freeze the roster. The whole reason the latest entry
    // wins for this one field is that it is what the organizer just typed.
    await staffUpsert({
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 9.1,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("rita")).handicap).toBe(9.1);
  });

  it("accepts a genuine scratch handicap somebody typed", async () => {
    // 0 is a real handicap. Only 0-with-no-claim is not, so the check has to be
    // on the source and never on the value.
    await staffUpsert({
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("rita")).handicap).toBe(0);
  });

  it("keeps it when a CSV without a handicap column re-imports them", async () => {
    await staffUpsert({
      name: `${TAG} sam`,
      email: `${TAG}.sam@example.invalid`.toLowerCase(),
      handicap: 18.2,
      handicapType: "18",
      handicapSource: "manual",
    });
    // What the importer now sends for a missing or unreadable cell.
    await staffUpsert({
      name: `${TAG} sam`,
      email: `${TAG}.sam@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "none",
    });
    expect((await member("sam")).handicap).toBe(18.2);
  });
});

describe("a member who is new", () => {
  it("is created at 0 with the source recorded as none, not as scratch", async () => {
    // Nothing to protect here, so the row is written — but it has to say the
    // index is unknown, or the next blank registration looks like a real 0 and
    // the guard above has nothing to go on.
    await staffUpsert({
      name: `${TAG} new`,
      email: `${TAG}.new@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "none",
    });
    const row = await member("new");
    expect(row.handicap).toBe(0);
    expect(row.handicapSource).toBe("none");
  });
});

describe("a caller that says nothing about the source", () => {
  it("is still trusted, so nothing that worked before stops working", async () => {
    // Older call sites pass a handicap and no source. Treating that as "no
    // claim" would be a bigger regression than the bug: it would stop every
    // one of them updating the roster at all.
    await staffUpsert({
      name: `${TAG} legacy`,
      email: `${TAG}.legacy@example.invalid`.toLowerCase(),
      handicap: 5,
      handicapType: "18",
    });
    await staffUpsert({
      name: `${TAG} legacy`,
      email: `${TAG}.legacy@example.invalid`.toLowerCase(),
      handicap: 7.3,
      handicapType: "18",
    });
    expect((await member("legacy")).handicap).toBe(7.3);
  });
});

/**
 * Public self-registration is not the club's word on a member's index.
 *
 * `upsertMember` overwrote the handicap on every upsert, reasoned as "what the
 * organizer just typed". Six callers reach it and one is public
 * self-registration, which has no session at all — so anyone who knew a
 * member's email address could enter a tournament as them and restate the
 * Handicap Index every future event snapshots.
 */
describe("a public entrant writing a roster row", () => {
  const publicUpsert = (input: Parameters<typeof upsertMember>[1]) =>
    upsertMember(orgId, input, "public");

  it("cannot restate an existing member's index", async () => {
    await staffUpsert({
      name: `${TAG} pat`,
      email: `${TAG}.pat@example.invalid`.toLowerCase(),
      handicap: 14.2,
      handicapType: "18",
      handicapSource: "manual",
    });

    // Somebody signs up for an open event using Pat's email, claiming scratch.
    await publicUpsert({
      name: `${TAG} pat`,
      email: `${TAG}.pat@example.invalid`.toLowerCase(),
      handicap: 0.4,
      handicapType: "18",
      handicapSource: "manual",
    });

    expect((await member("pat")).handicap).toBe(14.2);
  });

  it("still fills in details the club never had", async () => {
    /**
     * The guard against the guard: registration is how a club's roster gets
     * completed, and refusing everything from a public entrant would make an
     * open event worse than useless. Only the INDEX is the club's to state.
     */
    await staffUpsert({
      name: `${TAG} quinn`,
      email: `${TAG}.quinn@example.invalid`.toLowerCase(),
      handicap: 8,
      handicapType: "18",
      handicapSource: "manual",
    });

    await publicUpsert({
      name: `${TAG} quinn`,
      email: `${TAG}.quinn@example.invalid`.toLowerCase(),
      phone: "07700 900123",
      homeClub: "Visiting GC",
      handicap: 30,
      handicapType: "18",
      handicapSource: "manual",
    });

    const row = await member("quinn");
    expect(row.phone).toBe("07700 900123");
    expect(row.homeClub).toBe("Visiting GC");
    expect(row.handicap).toBe(8); // and not 30
  });

  it("may still create a brand-new member with the index they entered", async () => {
    // A visitor nobody has heard of is not overwriting anything — there is no
    // club figure to protect, and refusing would enter them at scratch.
    await publicUpsert({
      name: `${TAG} visitor`,
      email: `${TAG}.visitor@example.invalid`.toLowerCase(),
      handicap: 21.6,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("visitor")).handicap).toBe(21.6);
  });
});

/**
 * The club's handicap policy is enforced here, not only where somebody
 * remembered to ask.
 *
 * `refuseHandByHand` was called from exactly one of the seven places that can
 * set an index — the organizer's member edit. Every other path walked past it,
 * so under `handicapPolicy: "ghin"` an unauthenticated stranger could do what
 * the club's own organizer is refused.
 */
describe("a club that plays off association indexes", () => {
  let ghinOrgId = "";

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `${TAG} ghin club`, kind: "club", handicapPolicy: "ghin" },
    });
    ghinOrgId = org.id;
  });

  const ghinMember = (who: string) =>
    prisma.member.findFirstOrThrow({
      where: { organizationId: ghinOrgId, name: `${TAG} ${who}` },
    });

  it("refuses a typed index from an organizer", async () => {
    await upsertMember(
      ghinOrgId,
      {
        name: `${TAG} gina`,
        email: `${TAG}.gina@example.invalid`.toLowerCase(),
        ghin: "1234567",
        handicap: 11.1,
        handicapType: "18",
        handicapSource: "manual",
      },
      "staff",
    );
    const row = await ghinMember("gina");
    expect(row.handicap).toBe(0);
    // Said out loud, so nothing downstream reads the 0 as a scratch golfer.
    expect(row.handicapSource).toBe("none");
    // The association number itself is always allowed — it is how a member
    // gets connected in the first place.
    expect(row.ghin).toBe("1234567");
  });

  it("refuses one from a public entrant too", async () => {
    await upsertMember(
      ghinOrgId,
      {
        name: `${TAG} gus`,
        email: `${TAG}.gus@example.invalid`.toLowerCase(),
        handicap: 4.8,
        handicapType: "18",
        handicapSource: "manual",
      },
      "public",
    );
    expect((await ghinMember("gus")).handicap).toBe(0);
  });

  it("leaves an existing association member's figure alone", async () => {
    await prisma.member.create({
      data: {
        organizationId: ghinOrgId,
        name: `${TAG} greta`,
        email: `${TAG}.greta@example.invalid`.toLowerCase(),
        ghin: "7654321",
        handicap: 6.3,
        handicapSource: "ghin",
      },
    });
    await upsertMember(
      ghinOrgId,
      {
        name: `${TAG} greta`,
        email: `${TAG}.greta@example.invalid`.toLowerCase(),
        handicap: 26,
        handicapType: "18",
        handicapSource: "manual",
      },
      "staff",
    );
    expect((await ghinMember("greta")).handicap).toBe(6.3);
  });
});

describe("what one member has played", () => {
  /**
   * `memberHistory` is on the unreached-service register: it answers "what has
   * this member played, and off what index each time", and no screen shows it
   * yet. These cells exist because of what happens WHEN one is written.
   *
   * A player row stores a handicap of 0 when nobody has claimed an index, and
   * 0 is also a real scratch golfer. #441-#443 found that reading as a scratch
   * figure on fourteen screens and put every one behind `indexLabel`, which
   * needs the SOURCE to tell the two apart. This shape did not carry it —
   * missed by that sweep precisely because it has no screen to be caught on.
   *
   * It comes back per ENTRY rather than per member, because the index is a
   * fact about the tournament it was entered for, not about the person now.
   */
  let memberId = "";

  beforeAll(async () => {
    const m = await prisma.member.create({
      data: {
        organizationId: orgId,
        name: `${TAG} hist`,
        email: `${TAG}.hist@example.invalid`.toLowerCase(),
        handicap: 0,
        handicapSource: "none",
      },
    });
    memberId = m.id;

    const event = (name: string) => ({
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status: "registration",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    });

    const spring = await prisma.event.create({ data: event("spring medal") });
    const autumn = await prisma.event.create({ data: event("autumn medal") });

    // The first time out, nobody had claimed a figure for them.
    await prisma.player.create({
      data: {
        eventId: spring.id,
        memberId,
        name: `${TAG} hist`,
        handicap: 0,
        handicapType: "18",
        handicapSource: "none",
        seed: 1,
        status: "confirmed",
      },
    });
    // By the autumn they had one.
    await prisma.player.create({
      data: {
        eventId: autumn.id,
        memberId,
        name: `${TAG} hist`,
        handicap: 12.4,
        handicapType: "18",
        handicapSource: "manual",
        seed: 1,
        status: "confirmed",
      },
    });
  });

  it("returns both entries", async () => {
    expect((await memberHistory(orgId, memberId)).length).toBe(2);
  });

  it("says which entries nobody had claimed an index for", async () => {
    const history = await memberHistory(orgId, memberId);
    const unclaimed = history.filter((h) => h.handicapSource === "none");
    const claimed = history.filter((h) => h.handicapSource === "manual");

    expect(unclaimed.length, "the entry with no claimed index lost its source").toBe(1);
    expect(claimed.length).toBe(1);

    // The whole point of carrying it: without the source a screen sees 0 and
    // cannot tell "nobody said" from "scratch golfer".
    expect(unclaimed[0].handicap).toBe(0);
    expect(claimed[0].handicap).toBeCloseTo(12.4, 5);
  });

  it("leaves a casual round out, the way the roster's own count does", async () => {
    /**
     * A CASUAL ROUND IS NOT ONE OF THE CLUB'S TOURNAMENTS, and this screen and
     * the roster have to agree about that or the club is told two things.
     *
     * `loadRoster` has excluded them from `entryCount` since it was written —
     * "a member's history was inflated by every Sunday fourball they had been
     * picked into" — and `memberHistory` did not, because nothing rendered it.
     * Given a screen on 2026-09-20, the two would have disagreed on their very
     * first club: Members saying two tournaments, the history listing three
     * rows.
     *
     * `shape: "match"` is how a casual round is stored. A player row on one
     * carries `memberId` whenever the player was picked off the roster, so the
     * join finds it — the filter is the only thing that does not.
     */
    const casual = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} tuesday fourball`,
        shape: "match",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        // `randomBytes`, the way every other event in this file mints one. A
        // pid is stable for the life of a process and recycled afterwards, so
        // a run that crashed between creating this row and cleaning it up
        // would collide on the unique constraint rather than fail on the thing
        // under test.
        shareToken: randomBytes(12).toString("hex"),
      },
    });
    await prisma.player.create({
      data: {
        eventId: casual.id,
        memberId,
        name: `${TAG} member`,
        email: `${TAG}.member@example.invalid`.toLowerCase(),
        handicap: 12.4,
        handicapType: "18",
        handicapSource: "manual",
        seed: 1,
        status: "confirmed",
      },
    });

    const history = await memberHistory(orgId, memberId);
    // Still the two tournaments, not three. The control is the row itself:
    // it exists, it is joined to this member, and it is not here.
    expect(history.length, "a casual round was counted as a club tournament").toBe(2);
    expect(history.map((h) => h.eventName)).not.toContain(`${TAG} tuesday fourball`);
  });

  it("does not report another club's entries", async () => {
    /**
     * The second control, for the scope added with the screen. A `Member`
     * belongs to one organization, so the join was implicitly narrow — and
     * "implicitly" is how a guarantee stops being true. Asked explicitly now,
     * so a wrong `organizationId` returns nothing rather than somebody's
     * record.
     */
    const otherOrg = await prisma.organization.create({
      data: { name: `${TAG} other club`, kind: "club" },
    });
    expect(await memberHistory(otherOrg.id, memberId)).toEqual([]);
  });

  it("does not report another member's entries", async () => {
    // The control. A query that lost its `where` would return every player row
    // in the database, and every cell above would still pass.
    const other = await prisma.member.create({
      data: {
        organizationId: orgId,
        name: `${TAG} other`,
        email: `${TAG}.other@example.invalid`.toLowerCase(),
        handicap: 8,
        handicapSource: "manual",
      },
    });
    expect(await memberHistory(orgId, other.id)).toEqual([]);
  });
});
