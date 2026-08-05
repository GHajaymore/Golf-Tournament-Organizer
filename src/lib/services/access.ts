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
      where: { organizationId },
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
  }

  return [...byEvent.values()];
}
