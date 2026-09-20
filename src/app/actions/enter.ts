"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { accessibleEvents } from "@/lib/services/access";
import { decideIntake, approvalModeOf } from "@/lib/domain/registration-intake";
import { boardChanged } from "@/lib/services/board-refresh";
import { teeMatcherFor } from "@/lib/services/handicaps";

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
    },
  });
  if (!event) return { ok: false, error: NOT_OPEN };

  /**
   * ALREADY IN — of any kind. Confirmed, waitlisted or pending all mean the
   * same thing to this action: their name is down, and pressing Enter twice
   * must not put it down twice. `status` is returned so the screen can say
   * which, rather than reporting a failure at somebody who is already entered.
   */
  const already = await prisma.player.findFirst({
    where: { eventId, email: { equals: session.email, mode: "insensitive" } },
    select: { status: true },
  });
  if (already) {
    return {
      ok: false,
      error: "Your name is already down for this one.",
      status: already.status as EnterResult["status"],
    };
  }

  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const decision = decideIntake({
    registrationOpen: event.registrationOpen,
    approvalMode: approvalModeOf(event.registrationApproval),
    reg: {
      eventStatus: event.status,
      deadline: event.regDeadline,
      opens: event.regOpens,
      capacity: event.capacity,
      confirmedCount,
      override: event.registrationOverride,
    },
  });
  if (!decision.accepted) return { ok: false, error: NOT_OPEN };

  /**
   * THE CLUB'S OWN RECORD OF THIS PERSON, which is the point of entering from
   * inside the app rather than through the public form.
   *
   * Matched on email, the same key `myPlayerIds` and `clubEventsFor` use. A
   * member with no roster row yet — somebody who joined the club but has never
   * entered anything — falls back to the account's own name and a zero
   * handicap, which is what the organizer's roster screen shows for a new
   * entrant and is correctable there.
   */
  const member = await prisma.member.findFirst({
    where: {
      organizationId: event.organizationId,
      email: { equals: session.email, mode: "insensitive" },
    },
  });

  const maxSeed = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  const teeFor = await teeMatcherFor(eventId);
  const preferredTee = member?.preferredTee ?? "";

  await prisma.player.create({
    data: {
      eventId,
      memberId: member?.id ?? null,
      teeId: teeFor(preferredTee),
      name: member?.name || session.name || session.email,
      email: session.email,
      phone: member?.phone ?? "",
      handicap: member?.handicap ?? 0,
      handicapType: member?.handicapType ?? "18",
      handicapSource: member?.handicapSource ?? "manual",
      gender: member?.gender ?? "",
      preferredTee,
      seed: (maxSeed._max.seed ?? 0) + 1,
      status: decision.status,
    },
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
