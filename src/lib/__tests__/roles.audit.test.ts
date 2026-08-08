import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { effectiveAccess, accessibleEvents } from "../services/access";
import { canAccessScreen, SCREEN_ACCESS, ROLES, type Role } from "../roles";
import { navForRole, NAV } from "../nav";
import { canSeeLeaderboard, canEnterScores, cleanSettings } from "../tournament-settings";

/**
 * Who can reach what, proved against the real database.
 *
 * The unit suites check the rules; this checks the wiring. Roles here come
 * from three different places — an Account row on the event, an
 * OrganizationMember row on the club, or neither — and the interesting
 * failures all live in how those combine. A person can hold two roles at once,
 * a club role can confer rights on events nobody granted explicitly, and an
 * email is a string that two tables have to agree on.
 *
 * Excluded from the default run: needs a live DATABASE_URL and writes rows.
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROLES";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let orgId = "";
let otherOrgId = "";
let eventId = "";
let siblingEventId = "";
let foreignEventId = "";

const newEvent = (organizationId: string, name: string, token: string) => ({
  organizationId,
  name: `${TAG} ${name}`,
  dates: "",
  course: "",
  city: "",
  address: "",
  regDeadline: "",
  shareToken: `${TAG}-${token}-${Date.now()}`,
});

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({
    where: { user: { email: { startsWith: TAG.toLowerCase() } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const other = await prisma.organization.create({ data: { name: `${TAG} rival`, kind: "club" } });
  orgId = org.id;
  otherOrgId = other.id;

  const [ev, sibling, foreign] = await Promise.all([
    prisma.event.create({ data: newEvent(org.id, "spring medal", "a") }),
    prisma.event.create({ data: newEvent(org.id, "autumn cup", "b") }),
    prisma.event.create({ data: newEvent(other.id, "rival open", "c") }),
  ]);
  eventId = ev.id;
  siblingEventId = sibling.id;
  foreignEventId = foreign.id;

  // Users who exist as people, independent of any one tournament.
  for (const who of ["owner", "clubmember", "playeronly", "outsider", "dualrole"]) {
    await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
  }
  const owner = await prisma.user.findUnique({ where: { email: at("owner") } });
  const clubMember = await prisma.user.findUnique({ where: { email: at("clubmember") } });
  const dual = await prisma.user.findUnique({ where: { email: at("dualrole") } });

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: owner!.id, role: "owner" },
      // "member" is deliberately NOT a role that confers event access.
      { organizationId: org.id, userId: clubMember!.id, role: "member" },
      { organizationId: org.id, userId: dual!.id, role: "owner" },
    ],
  });

  // Per-event grants on the first event only.
  await prisma.account.createMany({
    data: [
      { eventId: ev.id, email: at("admin"), name: "Admin", role: "admin" },
      { eventId: ev.id, email: at("assistant"), name: "Assistant", role: "assistant" },
      { eventId: ev.id, email: at("playeronly"), name: "Player", role: "player" },
      // Holds a club owner role AND a mere player grant on this event.
      { eventId: ev.id, email: at("dualrole"), name: "Dual", role: "player" },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("who holds which role", () => {
  it("reads a per-event grant", async () => {
    expect((await effectiveAccess(at("admin"), eventId))?.role).toBe("admin");
    expect((await effectiveAccess(at("assistant"), eventId))?.role).toBe("assistant");
    expect((await effectiveAccess(at("playeronly"), eventId))?.role).toBe("player");
  });

  it("gives a club owner organizer rights on the club's events without an explicit grant", async () => {
    const a = await effectiveAccess(at("owner"), eventId);
    expect(a?.role).toBe("admin");
    expect(a?.source).toBe("organization");
    // Including events they were never named on at all.
    expect((await effectiveAccess(at("owner"), siblingEventId))?.role).toBe("admin");
  });

  it("does NOT extend a club owner's rights to another club's events", async () => {
    expect(await effectiveAccess(at("owner"), foreignEventId)).toBeNull();
  });

  it("gives a plain club member nothing", async () => {
    // "member" exists for roster purposes. If it ever started conferring
    // access, every club member would silently become an organizer.
    expect(await effectiveAccess(at("clubmember"), eventId)).toBeNull();
    expect(await effectiveAccess(at("clubmember"), siblingEventId)).toBeNull();
  });

  it("gives someone with no grant at all nothing", async () => {
    expect(await effectiveAccess(at("outsider"), eventId)).toBeNull();
    // Not even a user record — the unauthenticated-stranger case.
    expect(await effectiveAccess("nobody@example.invalid", eventId)).toBeNull();
  });

  it("takes the HIGHER of two roles when someone holds both", async () => {
    // A club owner who is also entered as a player is still the organizer.
    // This is the documented rule, and it is precisely why a guard must check
    // `role !== "admin"` rather than "is there any access at all" — the latter
    // reads as true for every player in the field.
    const a = await effectiveAccess(at("dualrole"), eventId);
    expect(a?.role).toBe("admin");
    expect(a?.source).toBe("organization");
  });

  it("a player on one event has nothing on its sibling", async () => {
    // Roles are per tournament, not per club. Sharing them would let anyone
    // entered in one event read every other event the club runs.
    expect(await effectiveAccess(at("playeronly"), siblingEventId)).toBeNull();
    expect(await effectiveAccess(at("admin"), siblingEventId)).toBeNull();
  });

  it("matches emails exactly as stored, so a grant is never silently missed", async () => {
    // Account is keyed on (eventId, email). If the app writes a mixed-case
    // address anywhere it also looks one up, the grant becomes invisible and
    // the person is locked out of a tournament they were invited to.
    const stored = await prisma.account.findMany({
      where: { eventId },
      select: { email: true },
    });
    for (const a of stored) {
      expect(a.email, "grants must be stored lowercased").toBe(a.email.toLowerCase());
    }
    expect(await effectiveAccess(at("admin").toUpperCase(), eventId)).toBeNull();
  });

  it("lists exactly the events a person can open", async () => {
    const forPlayer = await accessibleEvents(at("playeronly"));
    expect(forPlayer.map((e) => e.eventId)).toEqual([eventId]);
    expect(forPlayer[0].role).toBe("player");

    const forOwner = await accessibleEvents(at("owner"));
    const ownerIds = forOwner.map((e) => e.eventId);
    expect(ownerIds).toContain(eventId);
    expect(ownerIds).toContain(siblingEventId);
    expect(ownerIds).not.toContain(foreignEventId);
    expect(forOwner.every((e) => e.role === "admin")).toBe(true);

    expect((await accessibleEvents(at("outsider"))).map((e) => e.eventId)).not.toContain(eventId);
  });
});

describe("what each role can open", () => {
  it("covers every screen in the sidebar", async () => {
    // A screen missing from SCREEN_ACCESS is unreachable by everyone, which
    // would show up as a dead link rather than an error.
    for (const section of NAV) {
      for (const item of section.items) {
        expect(SCREEN_ACCESS[item.key], `${item.key} has no access rule`).toBeTruthy();
      }
    }
  });

  it("never puts a link in the sidebar the guard would refuse", async () => {
    for (const role of ROLES) {
      const shown = navForRole(role, undefined, { hasTeamRound: true })
        .flatMap((s) => s.items)
        .map((i) => i.key);
      for (const key of shown) {
        expect(canAccessScreen(role, key), `${role} shown ${key} but cannot open it`).toBe(true);
      }
    }
  });

  it("keeps players out of every setup and results screen", async () => {
    const forbidden = [
      "event", "access", "organization", "roster", "series", "registration",
      "stages", "grouping", "teams", "foursomes", "scorecard", "qualification",
      "announcements", "prizes", "reports",
    ];
    for (const key of forbidden) {
      expect(canAccessScreen("player", key), `player must not open ${key}`).toBe(false);
    }
  });

  it("lets an assistant run the event but not reshape it", async () => {
    for (const key of ["registration", "stages", "grouping", "teams", "foursomes", "entry", "reports"]) {
      expect(canAccessScreen("assistant", key), key).toBe(true);
    }
    // Changing who has access, or the event's own identity, stays with the
    // organizer.
    for (const key of ["event", "access", "organization"]) {
      expect(canAccessScreen("assistant", key), key).toBe(false);
    }
  });

  it("gives an admin everything", async () => {
    for (const key of Object.keys(SCREEN_ACCESS)) {
      expect(canAccessScreen("admin", key), key).toBe(true);
    }
  });

  it("refuses an unknown screen key for every role", async () => {
    for (const role of ROLES) {
      expect(canAccessScreen(role, "backdoor"), role).toBe(false);
      expect(canAccessScreen(role, ""), role).toBe(false);
    }
  });

  it("refuses an unknown role rather than defaulting it open", async () => {
    // Account.role is free text, so a typo or a hand-edited row lands here.
    const rogue = "superadmin" as Role;
    for (const key of Object.keys(SCREEN_ACCESS)) {
      expect(canAccessScreen(rogue, key), key).toBe(false);
    }
  });
});

describe("what the tournament's own settings hide", () => {
  const settings = (over: Record<string, string>) =>
    cleanSettings({
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "email",
      scoreApproval: "staff",
      ...over,
    });

  it("hides the leaderboard AND the bracket from players in a blind event", async () => {
    // The bracket is seeded from live standings, so leaving it visible would
    // give away the order the leaderboard is hiding.
    const blind = settings({ leaderboardVisibility: "staff" });
    expect(canSeeLeaderboard(blind, "player")).toBe(false);

    const shown = navForRole("player", blind).flatMap((s) => s.items).map((i) => i.key);
    expect(shown).not.toContain("leaderboard");
    expect(shown).not.toContain("bracket");
  });

  it("still shows both to staff in a blind event", async () => {
    const blind = settings({ leaderboardVisibility: "staff" });
    for (const role of ["admin", "assistant"] as const) {
      expect(canSeeLeaderboard(blind, role), role).toBe(true);
      const shown = navForRole(role, blind).flatMap((s) => s.items).map((i) => i.key);
      expect(shown, role).toContain("leaderboard");
    }
  });

  it("hides score entry from players when the organizer keeps the cards", async () => {
    const staffScored = settings({ scoreEntryBy: "staff" });
    expect(canEnterScores(staffScored, "player")).toBe(false);
    expect(canEnterScores(staffScored, "assistant")).toBe(true);

    const shown = navForRole("player", staffScored).flatMap((s) => s.items).map((i) => i.key);
    expect(shown).not.toContain("entry");
  });

  it("leaves a player with a usable app rather than an empty shell", async () => {
    // Everything off at once is a legitimate configuration — a staff-scored
    // blind event. A player still has to land somewhere.
    const locked = settings({ leaderboardVisibility: "staff", scoreEntryBy: "staff" });
    const sections = navForRole("player", locked);
    const shown = sections.flatMap((s) => s.items).map((i) => i.key);
    expect(shown).toContain("dashboard");
    expect(sections.every((s) => s.items.length > 0), "no empty sidebar sections").toBe(true);
  });

  it("only offers Teams once a round actually uses a team format", async () => {
    const withTeams = navForRole("admin", undefined, { hasTeamRound: true })
      .flatMap((s) => s.items).map((i) => i.key);
    const without = navForRole("admin", undefined, { hasTeamRound: false })
      .flatMap((s) => s.items).map((i) => i.key);
    expect(withTeams).toContain("teams");
    expect(without).not.toContain("teams");
  });
});

describe("removing access actually removes it", () => {
  it("drops a per-event grant when the account is deleted", async () => {
    const ev = await prisma.event.create({ data: newEvent(orgId, "revoke test", "d") });
    await prisma.account.create({
      data: { eventId: ev.id, email: at("outsider"), name: "Temp", role: "admin" },
    });
    expect((await effectiveAccess(at("outsider"), ev.id))?.role).toBe("admin");

    await prisma.account.deleteMany({ where: { eventId: ev.id, email: at("outsider") } });
    expect(await effectiveAccess(at("outsider"), ev.id)).toBeNull();

    await prisma.event.delete({ where: { id: ev.id } });
  });

  it("drops inherited access when the club membership is removed", async () => {
    const user = await prisma.user.findUnique({ where: { email: at("owner") } });
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user!.id } },
    });
    await prisma.organizationMember.delete({ where: { id: membership!.id } });
    expect(await effectiveAccess(at("owner"), eventId)).toBeNull();

    // Put it back so ordering between tests can't matter.
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: user!.id, role: "owner" },
    });
    expect((await effectiveAccess(at("owner"), eventId))?.role).toBe("admin");
  });

  it("takes every grant with the event when the event is deleted", async () => {
    const ev = await prisma.event.create({ data: newEvent(orgId, "cascade test", "e") });
    await prisma.account.create({
      data: { eventId: ev.id, email: at("outsider"), name: "Temp", role: "player" },
    });
    await prisma.event.delete({ where: { id: ev.id } });
    expect(await prisma.account.count({ where: { eventId: ev.id } })).toBe(0);
  });
});
