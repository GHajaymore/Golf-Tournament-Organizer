import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * TWO PEOPLE FROM ONE LEAGUE, BOTH SETTING IT UP.
 *
 * `Organization.name` has no uniqueness and nothing ever looked, so the second
 * secretary of a Thursday league got their own tenant with the same name and
 * nobody was told. The cost is not an untidy list: it is the league's ROSTER
 * SPLIT IN HALF, two calendars, two subscriptions, and members invited into
 * whichever half their organizer happened to be in.
 *
 * Ajay, 2026-09-17: "warn them first … the big customers like Clubs will not
 * have this problem but it will be a real problem for local leagues or
 * community/society golf or outings."
 *
 * So these cells are about a QUESTION, not a refusal. Two real outfits do share
 * a name, and the one thing this must never do is stop the second of them
 * getting started — `org-name-match.ts` carries that reasoning and
 * `org-name-match.test.ts` pins the matching itself. This file proves the four
 * things that need real rows: that the question is asked before anything is
 * created, that answering it creates the thing anyway, that it is not asked of
 * people it would be nonsense for, and that nothing is created while it is
 * being asked.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ONECLUB";
const LEAGUE = `${TAG} Thursday Night League`;

const session = {
  email: "",
  name: "",
  eventId: "",
  role: "admin",
  viewRole: "admin",
};
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
  requireStaff: async () => session.eventId,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { createEvent } = await import("@/app/actions/tournament");

/** The second secretary: signed up, owns nothing but their own empty tenant. */
const second = { email: `${TAG.toLowerCase()}-second@example.invalid`, name: `${TAG} Second Secretary` };

/**
 * BY THE MARK, every row — which `audit-guards.test.ts` insists on and caught
 * this file failing. Collecting organizations into a list of ids and deleting
 * those works right up until a run dies between the two, and then a club sits
 * in the development database for ever with nothing tying it to this test.
 */
async function scrub() {
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  // Events first: this file's own are marked, but `createEvent` names the club
  // and the tournament separately and a cell may yet create one that is not.
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) {
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  }
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

/**
 * A person with a signed-up-but-unnamed organization of their own.
 *
 * With one member on it, because a society cannot create a tournament until
 * its roster has somebody in it — `orgSetupState`'s "Add your members" step,
 * which is a REAL gate and not this file's subject. Without it four of these
 * cells measured that rule instead of this one, which is the shape CLAUDE.md
 * warns about: a fixture that cannot express the answer you are asking for.
 */
async function organizerWithNothing(email: string, name: string, kind = "community") {
  const user = await prisma.user.create({ data: { email, name, password: "x:unusable" } });
  const org = await prisma.organization.create({
    // Named after the person, which is what sign-up does and what
    // `organizationWasNamed` reads as "not named yet".
    data: { name, kind, members: { create: { userId: user.id, role: "owner" } } },
  });
  await prisma.member.create({
    data: { organizationId: org.id, name: `${TAG} A Member`, email: `${TAG.toLowerCase()}-m-${org.id}@example.invalid` },
  });
  return { userId: user.id, organizationId: org.id };
}

beforeAll(async () => {
  await scrub();
  // The league that is already here, with a town on it: the town is what makes
  // "which one?" answerable for a name like this.
  const first = await organizerWithNothing(`${TAG.toLowerCase()}-first@example.invalid`, `${TAG} First Secretary`);
  await prisma.organization.update({
    where: { id: first.organizationId },
    data: { name: LEAGUE, city: "Cincinnati", region: "OH" },
  });
});

beforeEach(async () => {
  // Each cell starts with the second secretary freshly signed up and owning
  // nothing named — the state the app puts them in.
  await prisma.user.deleteMany({ where: { email: second.email } });
  await prisma.organization.deleteMany({ where: { name: second.name } });
  await organizerWithNothing(second.email, second.name);
  session.email = second.email;
  session.name = second.name;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** How many outfits carry the league's name right now. */
const namedLikeTheLeague = () => prisma.organization.count({ where: { name: LEAGUE } });

describe("a second person setting up an outfit that is already here", () => {
  it("is asked about it, and nothing is created while the question stands", async () => {
    const before = await namedLikeTheLeague();
    const res = await createEvent(`${TAG} Week 1`, "custom", "series", LEAGUE);

    expect(res.ok, "created a second league without asking").toBe(false);
    expect(res.clubExists).toBe(LEAGUE);
    // The town, because "that name is taken" is unanswerable for a league
    // named after the night it plays.
    expect(res.error).toContain("Cincinnati");
    expect(res.error).toMatch(/roster/);

    expect(await namedLikeTheLeague(), "a second outfit was created anyway").toBe(before);
    expect(
      await prisma.event.count({ where: { name: `${TAG} Week 1` } }),
      "the tournament was created while the question was still being asked",
    ).toBe(0);
  });

  it("names who runs it, and never their email address", async () => {
    /**
     * Ajay: "can we provide name so the person who is trying to create a new
     * one knows who to check or contact with?"
     *
     * A NAME. The email address of somebody else's owner is not ours to hand
     * to a stranger who guessed a club name, and the second half of this cell
     * is the half that matters.
     */
    const res = await createEvent(`${TAG} Week 6`, "custom", "series", LEAGUE);
    expect(res.error).toContain("run by");
    expect(res.error).toContain("First Secretary");
    expect(res.error, "handed out somebody else's email address").not.toContain("@");
  });

  it("stays quiet about a namesake in another state", async () => {
    /**
     * Ajay asked for fifty miles. The app has no coordinates — an outfit's
     * location is free text — so `inTheSameArea` approximates it by county or
     * state and this cell pins the direction that matters: a league of the
     * same name two states away is a different league and is not mentioned.
     */
    await prisma.organization.updateMany({
      where: { name: second.name },
      data: { city: "Austin", region: "TX", country: "US" },
    });
    const res = await createEvent(`${TAG} Week 7`, "custom", "series", LEAGUE);
    expect(res.clubExists, "warned about a league two states away").toBeUndefined();
    expect(res.ok, res.error).toBe(true);
  });

  it("creates it anyway when they say it is a different one", async () => {
    const before = await namedLikeTheLeague();
    const res = await createEvent(`${TAG} Week 2`, "custom", "series", LEAGUE, undefined, true);

    // A WARNING, NOT A GATE. Two real outfits share a name, and refusing the
    // second of them is refusing a customer.
    expect(res.ok, res.error).toBe(true);
    expect(await namedLikeTheLeague()).toBe(before + 1);
  });

  it("says nothing when the name is their own", async () => {
    const res = await createEvent(`${TAG} Week 3`, "custom", "series", `${TAG} Saturday Swindle`);
    expect(res.ok, res.error).toBe(true);
    expect(res.clubExists).toBeUndefined();
  });

  it("says nothing to somebody whose outfit already has a name", async () => {
    /**
     * The box does not rename an organization that has been named — that is
     * `nameIfStillUnnamed`'s rule — so a warning here would describe something
     * that is not about to happen. The question and the write read the same
     * function, which is the point of `wouldTakeThisName`.
     */
    await prisma.organization.updateMany({
      where: { name: second.name },
      data: { name: `${TAG} Already Named Society` },
    });
    const res = await createEvent(`${TAG} Week 4`, "custom", "series", LEAGUE);
    expect(res.clubExists, "warned about a name it was never going to apply").toBeUndefined();
    expect(res.ok, res.error).toBe(true);
  });

  it("never points at somebody's personal tenant", async () => {
    /**
     * A `personal` organization is named after a person by sign-up. It is
     * nobody's club, and "ask them to add you" is the wrong thing to say about
     * a stranger's private workspace.
     */
    const solo = `${TAG} Pat Q. Namesake`;
    await prisma.organization.create({ data: { name: solo, kind: "personal" } });
    const res = await createEvent(`${TAG} Week 5`, "custom", "series", solo);
    expect(res.clubExists, "offered up a personal tenant as a club to join").toBeUndefined();
    expect(res.ok, res.error).toBe(true);
  });
});
