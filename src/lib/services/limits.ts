import "server-only";
import { prisma } from "../db";
import { limitCheck, planFor, DEFAULT_PLAN, type LimitKey, type LimitResult } from "../plans";

/**
 * Plan limits, enforced.
 *
 * Two things had to be settled before this could be wired up, and both are
 * decisions rather than code:
 *
 * **What counts as a staff seat.** Organization membership alone would have
 * made the limit meaningless: per-event Accounts also carry organizer and
 * assistant roles, so anyone could add unlimited staff by granting them on
 * each event instead. A seat is therefore any *person* holding organizer or
 * assistant rights anywhere in the organization, deduplicated by email.
 * Players are never counted — that constraint is the whole point of the
 * pricing, and counting them here would quietly undo it.
 *
 * **When limits bite.** Only once billing is actually connected. A limit
 * without a paid tier to upgrade to isn't a business model, it's an outage:
 * it would lock existing organizations out of tournaments they already run,
 * to sell them something that cannot yet be bought. `limitStatus` always
 * reports where an organization stands so the UI can say so honestly; the
 * enforcing calls only refuse once a payment provider is attached.
 */

export interface OrgLimits {
  plan: string;
  /** True when refusals are live — a payment provider is connected. */
  enforced: boolean;
  activeEvents: LimitResult;
  staffSeats: LimitResult;
}

/** Tournaments not yet finished. A completed event costs nothing to keep. */
export async function activeEventCount(organizationId: string): Promise<number> {
  return prisma.event.count({
    where: { organizationId, NOT: { status: "completed" } },
  });
}

/**
 * People with organizer or assistant rights anywhere in this organization.
 *
 * Deduplicated by lowercased email, because the same person routinely appears
 * both as club staff and as an organizer named on one event, and charging for
 * them twice would be wrong in the direction that loses trust.
 */
export async function staffSeatCount(organizationId: string): Promise<number> {
  const [members, accounts] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId, role: { in: ["owner", "admin"] } },
      include: { user: { select: { email: true } } },
    }),
    prisma.account.findMany({
      where: { event: { organizationId }, role: { in: ["admin", "assistant"] } },
      select: { email: true },
    }),
  ]);

  const seats = new Set<string>();
  for (const m of members) seats.add(m.user.email.trim().toLowerCase());
  for (const a of accounts) {
    const e = a.email.trim().toLowerCase();
    if (e) seats.add(e);
  }
  return seats.size;
}

/** Whether refusals are live for this organization. */
export async function enforcementActive(organizationId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  return !!sub && sub.provider.trim() !== "";
}

/** Where an organization stands, whether or not limits are being enforced. */
export async function limitStatus(organizationId: string): Promise<OrgLimits> {
  const [sub, events, seats, enforced] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId } }),
    activeEventCount(organizationId),
    staffSeatCount(organizationId),
    enforcementActive(organizationId),
  ]);
  const plan = sub?.plan ?? DEFAULT_PLAN;
  return {
    plan: planFor(plan).key,
    enforced,
    activeEvents: limitCheck(plan, "activeEvents", events),
    staffSeats: limitCheck(plan, "staffSeats", seats),
  };
}

/**
 * May this organization add one more of something?
 *
 * Returns null to allow, or a message to show. Allows unconditionally while
 * billing is unconnected — see the note at the top of this file.
 */
export async function refusalFor(organizationId: string, limit: LimitKey): Promise<string | null> {
  if (!(await enforcementActive(organizationId))) return null;

  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  const current =
    limit === "activeEvents"
      ? await activeEventCount(organizationId)
      : await staffSeatCount(organizationId);
  const result = limitCheck(sub?.plan ?? DEFAULT_PLAN, limit, current);
  return result.allowed ? null : (result.reason ?? "That would exceed your plan.");
}
