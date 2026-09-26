"use server";
import { teeMatcherFor } from "@/lib/services/handicaps";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { upsertMember } from "@/lib/services/roster";
import { syncPlayerAccount } from "@/lib/services/player-access";
import { sendRegistrationEmail } from "@/lib/email";
import { planForEvent } from "@/lib/services/entitlements";
import { effectiveCapacity } from "@/lib/services/limits";
import { withEventIntakeLock } from "@/lib/services/intake-lock";
import { phoneRequiredFor } from "@/lib/plans";
import {
  cleanRegistration,
  looksLikePhone,
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

  // Whether a phone number is required is this tournament's own setting, so it
  // cannot be checked with the rest — those run before any lookup on purpose,
  // so junk never reaches the database. This one needs the event, and comes
  // straight after it and before anything is written.
  //
  // A named error rather than the neutral NOT_OPEN: this is the person's own
  // form being incomplete, not anything about whether the event exists, so
  // telling them what to fix leaks nothing.
  // Free clubs always collect a mobile; paid clubs decide per tournament.
  // Resolved here rather than read off the event, so the plan and the setting
  // can never be consulted separately — see phoneRequiredFor.
  const plan = await planForEvent(event.id);
  if (phoneRequiredFor(plan, event.requirePhone) && !looksLikePhone(person.phone)) {
    return {
      ok: false,
      error: person.phone
        ? "That doesn't look like a phone number."
        : "Enter a mobile number — this tournament needs one to reach you on the day.",
    };
  }

  // De-duplicate before deciding placement. Someone tapping "Register" twice, or
  // coming back to a link they already used, must not become two rows in the
  // field. Matched on email — the identity key the whole app uses.
  const existing = await prisma.player.findFirst({
    where: { eventId: event.id, email: { equals: person.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return { ok: true, already: true };

  // Capacity and deadline enforced HERE, from the database — not from anything
  // the form carried. The organizer's capacity, tightened to the tier's field
  // cap when the owner has enforcement on (a no-op otherwise). A stranger over
  // the cap waitlists like any full field — never refused with a billing wall.
  const capacity = await effectiveCapacity(event.organizationId, event.capacity);

  // A first count and decision. Whether registration is OPEN at all — the
  // accept/reject verdict — does not depend on the count: a full field
  // waitlists, it is never refused. So this verdict is race-free and safe to
  // gate the roster write below. The confirmed-vs-waitlisted STATUS does depend
  // on the count, and is decided again under the lock against a fresh one.
  const confirmedCount = await prisma.player.count({
    where: { eventId: event.id, status: "confirmed" },
  });
  const decision = decideIntake({
    registrationOpen: event.registrationOpen,
    approvalMode: approvalModeOf(event.registrationApproval),
    reg: {
      eventStatus: event.status,
      // The enforcement point: the form and the lists only DISPLAY the date.
      deadline: event.regDeadline,
      opens: event.regOpens,
      capacity,
      confirmedCount,
      override: event.registrationOverride,
    },
  });
  if (!decision.accepted) return { ok: false, error: NOT_OPEN };

  // Roster write-through, exactly like the organizer-side add: registering
  // someone is also how they join the club roster, so there's one record of the
  // person and their history spans events.
  const memberId = await upsertMember(
    event.organizationId,
    {
      name: person.name,
      email: person.email,
      phone: person.phone,
      preferredTee: person.preferredTee,
      handicap: person.handicap,
      handicapType: person.handicapType,
      handicapSource: person.handicapSource,
    },
    /**
     * PUBLIC. There is no session here at all — this is the one board-affecting
     * write with none.
     *
     * So the index they type enters this event, and does not restate the club's
     * stored figure for a member who already exists. Anyone who knew a member's
     * email could otherwise sign up as them and rewrite the Handicap Index every
     * future event snapshots.
     */
    "public",
  );

  // What they typed, turned into the set they play from. Unmatched or
  // ambiguous stays null, which means the round’s tees and is correctable on
  // the field screen — a guess would not be. Resolved above the lock: it reads
  // the event's tees, not the confirmed count.
  const teeFor = await teeMatcherFor(event.id);

  /**
   * COUNT, DECIDE THE STATUS, AND CREATE UNDER THE EVENT'S INTAKE LOCK. Two
   * strangers registering for a nearly-full field at the same moment would
   * otherwise both read the same confirmed count and both be confirmed into the
   * one remaining slot. Serialising this section per event closes that, and
   * takes the seed with it. `capacity`, `memberId` and the tee matcher are
   * resolved above because none of them reads the confirmed count — and
   * `upsertMember` in particular must NOT run inside the transaction, where
   * taking its own pooled connection while entrants are queued on this lock
   * could deadlock. See `intake-lock.ts`, and `enter.ts` for the signed-in door
   * guarded the same way.
   */
  const placed = await withEventIntakeLock(event.id, async (tx) => {
    const freshCount = await tx.player.count({
      where: { eventId: event.id, status: "confirmed" },
    });
    // Same inputs as the gate decision above but for the fresher count, and the
    // accept/reject verdict does not read the count — so this is still accepted;
    // only confirmed-vs-waitlisted can differ, which is exactly the point.
    const fresh = decideIntake({
      registrationOpen: event.registrationOpen,
      approvalMode: approvalModeOf(event.registrationApproval),
      reg: {
        eventStatus: event.status,
        deadline: event.regDeadline,
        opens: event.regOpens,
        capacity,
        confirmedCount: freshCount,
        override: event.registrationOverride,
      },
    });
    // `decision` is already narrowed to accepted by the gate above; if the event
    // somehow closed in the gap, keep its status rather than write one that does
    // not exist. In practice `fresh` is accepted, only its placement can differ.
    const d = fresh.accepted ? fresh : decision;
    const maxSeed = await tx.player.aggregate({
      where: { eventId: event.id },
      _max: { seed: true },
    });
    await tx.player.create({
      data: {
        eventId: event.id,
        teeId: teeFor(person.preferredTee),
        memberId,
        name: person.name,
        handicap: person.handicap,
        seed: (maxSeed._max.seed ?? 0) + 1,
        status: d.status,
        email: person.email,
        phone: person.phone,
        preferredTee: person.preferredTee,
        handicapSource: person.handicapSource,
        handicapType: person.handicapType,
      },
    });
    return d;
  });

  /**
   * A new entrant changes the field, so the public board must be recomputed.
   *
   * Taken from the EVENT rather than a session, because this is the one
   * board-affecting write with no session at all — self-registration is a
   * stranger on a shared link, which is precisely why it needs saying here
   * rather than inheriting a helper that reads a caller who is not there.
   */
  boardChanged(event.id);

  // Email is identity in this app (accessibleEvents is keyed on it), so
  // registering also grants sign-in — the same as the organizer-side add. Never
  // downgrades an existing admin/assistant who happens to be entering their own
  // event; see syncPlayerAccount.
  await syncPlayerAccount(event.id, person.name, person.email);

  // Best-effort, and it must stay best-effort: the on-screen confirmation is the
  // real receipt. No-ops without RESEND_API_KEY, never throws.
  await sendRegistrationEmail(person.email, {
    eventName: event.name,
    status: placed.status,
    organizationId: event.organizationId,
    eventId: event.id,
    toName: person.name,
  });

  return { ok: true, status: placed.status };
}
