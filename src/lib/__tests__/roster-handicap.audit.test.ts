import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertMember } from "@/lib/services/roster";

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
