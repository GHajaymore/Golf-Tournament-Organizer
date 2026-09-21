import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const session = { email: "", name: "", id: "" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => (session.email ? { ...session } : null),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { enterThisTournament } from "@/app/actions/enter";

/**
 * A MEMBER PUTS THEIR NAME DOWN WITHOUT FILLING ANYTHING IN.
 *
 * `/register/[token]` is the PUBLIC form — its own comment says "there is no
 * session here at all" — and it asks for a name, an email, a handicap and a
 * tee. A signed-in member has all four on the club's roster and was being sent
 * to retype them to enter their own club's tournament.
 *
 * WHAT IS ASSERTED IS THE THREE THINGS THAT COULD GO WRONG rather than the
 * happy path alone:
 *
 *   - the entry carries the ROSTER's figures, so a club's handicap is what
 *     gets entered and nothing reaches this action that could rewrite it;
 *   - it lands where `decideIntake` puts it — a full field waitlists and an
 *     approve-mode club gets a pending entry — because a second copy of that
 *     rule is how a club ends with two front doors and two capacity policies;
 *   - and the EVENT ID IS THE CALLER'S. A "use server" export is a public HTTP
 *     endpoint; a member of one club must not enter another club's tournament
 *     by posting its id.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-one-tap";

/**
 * A FRESH ADDRESS EVERY RUN, because the limiter outlives the fixture.
 *
 * `enterThisTournament` is rate limited on the EMAIL at six an hour, and the
 * counters live in Postgres so that they mean something across instances —
 * which also means they survive this file deleting its own rows. A fixed
 * address made the second run inside an hour fail on the limiter before
 * reaching any of the logic below, and every assertion then reported the
 * limiter rather than the rule it was written for.
 */
const WHO = `${TAG}-${randomBytes(4).toString("hex")}`;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function club(name: string) {
  return prisma.organization.create({ data: { name: `${TAG} ${name}`, kind: "club" }, select: { id: true } });
}

async function tournament(orgId: string, name: string, extra: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} Course`,
      city: `${TAG} Town`,
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: true,
      registrationApproval: "auto",
      registrationToken: randomBytes(6).toString("hex"),
      shareToken: randomBytes(10).toString("hex"),
      ...extra,
    },
    select: { id: true },
  });
}

let open = "";
let full = "";
let approves = "";
let otherClub = "";

beforeAll(async () => {
  await cleanup();
  const org = await club("home");
  const away = await club("somebody else");

  const user = await prisma.user.create({
    data: { email: `${WHO}@example.invalid`, name: `${TAG} Member Account` },
    select: { id: true, email: true, name: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "member" },
  });
  session.email = user.email;
  session.name = user.name;
  session.id = user.id;

  /**
   * The CLUB's record of this person, which is the whole point: a name and a
   * handicap the member never types, and which this action must use.
   */
  await prisma.member.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Roster Name`,
      email: user.email,
      handicap: 11.4,
      handicapType: "18",
      handicapSource: "ghin",
      preferredTee: "White",
    },
  });

  open = (await tournament(org.id, "open with room")).id;
  full = (await tournament(org.id, "full", { capacity: 1 })).id;
  approves = (await tournament(org.id, "approve mode", { registrationApproval: "approve" })).id;
  otherClub = (await tournament(away.id, "not my club")).id;

  // One confirmed entrant, so the capacity-1 tournament is full.
  await prisma.player.create({
    data: {
      eventId: full,
      name: `${TAG} somebody`,
      email: `${TAG}-somebody@example.invalid`,
      handicap: 8,
      seed: 1,
      status: "confirmed",
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const entryIn = (eventId: string) =>
  prisma.player.findFirst({ where: { eventId, email: { equals: session.email, mode: "insensitive" } } });

describe("a member entering their own club's tournament", () => {
  it("is in, with the club's own name and handicap", async () => {
    const res = await enterThisTournament(open);
    expect(res).toMatchObject({ ok: true, status: "confirmed" });

    const row = await entryIn(open);
    expect(row, "no entry was written").toBeTruthy();
    // The ROSTER's figures, not the account's and not anything typed.
    expect(row!.name).toBe(`${TAG} Roster Name`);
    expect(row!.handicap).toBe(11.4);
    expect(row!.handicapSource).toBe("ghin");
    expect(row!.preferredTee).toBe("White");
    // Linked to the club's record, so their history spans events.
    expect(row!.memberId, "the entry is not tied to the member").toBeTruthy();
  });

  it("refuses a second tap rather than entering twice", async () => {
    const res = await enterThisTournament(open);
    expect(res.ok).toBe(false);
    expect(res.status, "it should say where they already are").toBe("confirmed");
    expect(await prisma.player.count({ where: { eventId: open } })).toBe(1);
  });

  it("lets a member who WITHDREW enter again", async () => {
    /**
     * A WITHDRAWN ROW IS NOT AN ENTRY, and the guard matched one.
     *
     * Its own comment named three statuses — confirmed, waitlisted, pending —
     * and the query named none, so it matched the fourth too. A member who
     * withdrew was refused with "Your name is already down for this one."
     * Their name was not down; they took it off.
     *
     * The Events screen had it right and the ACTION had it wrong, which is the
     * worse way round: `club-events.ts` counts `enteredIn` as confirmed only
     * and `waitingIn` as waitlisted-or-pending, so a withdrawn member is
     * correctly offered the Enter button — and then the button refused them.
     *
     * Never seen because `withdrawn` had ZERO rows in the development
     * database. A state the fixture cannot express is a state nobody walks.
     */
    const before = await entryIn(open);
    expect(before, "this test needs the earlier entry to exist").toBeTruthy();
    await prisma.player.update({ where: { id: before!.id }, data: { status: "withdrawn" } });

    const res = await enterThisTournament(open);
    expect(res, "a withdrawn member was refused their own re-entry").toMatchObject({
      ok: true,
      status: "confirmed",
    });

    /**
     * THE WITHDRAWN ROW SURVIVES, beside the new one rather than instead of it.
     * `removeSignup` keeps it precisely because a confirmed `ContestEntry` — a
     * stake the organizer has already taken — outlives their place in the
     * field, and re-confirming it in place would tie that money to the new
     * entry. `roster-link.ts` is built for a member holding several rows.
     */
    const rows = await prisma.player.findMany({
      where: { eventId: open, email: { equals: session.email, mode: "insensitive" } },
      select: { status: true },
    });
    expect(rows.map((r) => r.status).sort()).toEqual(["confirmed", "withdrawn"]);

    // Put the fixture back: the tests after this one expect one confirmed row.
    await prisma.player.deleteMany({ where: { eventId: open, status: "withdrawn" } });
  });

  it("still refuses a second tap from somebody genuinely entered", async () => {
    /**
     * THE CONTROL on the change above. Narrowing the guard is satisfied
     * perfectly by removing it, which would enter everybody twice — so the
     * refusal it exists for has to keep working in the same run.
     */
    const res = await enterThisTournament(open);
    expect(res.ok, "the duplicate guard was removed rather than narrowed").toBe(false);
    expect(res.status).toBe("confirmed");
    expect(await prisma.player.count({ where: { eventId: open } })).toBe(1);
  });

  it("goes on the waiting list when the field is full", async () => {
    // `decideIntake`'s rule, not a second copy of it.
    const res = await enterThisTournament(full);
    expect(res).toMatchObject({ ok: true, status: "waitlisted" });
    expect((await entryIn(full))!.status).toBe("waitlisted");
  });

  it("goes to the organizer when the club approves entries by hand", async () => {
    const res = await enterThisTournament(approves);
    expect(res).toMatchObject({ ok: true, status: "pending" });
    expect((await entryIn(approves))!.status).toBe("pending");
  });
});

describe("the event id comes from the caller", () => {
  it("refuses a tournament belonging to a club they are not in", async () => {
    /**
     * THE ONE THAT MATTERS. A "use server" export is a public HTTP endpoint and
     * will be called with whatever the caller likes. `join.ts` refuses to take
     * an organization id for exactly this reason; this takes an event id and so
     * has to check it.
     */
    const res = await enterThisTournament(otherClub);
    expect(res.ok).toBe(false);
    expect(await entryIn(otherClub), "they entered another club's tournament").toBeNull();
    // And the refusal says nothing about whether that tournament exists.
    expect(res.error).not.toContain("club");
  });

  it("refuses an id that is not a tournament at all", async () => {
    const res = await enterThisTournament("not-an-id");
    expect(res.ok).toBe(false);
  });

  it("refuses when nobody is signed in", async () => {
    // The control on the whole file: every case above runs as a real member,
    // so without this the action could be accepting everybody.
    const held = session.email;
    session.email = "";
    try {
      const res = await enterThisTournament(open);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Sign in");
    } finally {
      session.email = held;
    }
  });
});
