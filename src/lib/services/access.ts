import "server-only";
import { prisma } from "../db";
import type { Role } from "../roles";

/**
 * Two-level access resolution.
 *
 * A person's role in a tournament comes from either:
 *   - an explicit per-event Account ("Sam is an assistant on the club champs"), or
 *   - their organization membership ("Sam is a club admin, so runs every club event")
 *
 * Both are legitimate, and someone can have both at once. When they do, the
 * **higher** privilege wins: a club owner who also entered as a player must not
 * lose the ability to manage their own club's tournament. (Organizers who want
 * to see the player view have the "Viewing as" switch for that.)
 */

const RANK: Record<Role, number> = { player: 0, assistant: 1, admin: 2 };

/**
 * Who belongs to the ORGANIZATION without belonging to the CLUB.
 *
 * `OrganizationMember.role` defaults to "member" and has meant owner, admin or
 * member until now. A charity day needs a fourth kind of person: somebody
 * entered in one event who is not a member of anything — a sponsor, a
 * non-golfing guest, a table at the quiz night. They get a row so the club can
 * find them, and they must not thereby see the men's league.
 *
 * Listed rather than inferred, so the question is asked of a NAME rather than
 * of a rank. A role nobody has thought about — a typo, a value a later feature
 * adds — reads as a member and sees the club, which is the failure that shows
 * up immediately rather than the one that quietly leaks a calendar.
 */
export const ORG_GUEST_ROLES = ["guest"] as const;

export type RoleSource = "event" | "organization";

export interface EffectiveAccess {
  role: Role;
  /** Where the role came from — shown in the access UI so it's clear why
   *  someone has permissions they were never explicitly granted here. */
  source: RoleSource;
  /** The per-event Account id, when one exists. Empty for org-derived access. */
  accountId: string;
  /** Display name, from the Account when present, else the user record. */
  name: string;
}

function normalize(role: string): Role {
  return role === "admin" ? "admin" : role === "assistant" ? "assistant" : "player";
}

/** Organization roles that confer organizer rights on that org's events. */
function orgRoleGrantsAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * The effective role for a person in one tournament, or null if they have no
 * access at all.
 */
export async function effectiveAccess(email: string, eventId: string): Promise<EffectiveAccess | null> {
  const [account, event, user] = await Promise.all([
    prisma.account.findUnique({ where: { eventId_email: { eventId, email } } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true, name: true } }),
  ]);

  const fromEvent: EffectiveAccess | null = account
    ? { role: normalize(account.role), source: "event", accountId: account.id, name: account.name }
    : null;

  let fromOrg: EffectiveAccess | null = null;
  if (user && event) {
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: event.organizationId, userId: user.id } },
    });
    if (membership && orgRoleGrantsAdmin(membership.role)) {
      fromOrg = { role: "admin", source: "organization", accountId: "", name: user.name || email };
    }
  }

  if (fromEvent && fromOrg) return RANK[fromOrg.role] > RANK[fromEvent.role] ? fromOrg : fromEvent;
  return fromEvent ?? fromOrg;
}

export interface AccessReportEvent {
  id: string;
  name: string;
  dates: string;
}

export interface AccessReportPerson {
  email: string;
  name: string;
  /** Organization role, or null for someone who only holds per-event roles. */
  orgRole: string | null;
  /** OrganizationMember id, for the staff controls. Null when not a member. */
  memberId: string | null;
  /** Whether this email has ever signed in (claimed a password). */
  hasLogin: boolean;
  /** Effective role per event, keyed by event id. Absent = no access. */
  access: Record<string, { role: Role; source: RoleSource }>;
}

export interface AccessReport {
  events: AccessReportEvent[];
  people: AccessReportPerson[];
}

/**
 * Who can reach what, across an entire organization.
 *
 * Answers a question the per-event access screen can't: "what can this person
 * actually see?" — which matters once access can be inherited from a club role
 * rather than granted event by event.
 *
 * Covers organization staff and anyone holding a role on one of its events,
 * including players, so it doubles as the club-wide people list that per-event
 * rosters can't provide.
 */
export async function organizationAccessReport(organizationId: string): Promise<AccessReport> {
  const [events, members, accounts] = await Promise.all([
    prisma.event.findMany({
      // The club's tournaments. This report answers "who can see what across
      // the club", and a casual round is not the club's — it is four people's
      // own game, and listing every Sunday fourball buries the events the
      // report exists for.
      where: { organizationId, shape: { not: "match" } },
      select: { id: true, name: true, dates: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { email: true, name: true, password: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.account.findMany({
      where: { event: { organizationId } },
      select: { eventId: true, email: true, name: true, role: true },
    }),
  ]);

  const eventIds = new Set(events.map((e) => e.id));
  const people = new Map<string, AccessReportPerson>();

  const ensure = (email: string, name: string): AccessReportPerson => {
    const existing = people.get(email);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      return existing;
    }
    const created: AccessReportPerson = {
      email,
      name,
      orgRole: null,
      memberId: null,
      hasLogin: false,
      access: {},
    };
    people.set(email, created);
    return created;
  };

  // Organization staff first — they set the baseline.
  for (const m of members) {
    const person = ensure(m.user.email, m.user.name);
    person.orgRole = m.role;
    person.memberId = m.id;
    person.hasLogin = !!m.user.password;
    if (orgRoleGrantsAdmin(m.role)) {
      for (const e of events) person.access[e.id] = { role: "admin", source: "organization" };
    }
  }

  // Explicit per-event roles, which win where they grant more.
  for (const a of accounts) {
    if (!eventIds.has(a.eventId)) continue;
    const person = ensure(a.email, a.name);
    const role = normalize(a.role);
    const existing = person.access[a.eventId];
    if (!existing || RANK[role] > RANK[existing.role]) {
      person.access[a.eventId] = { role, source: "event" };
    }
  }

  // Fill in login status for people who aren't organization members.
  const unknown = [...people.values()].filter((p) => p.memberId === null).map((p) => p.email);
  if (unknown.length) {
    const users = await prisma.user.findMany({
      where: { email: { in: unknown } },
      select: { email: true, password: true, name: true },
    });
    for (const u of users) {
      const person = people.get(u.email);
      if (!person) continue;
      person.hasLogin = !!u.password;
      if (!person.name && u.name) person.name = u.name;
    }
  }

  // Staff first, then most access, then alphabetical — the order someone
  // scanning for "who has too much access" would want.
  const ordered = [...people.values()].sort((a, b) => {
    if (!!a.orgRole !== !!b.orgRole) return a.orgRole ? -1 : 1;
    const diff = Object.keys(b.access).length - Object.keys(a.access).length;
    if (diff !== 0) return diff;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return { events, people: ordered };
}

export interface AccessibleEvent {
  eventId: string;
  role: Role;
  source: RoleSource;
}

/**
 * Every tournament this person can open — those they hold an Account on, plus
 * every event belonging to an organization they own or administer.
 *
 * Without the second half, a club admin couldn't even see the events their
 * colleagues created, which defeats the point of a shared tenant.
 */
export async function accessibleEvents(email: string): Promise<AccessibleEvent[]> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  const accounts = await prisma.account.findMany({
    where: { email },
    select: { eventId: true, role: true },
  });

  const byEvent = new Map<string, AccessibleEvent>();
  for (const a of accounts) {
    byEvent.set(a.eventId, { eventId: a.eventId, role: normalize(a.role), source: "event" });
  }

  if (user) {
    const adminOrgs = await prisma.organizationMember.findMany({
      where: { userId: user.id, role: { in: ["owner", "admin"] } },
      select: { organizationId: true },
    });
    if (adminOrgs.length) {
      const orgEvents = await prisma.event.findMany({
        where: { organizationId: { in: adminOrgs.map((m) => m.organizationId) } },
        select: { id: true },
      });
      for (const e of orgEvents) {
        const existing = byEvent.get(e.id);
        // Org-derived admin only upgrades; never demote an explicit event role.
        if (!existing || RANK[existing.role] < RANK.admin) {
          byEvent.set(e.id, { eventId: e.id, role: "admin", source: "organization" });
        }
      }
    }

    /**
     * AND A PLAIN MEMBER REACHES THEIR OWN CLUB'S TOURNAMENTS — BUT A GUEST
     * DOES NOT.
     *
     * The exception is the charity day, and it is a real one. A club running
     * one enters people who are not golfers and not members: sponsors, a
     * quiz-night table, somebody's employer. They belong to that ONE event and
     * the club has every reason not to show them the men's league, the
     * committee's calendar, or the membership of every other tournament it
     * runs.
     *
     * So club-wide visibility follows MEMBERSHIP, not mere presence in the
     * organization. A guest keeps whatever `Account` rows they were given, so
     * they still reach the event they were invited to and nothing else — which
     * is the behaviour everyone had before this block existed.
     *
     * "Upgrade them to a member" is one field: `role` from `guest` to
     * `member`, and the whole club opens. That is the reversible direction,
     * which is the one to build.
     *
     *
     * `OrganizationMember.role` defaults to "member", and the query above asks
     * only for owners and admins — so somebody who belongs to the club could
     * open NOTHING unless an organizer had added them to a specific tournament
     * by hand. A member browsing what their club is running, and entering
     * themselves, was not possible at all.
     *
     * That is the shape every club system has: you sign in, you see your
     * club's events with their status, you put your name down. Golf Genius and
     * ForeTees both work that way, and it is what Ajay asked for on
     * 2026-09-17.
     *
     * THE ROLE IS `player`, AND THAT IS SAFE BECAUSE WRITES ARE GATED ON THE
     * FIELD, NOT ON THE ROLE. `assertOwnCard` resolves `ownPlayerIds(eventId,
     * email)` and refuses anything outside it; a member who is not entered has
     * no `Player` row, so that set is empty and every card write is refused.
     * The same shape guards the rest — `assertEventPlayer` insists the player
     * is in THIS tournament. Being able to watch is not being able to play,
     * and the app already drew that line where it belongs.
     *
     * It never upgrades: `RANK` keeps an explicit Account role, so a member who
     * is also this event's assistant stays an assistant.
     */
    const memberOrgs = await prisma.organizationMember.findMany({
      where: { userId: user.id, role: { notIn: [...ORG_GUEST_ROLES] } },
      select: { organizationId: true },
    });
    if (memberOrgs.length) {
      const clubEvents = await prisma.event.findMany({
        where: { organizationId: { in: memberOrgs.map((m) => m.organizationId) } },
        select: { id: true },
      });
      for (const e of clubEvents) {
        if (!byEvent.has(e.id)) {
          byEvent.set(e.id, { eventId: e.id, role: "player", source: "organization" });
        }
      }
    }
  }

  return [...byEvent.values()];
}

/**
 * Whether this email already belongs to somebody here.
 *
 * ONE QUESTION, ONE ANSWER. Sign-in, claiming an account and signing up all
 * need to know it, and each worked it out for itself — so they disagreed, and
 * the disagreement had teeth.
 *
 * There are two ways to belong, exactly as there are two ways to be reachable
 * by email (see `organizationsFor`, and the same fault fixed there). `Account`
 * is access to ONE EVENT — a player or an event admin, keyed by `eventId` and
 * email. `OrganizationMember` is club-level staff, created by
 * `addOrganizationMember`, which writes no `Account` row at all.
 *
 * Both auth paths looked only at `Account`, so an assistant invited to a club
 * but not yet added to a specific event was invisible to every route in:
 *
 *   log in  -> no Account, so no needsClaim; fell through to
 *              "Wrong email or password", which is a lie — the email is right
 *              and there simply is no password yet
 *   claim   -> never routed there, and refused anyway with
 *              "No tournament access found for this email"
 *   forgot  -> requestPasswordReset only sends when a password already exists,
 *              so nothing arrived and it reported success regardless
 *   sign up -> silently upserted a password onto their existing row
 *
 * Which left sign-up as the only working door, entered with no sign that it was
 * attaching to an invitation rather than creating something new.
 *
 * It lives here rather than beside the actions because a `"use server"` file
 * turns every export into a public HTTP endpoint, and this one answers "does
 * this address have an account?" — precisely the question the reset flow goes
 * to such lengths not to answer. As a service export it is reachable by the
 * actions and testable against real rows, without being callable from outside.
 */
export async function hasAccess(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  if (!clean) return false;
  const [events, orgs] = await Promise.all([
    prisma.account.count({ where: { email: clean } }),
    prisma.organizationMember.count({ where: { user: { email: clean } } }),
  ]);
  return events > 0 || orgs > 0;
}
