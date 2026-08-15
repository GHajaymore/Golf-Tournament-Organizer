"use server";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { upsertMember } from "@/lib/services/roster";
import { syncPlayerAccount } from "@/lib/services/player-access";
import { sendRegistrationEmail } from "@/lib/email";
import {
  cleanRegistration,
  decideIntake,
  approvalModeOf,
  type RegistrationForm,
  type IntakeStatus,
} from "@/lib/domain/registration-intake";

/**
 * Open (self-service) registration — the one action a stranger can call.
 *
 * This is unauthenticated and public, so it trusts nothing the browser sends
 * and defends itself accordingly:
 *
 *   - Rate limited before any lookup, keyed on the link's token AND the
 *     entrant's email, so a refusal costs nothing and teaches nothing.
 *   - Every field validated and bounded server-side (cleanRegistration).
 *   - Capacity, the deadline and the open/closed switch are re-checked here
 *     from the database — the browser's copy of "spots left" is a hint, never
 *     the authority.
 *   - The placement decision (confirmed / waitlist / pending) is the pure
 *     decideIntake; this function only gathers the numbers and writes the row.
 *   - The response carries no PII and nothing about the event beyond what the
 *     entrant just told us plus their own outcome.
 */

export interface RegisterResult {
  ok: boolean;
  /** confirmed | waitlisted | pending — drives the on-screen confirmation. */
  status?: IntakeStatus;
  /** True when this email was already in the field: an idempotent no-op, not a
   *  failure — so the page can say "you're already registered" warmly. */
  already?: boolean;
  error?: string;
}

/** The same neutral refusal for every "link isn't live" case, so a caller can't
 *  tell a bogus token from a closed one — the action-side of the /live rule. */
const NOT_OPEN = "This registration link isn't open.";

export async function registerForEvent(token: string, form: RegistrationForm): Promise<RegisterResult> {
  const cleanToken = (token ?? "").trim();
  if (!cleanToken) return { ok: false, error: NOT_OPEN };

  // Validate first: a malformed submission never reaches the database and never
  // spends a lookup. It does still spend a rate-limit slot below, keyed on the
  // token, which is correct — junk POSTs against one link are exactly the flood
  // the token budget is there to cap.
  const cleaned = cleanRegistration(form);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  const person = cleaned.value;

  // Both budgets, before anything is looked up. The token cap slows a script
  // hammering one link; the email cap stops one person submitting over and over.
  const byToken = await checkRateLimit("register-token", cleanToken);
  if (!byToken.allowed) return { ok: false, error: byToken.message };
  const byEmail = await checkRateLimit("register-email", person.email);
  if (!byEmail.allowed) return { ok: false, error: byEmail.message };

  // findFirst, not findUnique: registrationToken's uniqueness is a PARTIAL index
  // (unique where <> '') that Prisma's schema can't model as @unique, so it
  // isn't a where-unique input. The empty-token guard above is what makes this
  // safe — an empty token would otherwise match an arbitrary un-opened event.
  const event = await prisma.event.findFirst({ where: { registrationToken: cleanToken } });
  // Same neutral message whether the token is unknown or registration is off —
  // no existence oracle.
  if (!event || !event.registrationOpen) return { ok: false, error: NOT_OPEN };

  // De-duplicate before deciding placement. Someone tapping "Register" twice, or
  // coming back to a link they already used, must not become two rows in the
  // field. Matched on email — the identity key the whole app uses.
  const existing = await prisma.player.findFirst({
    where: { eventId: event.id, email: { equals: person.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return { ok: true, already: true };

  // Capacity and deadline enforced HERE, from a fresh count — not from anything
  // the form carried. The pure decision does the rest.
  const confirmedCount = await prisma.player.count({
    where: { eventId: event.id, status: "confirmed" },
  });
  const decision = decideIntake({
    registrationOpen: event.registrationOpen,
    approvalMode: approvalModeOf(event.registrationApproval),
    reg: {
      eventStatus: event.status,
      deadline: event.regDeadline,
      capacity: event.capacity,
      confirmedCount,
      override: event.registrationOverride,
    },
  });
  if (!decision.accepted) return { ok: false, error: NOT_OPEN };

  const maxSeed = await prisma.player.aggregate({ where: { eventId: event.id }, _max: { seed: true } });

  // Roster write-through, exactly like the organizer-side add: registering
  // someone is also how they join the club roster, so there's one record of the
  // person and their history spans events.
  const memberId = await upsertMember(event.organizationId, {
    name: person.name,
    email: person.email,
    phone: person.phone,
    preferredTee: person.preferredTee,
    handicap: person.handicap,
    handicapType: person.handicapType,
    handicapSource: person.handicapSource,
  });

  await prisma.player.create({
    data: {
      eventId: event.id,
      memberId,
      name: person.name,
      handicap: person.handicap,
      seed: (maxSeed._max.seed ?? 0) + 1,
      status: decision.status,
      email: person.email,
      phone: person.phone,
      preferredTee: person.preferredTee,
      handicapSource: person.handicapSource,
      handicapType: person.handicapType,
    },
  });

  // Email is identity in this app (accessibleEvents is keyed on it), so
  // registering also grants sign-in — the same as the organizer-side add. Never
  // downgrades an existing admin/assistant who happens to be entering their own
  // event; see syncPlayerAccount.
  await syncPlayerAccount(event.id, person.name, person.email);

  // Best-effort, and it must stay best-effort: the on-screen confirmation is the
  // real receipt. No-ops without RESEND_API_KEY, never throws.
  await sendRegistrationEmail(person.email, { eventName: event.name, status: decision.status });

  return { ok: true, status: decision.status };
}
