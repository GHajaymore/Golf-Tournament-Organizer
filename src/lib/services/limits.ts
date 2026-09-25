import "server-only";
import { prisma } from "../db";
import {
  limitCheck,
  planFor,
  effectiveLimit,
  enforcementEnabled,
  capacityUnderCap,
  DEFAULT_PLAN,
  type LimitKey,
  type LimitResult,
} from "../plans";
import { storedLimitOverrides } from "./platform-limits";

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
 * **When limits bite.** Only when the OWNER switches enforcement on from the
 * console (`enforce`, default off), or a per-org payment provider is attached.
 * A limit without somewhere to upgrade to isn't a business model, it's an
 * outage: it would lock existing organizations out of tournaments they already
 * run, to sell them something that cannot yet be bought. So it stays off until
 * the owner turns it on. `limitStatus` always reports where an organization
 * stands so the UI can say so honestly, enforced or not; the numbers and the
 * switch are both owner-configurable (see plans.ts `effectiveLimit`).
 */

export interface OrgLimits {
  plan: string;
  /** True when refusals are live — the owner switched enforcement on, or a
   *  payment provider is connected for this org. */
  enforced: boolean;
  activeEvents: LimitResult;
  staffSeats: LimitResult;
}

/**
 * Tournaments not yet finished. A completed event costs nothing to keep.
 *
 * CASUAL ROUNDS ARE NOT TOURNAMENTS AND ARE NOT COUNTED. A quick round is the
 * free thing anybody can do — two to eight people, one round, no field, no
 * flights, no club — and it is stored as an `Event` because that is what the
 * app has to hang a card off, not because it is one of the things this
 * allowance is about.
 *
 * Counting them had two consequences, both wrong in the same direction. A
 * Sunday fourball ate a tournament slot the club was paying for; and a club
 * sitting AT its cap could not set up a Sunday fourball at all — the app
 * refusing a free feature on the grounds that a paid one was full.
 *
 * `shape` is the right question here in a way it is not for the expiry sweep,
 * and the difference is worth stating because the two rules look alike. This
 * asks "is this a tournament?", which is precisely what shape records. The
 * sweep asks "may this row be destroyed?", which shape does not record — and
 * being wrong here undercounts an allowance by one, while being wrong there
 * deletes somebody's tournament.
 */
export async function activeEventCount(organizationId: string): Promise<number> {
  return prisma.event.count({
    where: { organizationId, NOT: { status: "completed" }, shape: { not: "match" } },
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

/**
 * Whether refusals are live for this organization.
 *
 * Two ways to switch on, and either suffices. The OWNER's master switch
 * (`enforce`, set from the console, default off) turns refusals on across every
 * organization at once — the lever to pull the day there is somewhere to
 * upgrade to. Independently, a per-org payment provider turns them on for that
 * org, which is the future billing path. Off on both means nothing is ever
 * refused, which is the state every organization that predates billing sits in.
 */
async function enforcementActive(organizationId: string): Promise<boolean> {
  if (enforcementEnabled(await storedLimitOverrides())) return true;
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  return !!sub && sub.provider.trim() !== "";
}

/** Where an organization stands, whether or not limits are being enforced. */
export async function limitStatus(organizationId: string): Promise<OrgLimits> {
  const [sub, events, seats, enforced, overrides] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId } }),
    activeEventCount(organizationId),
    staffSeatCount(organizationId),
    enforcementActive(organizationId),
    storedLimitOverrides(),
  ]);
  const plan = sub?.plan ?? DEFAULT_PLAN;
  return {
    plan: planFor(plan).key,
    enforced,
    activeEvents: limitCheck(plan, "activeEvents", events, overrides),
    staffSeats: limitCheck(plan, "staffSeats", seats, overrides),
  };
}

/**
 * May this organization add one more of something?
 *
 * Returns null to allow, or a message to show. Allows unconditionally while
 * enforcement is off — see `enforcementActive` above. The configured limit is
 * read through `limitCheck`, so an owner override moves the gate with it.
 */
export async function refusalFor(organizationId: string, limit: LimitKey): Promise<string | null> {
  if (!(await enforcementActive(organizationId))) return null;

  const [sub, overrides] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId } }),
    storedLimitOverrides(),
  ]);
  const current =
    limit === "staffSeats" ? await staffSeatCount(organizationId) : await activeEventCount(organizationId);
  const result = limitCheck(sub?.plan ?? DEFAULT_PLAN, limit, current, overrides);
  return result.allowed ? null : (result.reason ?? "That would exceed your plan.");
}

/**
 * The capacity an intake should actually use: the organizer's own capacity,
 * tightened to the tier's field cap when enforcement is on.
 *
 * A NO-OP while enforcement is off or the tier is uncapped — it returns the
 * organizer's own capacity unchanged, so nothing about how a club takes entries
 * changes until the owner turns limits on. `0` means unlimited on both sides:
 * an unlimited organizer capacity becomes the tier cap, and an unlimited tier
 * leaves the organizer's number alone.
 */
export async function effectiveCapacity(
  organizationId: string,
  organizerCapacity: number,
): Promise<number> {
  if (!(await enforcementActive(organizationId))) return organizerCapacity;

  const [sub, overrides] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId } }),
    storedLimitOverrides(),
  ]);
  const cap = effectiveLimit(planFor(sub?.plan ?? DEFAULT_PLAN), "playersPerEvent", overrides);
  return capacityUnderCap(organizerCapacity, cap);
}
