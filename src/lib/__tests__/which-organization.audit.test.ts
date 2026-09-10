import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Which organization a new tournament belongs to, when the organizer runs more
 * than one.
 *
 * `organizationForNewEvent` picked a single membership ordered by kind and
 * then age — and kinds sort alphabetically, so "club" beat "community" and
 * "personal" every time. Somebody who runs a club AND a society got the club,
 * was never asked, and had no way to say otherwise.
 *
 * Demonstrated on 2026-09-09 through the real screen: an owner of both created
 * a tournament from the charity-day template and it landed in the club, with
 * nothing saying a choice had been made.
 *
 * THE CONSEQUENCES ARE NOT COSMETIC. The event draws its field from that
 * organization's roster, inherits its settings and currency, counts against
 * its plan allowance, appears in its tournament list, and offers its champion
 * to its honours board. The society's staff cannot see it and the club's staff
 * can — which is a charity day's players landing inside a club's data boundary
 * because of an alphabetical sort.
 *
 * THE SECOND TEST IS THE ONE THAT MATTERS. The choice arrives from a form, and
 * a `"use server"` export is a public HTTP endpoint: an id belonging to
 * somebody else's club must not create an event inside it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WHICHORG";
const EMAIL = `${TAG}-owner@example.invalid`.toLowerCase();
const STRANGER = `${TAG}-stranger@example.invalid`.toLowerCase();

const session = { email: EMAIL, name: `${TAG} owner`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createEvent } = await import("@/app/actions/tournament");
const { organizationsForOrganizer } = await import("@/lib/services/organization");

let clubId = "";
let societyId = "";
let strangersClubId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, STRANGER] } } });
}

/** An organization of `kind`, owned by `email`. */
async function orgOwnedBy(name: string, kind: string, email: string) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: `${TAG} ${email}` },
    select: { id: true },
  });
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind },
    select: { id: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });
  return org.id;
}

/** Which organization the tournament of this name ended up in. */
async function orgOf(name: string) {
  const ev = await prisma.event.findFirst({
    where: { name: `${TAG} ${name}` },
    select: { organizationId: true },
  });
  return ev?.organizationId ?? null;
}

beforeAll(async () => {
  await scrub();
  // Created club-first, which is also how the silent default ordered them:
  // "club" < "community" alphabetically.
  clubId = await orgOwnedBy("club", "club", EMAIL);
  societyId = await orgOwnedBy("society", "community", EMAIL);
  strangersClubId = await orgOwnedBy("somebody elses club", "club", STRANGER);
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("an organizer who runs two outfits", () => {
  it("is offered both, in the order the silent default used", async () => {
    const list = await organizationsForOrganizer(EMAIL);
    expect(list.map((o) => o.id)).toEqual([clubId, societyId]);
    // The first entry IS what would have been chosen without asking, so a
    // screen defaulting to it changes nothing for somebody who ignores the
    // question.
    expect(list[0].kind).toBe("club");
  });

  it("and is not offered somebody else's club", async () => {
    const list = await organizationsForOrganizer(EMAIL);
    expect(list.map((o) => o.id)).not.toContain(strangersClubId);
  });

  it("gets the society when they pick the society", async () => {
    await createEvent(`${TAG} charity day`, "custom", "single", undefined, societyId);
    expect(await orgOf("charity day"), "the one they chose").toBe(societyId);
  });

  it("and still gets the club when they say nothing", async () => {
    /**
     * THE ASSERTION THAT KEEPS THE CHANGE FROM BEING A BEHAVIOUR CHANGE.
     * Every existing caller passes nothing, and must land exactly where it
     * always did.
     */
    await createEvent(`${TAG} club medal`, "custom", "single");
    expect(await orgOf("club medal")).toBe(clubId);
  });
});

describe("an organization that is not theirs", () => {
  it("cannot be created in, and does not fail loudly either", async () => {
    /**
     * THE SAFETY PROPERTY. The choice arrives from a form and `createEvent` is
     * a public HTTP endpoint, so the id is re-read against this person's own
     * owner/admin memberships before it is used.
     *
     * It falls back rather than throwing, deliberately: the caller has done
     * nothing wrong from their own side, and the event belongs in their own
     * organization. What must never happen is the event appearing inside
     * somebody else's club, which is the whole of a takeover.
     */
    const res = await createEvent(`${TAG} intrusion`, "custom", "single", undefined, strangersClubId);
    expect(res.ok).toBe(true);
    expect(await orgOf("intrusion"), "never the stranger's").not.toBe(strangersClubId);
    expect(await orgOf("intrusion"), "the caller's own default").toBe(clubId);

    // And nothing was created inside the stranger's organization at all.
    expect(
      await prisma.event.count({ where: { organizationId: strangersClubId } }),
      "somebody else's club is untouched",
    ).toBe(0);
  });

  it("nor an id that is not an organization at all", async () => {
    const res = await createEvent(`${TAG} nonsense`, "custom", "single", undefined, "not-an-id");
    expect(res.ok).toBe(true);
    expect(await orgOf("nonsense")).toBe(clubId);
  });
});
