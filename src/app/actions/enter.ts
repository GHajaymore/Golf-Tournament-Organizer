"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { accessibleEvents } from "@/lib/services/access";
import { decideIntake, approvalModeOf, looksLikePhone } from "@/lib/domain/registration-intake";
import { planForEvent } from "@/lib/services/entitlements";
import { phoneRequiredFor } from "@/lib/plans";
import { effectiveCapacity } from "@/lib/services/limits";
import { boardChanged } from "@/lib/services/board-refresh";
import { teeMatcherFor } from "@/lib/services/handicaps";
import { withEventIntakeLock } from "@/lib/services/intake-lock";
import { ownWithdrawalOpen } from "@/lib/registration";
import { hasPlayingHistory } from "@/lib/services/playing-history";
import { revokePlayerAccount } from "@/lib/services/player-access";
import { drainWaitlist } from "@/lib/services/waitlist";
import { logAudit } from "@/lib/services/action-shared";

/**
 * A MEMBER PUTS THEIR NAME DOWN WITHOUT FILLING ANYTHING IN.
 *
 * `/register/[token]` is a PUBLIC form for a stranger on a shared link — its
 * own comment says "there is no session here at all" — and it asks for a name,
 * an email, a handicap and a tee. A signed-in member of the club has all four
 * already, on the roster, and was being made to retype them to enter their own
 * club's tournament from their own Events screen.
 *
 * So this is the same entry by a different door, and the door is the whole
 * difference: the public form trusts nothing and this trusts the session.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS DECIDE ANYTHING ITSELF. `decideIntake`
 * is the shared rule — open/closed, full, approve-mode — so a one-tap entry
 * lands in exactly the place the public form would have put it: confirmed,
 * waitlisted, or pending an organizer's approval. A second copy of that
 * judgement is how a club comes to have two front doors with different
 * capacity rules behind them.
 *
 * AND IT TAKES THE HANDICAP FROM THE ROSTER, NOT FROM THE CALLER. The public
 * form passes "public" to `upsertMember` precisely so that a stranger who
 * knows an email cannot rewrite a member's stored Handicap Index. Here there
 * is nothing to rewrite: the club's figure is read and used, and this action
 * accepts no handicap at all. The only parameter is which tournament.
 *
 * THE EVENT ID IS THE CALLER'S, SO IT IS CHECKED. A "use server" export is a
 * public HTTP endpoint and will be called with whatever the caller likes —
 * `accessibleEvents` is the same reachability the Events screen itself is
 * built from, so a member can enter a tournament they can already see and
 * nothing else. See `join.ts`, which refuses to take an organization id for
 * the identical reason.
 */

export interface EnterResult {
  ok: boolean;
  error?: string;
  /** Where the entry landed, for the words the screen says back. */
  status?: "confirmed" | "waitlisted" | "pending";
}

const NOT_OPEN = "Entries aren't open for this tournament.";
// One answer for "no such tournament", "not yours to see" and "not entered",
// so withdrawing never confirms that a tournament exists.
const NOT_ENTERED = "You aren't entered in this tournament.";

export async function enterThisTournament(eventId: string): Promise<EnterResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  // Counted before the lookup, like every other limiter here: a refusal then
  // costs the caller a query they do not get.
  const limit = await checkRateLimit("register-email", session.email);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const reachable = await accessibleEvents(session.email);
  if (!reachable.some((r) => r.eventId === eventId)) {
    // The same answer a wrong id gets, so this never confirms a tournament
    // exists to somebody who cannot see it.
    return { ok: false, error: NOT_OPEN };
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      organizationId: true,
      registrationOpen: true,
      registrationOverride: true,
      registrationApproval: true,
      regOpens: true,
      regDeadline: true,
      capacity: true,
      status: true,
      requirePhone: true,
    },
  });
  if (!event) return { ok: false, error: NOT_OPEN };

  /**
   * ALREADY IN. Confirmed, waitlisted and pending all mean the same thing to
   * this action: their name is down, and pressing Enter twice must not put it
   * down twice. `status` is returned so the screen can say which, rather than
   * reporting a failure at somebody who is already entered.
   *
   * A WITHDRAWN ROW IS NOT ONE OF THEM, and this used to match one.
   *
   * The sentence above named three statuses and the query named none, so it
   * matched the fourth as well. A member who withdrew was refused with "Your
   * name is already down for this one." Their name was not down; they took it
   * off.
   *
   * It is the shape this codebase keeps producing: two readers of one
   * question, disagreeing, with the wrong one being the ACTION.
   * `club-events.ts` decides what the Events screen offers and gets it right —
   * `enteredIn` is confirmed only, `waitingIn` is waitlisted or pending, so a
   * withdrawn member correctly falls into neither and is shown the Enter
   * button. Then the button refused them. A door offered and then shut, with a
   * false sentence for a reason.
   *
   * RE-ENTRY IS AN EXPECTED FLOW, not an edge case. `roster-link.ts` says so
   * in as many words — "withdrawn in the morning, re-entered in the afternoon"
   * — and handles a member holding several rows across a tournament's life by
   * taking the strongest live claim.
   *
   * So the withdrawn row STAYS and a new one is created beside it. That is
   * deliberate rather than untidy: `removeSignup` keeps a withdrawn player
   * precisely because a confirmed `ContestEntry` — a stake the organizer has
   * already taken — outlives their place in the field, and re-confirming the
   * old row in place would tie that money to the new entry. `Player` has no
   * unique constraint on (eventId, email), and `memberEntryFor` is built for
   * exactly this.
   *
   * Found by asking which states the fixture can EXPRESS: `withdrawn` is in
   * the schema and has zero rows in the development database, so no walk of
   * the player's states had ever reached it.
   */
  const already = await prisma.player.findFirst({
    where: {
      eventId,
      email: { equals: session.email, mode: "insensitive" },
      status: { in: ["confirmed", "waitlisted", "pending"] },
    },
    select: { status: true },
  });
  if (already) {
    return {
      ok: false,
      error: "Your name is already down for this one.",
      status: already.status as EnterResult["status"],
    };
  }

  // The organizer's capacity, tightened to the tier's field cap when the owner
  // has enforcement on — a no-op otherwise, so entry is unchanged until then. A
  // member over the cap waitlists through the same rule as any full field,
  // rather than being refused. Capacity cannot change under a concurrent entry,
  // so it is resolved before the lock.
  const capacity = await effectiveCapacity(event.organizationId, event.capacity);

  /**
   * THE CLUB'S OWN RECORD OF THIS PERSON, which is the point of entering from
   * inside the app rather than through the public form.
   *
   * Matched on email, the same key `myPlayerIds` and `clubEventsFor` use. A
   * member with no roster row yet — somebody who joined the club but has never
   * entered anything — falls back to the account's own name and a zero
   * handicap, which is what the organizer's roster screen shows for a new
   * entrant and is correctable there.
   *
   * Read before the lock: it touches the member and (below) the tees, not the
   * confirmed count, so it does not belong in the serialised section.
   */
  const member = await prisma.member.findFirst({
    where: {
      organizationId: event.organizationId,
      email: { equals: session.email, mode: "insensitive" },
    },
  });
  /**
   * A MOBILE, WHERE THE TOURNAMENT NEEDS ONE — the rule every other door keeps.
   *
   * The public form, the organizer adding a player and the roster import all
   * refuse an entrant without a mobile when `phoneRequiredFor` says one is
   * needed (a free club always; a paid club when it asks). This door took the
   * roster's phone as it found it — often none — so a member entered in one tap
   * and Registration then said "19 players have no mobile on file … entered
   * before that applied", which was false for the entry just made. Walked
   * 2026-09-26.
   *
   * Refused rather than let in: `EnterButton` answers a refusal with "Use the
   * entry form", which asks for the number, so the member is one step from in.
   */
  const phone = member?.phone ?? "";
  if (phoneRequiredFor(await planForEvent(eventId), event.requirePhone) && !looksLikePhone(phone)) {
    return {
      ok: false,
      error: "This tournament needs a mobile number, and the club doesn't have one for you yet — add it on the entry form.",
    };
  }

  const teeFor = await teeMatcherFor(eventId);
  const preferredTee = member?.preferredTee ?? "";

  /**
   * COUNT, DECIDE, AND CREATE UNDER THE EVENT'S INTAKE LOCK. Without it, two
   * members entering a nearly-full field at the same moment both read the same
   * confirmed count, `decideIntake` tells both "confirmed", and both rows are
   * created — the field one over the cap the organizer or the tier set.
   * Serialising this section per event closes that, and takes the seed with it,
   * so concurrent entrants cannot land on the same seed either. See
   * `intake-lock.ts`; `register.ts` guards the public form the same way.
   */
  const decision = await withEventIntakeLock(eventId, async (tx) => {
    const confirmedCount = await tx.player.count({
      where: { eventId, status: "confirmed" },
    });
    const d = decideIntake({
      registrationOpen: event.registrationOpen,
      approvalMode: approvalModeOf(event.registrationApproval),
      reg: {
        eventStatus: event.status,
        deadline: event.regDeadline,
        opens: event.regOpens,
        capacity,
        confirmedCount,
        override: event.registrationOverride,
      },
    });
    if (!d.accepted) return d;

    const maxSeed = await tx.player.aggregate({ where: { eventId }, _max: { seed: true } });
    await tx.player.create({
      data: {
        eventId,
        memberId: member?.id ?? null,
        teeId: teeFor(preferredTee),
        name: member?.name || session.name || session.email,
        email: session.email,
        phone,
        handicap: member?.handicap ?? 0,
        handicapType: member?.handicapType ?? "18",
        handicapSource: member?.handicapSource ?? "manual",
        gender: member?.gender ?? "",
        preferredTee,
        seed: (maxSeed._max.seed ?? 0) + 1,
        status: d.status,
      },
    });
    return d;
  });
  if (!decision.accepted) return { ok: false, error: NOT_OPEN };

  // On the record, beside the withdrawal line: the organizer's "Recent changes
  // to the field" (Registration) shows who came as well as who went.
  const enteredName = member?.name || session.name || session.email;
  await logAudit(eventId, "entered", `${enteredName} entered themselves (${decision.status}).`, {
    actor: session.name || session.email,
  });

  // A new entrant changes the field, so the cached public board has to be
  // retired — and `revalidatePath` below does NOT do that, they are different
  // caches. `boardChanged` owns the tag; see board-refresh.ts.
  boardChanged(eventId);
  revalidatePath("/me/events");
  revalidatePath("/me");
  revalidatePath("/entry");
  revalidatePath("/registration");

  return { ok: true, status: decision.status };
}

export interface WithdrawResult {
  ok: boolean;
  error?: string;
}

/**
 * A MEMBER TAKES THEIR OWN NAME OFF — until entries close (Ajay, 2026-09-26).
 *
 * The other half of `enterThisTournament`. One tap put a name down and nothing
 * let the member take it off again; now they can, for exactly as long as the
 * door that let them in is open (`ownWithdrawalOpen`, the same rule).
 *
 * IT DOES WHAT THE ORGANIZER'S REMOVAL DOES, piece for piece, so the door used
 * cannot change the outcome:
 *   - a row with playing history is kept as `withdrawn`, anything else is
 *     deleted (`hasPlayingHistory`, shared with `removeSignup`);
 *   - their tournament sign-in is revoked only if no other live entry uses the
 *     address (`revokePlayerAccount`);
 *   - a CONFIRMED place freed goes to the waiting list, and only if the field
 *     actually has room (`drainWaitlist`).
 *
 * AND ONLY THEIR OWN. The rows are found by the SESSION's email — the caller
 * supplies which tournament and nothing else — and the tournament must be one
 * they can reach, the same check that lets them enter. A "use server" export is
 * a public endpoint; there is no player id here to guess.
 */
export async function withdrawMyEntry(eventId: string): Promise<WithdrawResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const limit = await checkRateLimit("register-email", session.email);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const reachable = await accessibleEvents(session.email);
  if (!reachable.some((r) => r.eventId === eventId)) return { ok: false, error: NOT_ENTERED };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      registrationOpen: true,
      registrationOverride: true,
      regOpens: true,
      regDeadline: true,
      capacity: true,
      status: true,
    },
  });
  if (!event) return { ok: false, error: NOT_ENTERED };

  const mine = await prisma.player.findMany({
    where: {
      eventId,
      email: { equals: session.email, mode: "insensitive" },
      status: { in: ["confirmed", "waitlisted", "pending"] },
    },
    select: { id: true, name: true, status: true },
  });
  if (mine.length === 0) return { ok: false, error: NOT_ENTERED };

  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const open = ownWithdrawalOpen({
    registrationOpen: event.registrationOpen,
    eventStatus: event.status,
    deadline: event.regDeadline,
    opens: event.regOpens,
    capacity: event.capacity,
    confirmedCount,
    override: event.registrationOverride,
  });
  if (!open) {
    return {
      ok: false,
      error: "Entries have closed, so changes to the field go through the organizer now — ask them to take you out.",
    };
  }

  for (const row of mine) {
    if (await hasPlayingHistory(eventId, row.id)) {
      await prisma.player.update({ where: { id: row.id }, data: { status: "withdrawn" } });
    } else {
      await prisma.player.delete({ where: { id: row.id } });
    }
  }
  await revokePlayerAccount(eventId, session.email);

  // The organizer's log is where a field change is looked for afterwards; a
  // name that vanished with no line against it is a question nobody can answer.
  //
  // WHAT THEY GAVE UP, in words. This printed the raw status — "withdrew their
  // own entry (confirmed)" — which reads as if the withdrawal was confirmed,
  // not that a confirmed PLACE was given up (walked 2026-09-28). The status
  // matters to the organizer, since a place freed pulls in the waiting list.
  const gaveUp = (status: string) =>
    status === "confirmed"
      ? "had a place"
      : status === "waitlisted"
        ? "was on the waiting list"
        : status === "pending"
          ? "was awaiting approval"
          : status;
  await logAudit(
    eventId,
    "withdrawn",
    `${mine[0].name} withdrew their own entry (${[...new Set(mine.map((r) => gaveUp(r.status)))].join(", ")}).`,
    { actor: session.name || session.email },
  );

  if (mine.some((r) => r.status === "confirmed")) await drainWaitlist(eventId);

  boardChanged(eventId);
  revalidatePath("/me/events");
  revalidatePath("/me");
  revalidatePath("/entry");
  revalidatePath("/registration");
  return { ok: true };
}
