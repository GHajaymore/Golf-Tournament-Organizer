import "server-only";
import { prisma } from "../db";
import { brandForEvent, type EventBrand } from "./organization";
import { registrationStatus } from "../registration";
import { approvalModeOf, type ApprovalMode } from "../domain/registration-intake";
import { planForOrganization } from "./entitlements";
import { phoneRequiredFor } from "../plans";

/**
 * What the public /register/[token] page is allowed to know.
 *
 * The hard rule here is the same one /live keeps: a bogus token and a closed
 * registration must be indistinguishable. So this returns a view ONLY when the
 * link is genuinely live — open, before the deadline, for a real token — and
 * null for every other case lumped together (unknown token, switched off,
 * deadline passed, manually closed). The page renders one neutral "not open"
 * state for null and never leaks the event's existence.
 *
 * When it does return a view it carries only what a prospective entrant should
 * see: the club's brand, the event's public facts, and whether the field is
 * full (so the form can say "waitlist only"). No emails, no roster, no counts
 * beyond spots-left — the same discipline as the /live audit.
 */

export interface PublicRegistrationView {
  /** Never the raw id — only the token the visitor already has. */
  token: string;
  eventName: string;
  dates: string;
  /** "Course, City", whichever parts exist. */
  venue: string;
  /** "Match play" | "Stroke play", for the summary line. */
  formatLabel: string;
  regDeadline: string;
  /** True when the field is full: a new entry would join the waitlist. */
  waitlistOnly: boolean;
  /** Remaining confirmed places, or null for an unlimited field. */
  spotsLeft: number | null;
  /** auto | approve — approve mode changes what "what happens next" says. */
  approvalMode: ApprovalMode;
  /** This tournament asks for a mobile number and refuses without one. */
  requirePhone: boolean;
  brand: EventBrand | null;
}

function venueOf(course: string, city: string): string {
  return [course, city].map((s) => s.trim()).filter(Boolean).join(", ");
}

function formatLabelOf(format: string): string {
  return format === "stroke" ? "Stroke play" : "Match play";
}

/**
 * Resolve a public registration link, or null if it isn't live.
 *
 * Null is deliberately overloaded — see the module note. Callers must not try
 * to distinguish the reasons; that distinction is the oracle we're refusing to
 * build.
 */
export async function openRegistrationView(token: string): Promise<PublicRegistrationView | null> {
  // An empty token can't come from the route (the segment is always present),
  // but guard anyway: matching registrationToken = "" would hit every event
  // that never opened registration.
  if (!token) return null;

  // findFirst, not findUnique: registrationToken's uniqueness is enforced by a
  // partial index (unique where <> '') the schema can't express as @unique, so
  // it isn't a where-unique input. The empty-token guard above is what keeps
  // this from matching an arbitrary un-opened event.
  const event = await prisma.event.findFirst({ where: { registrationToken: token } });
  if (!event || !event.registrationOpen) return null;

  const confirmedCount = await prisma.player.count({
    where: { eventId: event.id, status: "confirmed" },
  });

  // The same open/closed/full judgement the organizer console shows, so the two
  // never disagree. A passed deadline or a manual close both come back as "not
  // accepting", which folds into the same null the console-side switch does.
  const status = registrationStatus({
    eventStatus: event.status,
    deadline: event.regDeadline,
    capacity: event.capacity,
    confirmedCount,
    override: event.registrationOverride,
  });
  if (!status.acceptingEntries) return null;

  const brand = await brandForEvent(event.id);
  const unlimited = event.capacity <= 0;

  return {
    token,
    eventName: event.name,
    dates: event.dates,
    venue: venueOf(event.course, event.city),
    formatLabel: formatLabelOf(event.format),
    regDeadline: event.regDeadline,
    waitlistOnly: status.waitlisting,
    spotsLeft: unlimited ? null : Math.max(0, event.capacity - confirmedCount),
    approvalMode: approvalModeOf(event.registrationApproval),
    // Resolved through the plan, so the public form asks for exactly what the
    // action will insist on. Reading event.requirePhone straight through would
    // show a free club's entrants an optional mobile field and then refuse
    // their entry for leaving it blank.
    requirePhone: phoneRequiredFor(await planForOrganization(event.organizationId), event.requirePhone),
    brand,
  };
}

export interface RegistrationPrefill {
  name: string;
  email: string;
  handicap: number;
  handicapType: string;
  phone: string;
  preferredTee: string;
  /** True when this person already has an entry in this event — the form then
   *  says so instead of inviting a duplicate. */
  alreadyEntered: boolean;
}

/**
 * What we already know about this visitor, matched by email.
 *
 * Two sources, in order: an existing entry in THIS event (they've registered
 * already — say so), then the club roster (they've played here before — fill
 * the form so it's one tap). Returns null for a stranger, whose form starts
 * blank. Matched on email only, the same identity key the rest of the app uses.
 */
export async function registrationPrefillFor(
  token: string,
  email: string,
): Promise<RegistrationPrefill | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;

  const event = await prisma.event.findFirst({
    where: { registrationToken: token },
    select: { id: true, organizationId: true },
  });
  if (!event) return null;

  const existing = await prisma.player.findFirst({
    where: { eventId: event.id, email: { equals: clean, mode: "insensitive" } },
  });
  if (existing) {
    return {
      name: existing.name,
      email: existing.email,
      handicap: existing.handicap,
      handicapType: existing.handicapType,
      phone: existing.phone,
      preferredTee: existing.preferredTee,
      alreadyEntered: true,
    };
  }

  const member = await prisma.member.findFirst({
    where: { organizationId: event.organizationId, email: { equals: clean, mode: "insensitive" } },
  });
  if (member) {
    return {
      name: member.name,
      email: member.email || clean,
      handicap: member.handicap,
      handicapType: member.handicapType,
      phone: member.phone,
      preferredTee: member.preferredTee,
      alreadyEntered: false,
    };
  }

  return null;
}
