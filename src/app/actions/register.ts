"use server";
import { byAddress } from "@/lib/domain/my-entry";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import type { Event } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { checkEmailCode, forgetUnprovedStrangers, proveAddress, sendEmailCode } from "@/lib/services/email-code";
import { EMAIL_CODE_WORDS, maskedAddress } from "@/lib/domain/email-code";
import { EMAIL_RE } from "@/lib/domain/typed-limits";
import { checkRateLimit, clientGuessGate } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/client-address";
import { entryLimitKey } from "@/lib/domain/rate-limit";
import { upsertMember, memberGender } from "@/lib/services/roster";
import { syncPlayerAccount } from "@/lib/services/player-access";
import { sendRegistrationEmail } from "@/lib/email";
import { fieldLimitFor } from "@/lib/services/waitlist";
import { entryLinkBudgetFor } from "@/lib/services/registration";
import { withEventIntakeLock } from "@/lib/services/intake-lock";
import { phoneRequiredFor } from "@/lib/plans";
import { clubDayForEvent } from "@/lib/services/club-clock";
import { logAudit } from "@/lib/services/action-shared";
import { archiveRefusalFor } from "@/lib/services/club-archive";
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
   *  failure — so the page can say "you're already registered" warmly. Said only
   *  to somebody who has PROVED the address (see `registerForEvent`). */
  already?: boolean;
  /** A code has been emailed to the address; the entry is made when it is typed
   *  back (`confirmEntryCode`). The answer is the same for an address that is
   *  new and one already entered. `sentTo` is the address as the panel shows it. */
  needsCode?: boolean;
  sentTo?: string;
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
  // The link's budget grows with its field (`entryLinkBudget`), and is looked up
  // only once the count passes the floor — so a full 64-player field opening at
  // a set time is never told the form is busy while places remain.
  const byToken = await checkRateLimit("register-token", cleanToken, () => entryLinkBudgetFor(cleanToken));
  if (!byToken.allowed) return { ok: false, error: byToken.message };
  const byEmail = await checkRateLimit("register-email", entryLimitKey(person.email, cleanToken));
  if (!byEmail.allowed) return { ok: false, error: byEmail.message };

  // findFirst, not findUnique: registrationToken's uniqueness is a PARTIAL index
  // (unique where <> '') that Prisma's schema can't model as @unique, so it
  // isn't a where-unique input. The empty-token guard above is what makes this
  // safe — an empty token would otherwise match an arbitrary un-opened event.
  const event = await openEventFor(cleanToken);
  // Same neutral message whether the token is unknown or registration is off —
  // no existence oracle. A tournament in a lapsed club's read-only archive takes
  // nobody new either, and a stranger is told only what a closed link tells them
  // (2026-10-21).
  if (!event) return { ok: false, error: NOT_OPEN };

  // Whether a phone number is required is this tournament's own setting, so it
  // cannot be checked with the rest — those run before any lookup on purpose,
  // so junk never reaches the database. This one needs the event, and comes
  // straight after it and before anything is written.
  //
  // A named error rather than the neutral NOT_OPEN: this is the person's own
  // form being incomplete, not anything about whether the event exists, so
  // telling them what to fix leaks nothing.
  // The organizer decides per tournament, on every plan — see phoneRequiredFor.
  const noPhone = phoneRefusal(event, person);
  if (noPhone) return { ok: false, error: noPhone };

  /**
   * THE ADDRESS IS PROVED BEFORE ANYBODY IS ENTERED UNDER IT (2026-11-13,
   * security sweep M5). This door has no session, so whoever held a widely
   * shared link could enter other people — or invented addresses — into a real
   * field: filling places, mailing strangers a confirmation they never asked
   * for, and making an Account (a way in to the event) for each. Now:
   *
   *  - Signed in AS the address being entered: that is the proof, and the entry
   *    is made as it always was (a member sent here from their Events screen).
   *  - Anybody else: nothing is entered. A six-digit code is emailed to the
   *    address (`purpose: "entry"`, bound to this browser like every code), and
   *    the entry is made when it is typed back (`confirmEntryCode`). No Account
   *    is made, no place is taken, no confirmation is mailed until then.
   *
   * AND THE ANSWER IS THE SAME WHETHER THE ADDRESS IS ENTERED ALREADY OR NOT
   * (M2). "You're already registered" used to be said to anybody holding the
   * link, which listed who had entered a tournament. It is now said only after
   * the code, to the person whose inbox it went to. A guest the organizer adds
   * by hand needs no email at all and does not come this way.
   */
  const session = await getSession();
  const signedInAsThem = !!session?.email && session.email.trim().toLowerCase() === person.email;
  if (!signedInAsThem) return holdEntryForProof(cleanToken, form, person, event.name);
  return placeEntry(event, person);
}

type Person = Extract<ReturnType<typeof cleanRegistration>, { ok: true }>["value"];

/** This tournament's own phone rule, worded for the form; null when satisfied. */
function phoneRefusal(event: Pick<Event, "requirePhone">, person: Person): string | null {
  if (phoneRequiredFor(event.requirePhone) && !looksLikePhone(person.phone)) {
    return person.phone
      ? "That doesn't look like a phone number."
      : "Enter a mobile number — this tournament needs one to reach you on the day.";
  }
  return null;
}

/** The link's event when it is still open to a stranger; null otherwise (the one neutral answer). */
async function openEventFor(cleanToken: string): Promise<Event | null> {
  const event = await prisma.event.findFirst({ where: { registrationToken: cleanToken } });
  if (!event || !event.registrationOpen) return null;
  if (await archiveRefusalFor(event.id, "player")) return null;
  return event;
}

/**
 * Email the address a code and keep what was typed WITH the code, not with the
 * tournament: the form waits on the code's row (as a sign-up's password does)
 * and is made an entry only when the code comes back. Counted against the
 * address first, like every code this app sends.
 */
async function holdEntryForProof(cleanToken: string, form: RegistrationForm, person: Person, eventName: string): Promise<RegisterResult> {
  // The connection's sends, then the address's own entry budget (a separate one:
  // sign-in and device codes of the person who owns the address are not touched).
  const byClient = await clientGuessGate("code-send-client", await clientAddress());
  if (!byClient.decision.allowed) return { ok: false, error: byClient.decision.message };
  const limit = await checkRateLimit("entry-code-send", person.email);
  if (!limit.allowed) return { ok: false, error: limit.message };
  await forgetUnprovedStrangers();
  const user = await prisma.user.upsert({
    where: { email: person.email },
    update: {},
    create: { email: person.email, name: "" },
    select: { id: true },
  });
  const clip = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
  const sent = await sendEmailCode({
    userId: user.id,
    email: person.email,
    purpose: "entry",
    eventName,
    pending: {
      entry: {
        token: cleanToken,
        person: { name: clip(form.name), email: person.email, handicap: clip(form.handicap), handicapType: clip(form.handicapType), phone: clip(form.phone) },
      },
    },
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, needsCode: true, sentTo: maskedAddress(person.email) };
}

/**
 * The code typed back: the address is proved and the entry held with it is made,
 * exactly as an entry by a signed-in member is. Nobody is signed in by it.
 */
export async function confirmEntryCode(token: string, email: string, code: string): Promise<RegisterResult> {
  const cleanToken = (token ?? "").trim();
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!cleanToken || !cleanEmail || !EMAIL_RE.test(cleanEmail)) return { ok: false, error: NOT_OPEN };

  const checked = await checkEmailCode(cleanEmail, code);
  if (!checked.ok) return { ok: false, error: checked.error };
  const held = checked.pending.entry;
  // A code made for something else, or for another tournament's link, is not this entry's.
  if (checked.purpose !== "entry" || !held || held.token !== cleanToken) {
    return { ok: false, error: EMAIL_CODE_WORDS.refusal.wrong };
  }
  const event = await openEventFor(cleanToken);
  if (!event) return { ok: false, error: NOT_OPEN };
  const cleaned = cleanRegistration(held.person as unknown as RegistrationForm);
  if (!cleaned.ok || cleaned.value.email !== cleanEmail) return { ok: false, error: NOT_OPEN };
  const noPhone = phoneRefusal(event, cleaned.value);
  if (noPhone) return { ok: false, error: noPhone };

  await proveAddress({ userId: checked.userId, purpose: "entry", pending: {} });
  return placeEntry(event, cleaned.value);
}

/** Everything from "is this address already in the field" to the written entry. */
async function placeEntry(event: Event, person: Person): Promise<RegisterResult> {
  // De-duplicate before deciding placement. Someone tapping "Register" twice, or
  // coming back to a link they already used, must not become two rows in the
  // field. Matched on email — the identity key the whole app uses.
  const existing = await prisma.player.findFirst({
    where: { eventId: event.id, ...byAddress(person.email) },
    select: { id: true },
  });
  if (existing) return { ok: true, already: true };

  // Capacity and deadline enforced HERE, from the database — not from anything
  // the form carried. The organizer's capacity, tightened to the tier's field
  // cap when the owner has enforcement on (a no-op otherwise). A stranger over
  // the cap waitlists like any full field — never refused with a billing wall.
  const capacity = await fieldLimitFor(event);

  // A first count and decision. Whether registration is OPEN at all — the
  // accept/reject verdict — does not depend on the count: a full field
  // waitlists, it is never refused. So this verdict is race-free and safe to
  // gate the roster write below. The confirmed-vs-waitlisted STATUS does depend
  // on the count, and is decided again under the lock against a fresh one.
  const confirmedCount = await prisma.player.count({
    where: { eventId: event.id, status: "confirmed" },
  });
  // The closing day ends when it ends AT THE CLUB — see `domain/club-clock.ts`.
  const clubNow = await clubDayForEvent(event.id);
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
      now: clubNow,
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
      // The entry link makes member entries only (it stores no standing, which
      // reads as a member). A guest on the link is a later change, and asks here.
      guest: false,
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

  // NO TEES ARE SET HERE. This turned what an entrant typed in "Preferred tee"
  // into the set they play from, where it beat their flight's: a stranger on a
  // public form deciding a condition of the competition. The organizer decides
  // the tees (`TEE_POLICY`), so an entrant starts on the tournament's — or, for
  // a woman the roster knows, the course's ladies' set, which is what her
  // roster row's gender is carried for. Read here, outside the lock below.
  const gender = await memberGender(memberId);

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
    // De-duplicated AGAIN, under the lock (J46). The check above is the cheap
    // early answer; this one is the guarantee, because two taps arriving
    // together both pass the first. The second queues here and finds the row.
    const again = await tx.player.findFirst({
      where: { eventId: event.id, ...byAddress(person.email) },
      select: { id: true },
    });
    if (again) return null;
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
        now: clubNow,
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
        gender,
      },
    });
    return d;
  });
  // The same answer the early check gives: already down, nothing created.
  if (!placed) return { ok: true, already: true };

  /**
   * A new entrant changes the field, so the public board must be recomputed.
   *
   * Taken from the EVENT rather than a session, because this is the one
   * board-affecting write with no session at all — self-registration is a
   * stranger on a shared link, which is precisely why it needs saying here
   * rather than inheriting a helper that reads a caller who is not there.
   */
  boardChanged(event.id);

  // On the organizer's record ("Recent changes to the field"). No session here,
  // so the actor is the person who filled the form in, by the name they gave.
  await logAudit(event.id, "registered", `${person.name} entered on the sign-up link (${placed.status}).`, {
    actor: person.name,
  });

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
