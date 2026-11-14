"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { archiveRefusalFor } from "@/lib/services/club-archive";
import { prisma } from "@/lib/db";
import { currencySymbol, DEFAULT_CURRENCY } from "@/lib/domain/money-format";
import { messagingContextFor, type MessagingActor, type MessagingTarget } from "@/lib/messaging-viewer";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  membershipFor,
  threadView,
  postToScope,
  markRead as markReadService,
  openDirectThreadWithPlayers,
  staffBroadcast,
  setMessagesOptOut,
  planSmsBroadcast,
  broadcastWithSms,
  type SmsPlan,
  type ThreadView,
  type PostResult,
} from "@/lib/services/messaging";

/**
 * Messaging endpoints.
 *
 * Every export here is a public HTTP endpoint taking arguments off the wire.
 * The pattern that keeps them safe is the same one throughout: nothing takes a
 * thread id as its authorisation. `requireMembership()` builds the membership
 * from their own session — never from an argument — and the service filters
 * every read to the scopes that membership derives. An id parameter can only
 * ever narrow within that set.
 *
 * Note the role used is `session.role`, not `viewRole`. An organizer previewing
 * as a player should see the app as a player sees it, and messaging is the one
 * place where honouring the preview would be actively wrong in the other
 * direction too: it would hide their own staff conversation from them while
 * they are still, in fact, staff and still receiving replies to it. Preview is
 * a display setting; who you are in a conversation is not.
 */

/**
 * THE ACCOUNT'S OWN MEMBERSHIP, for the doors only an account has: starting a
 * direct thread (D7: a guest's link starts none), the staff broadcasts and the
 * texting consent. A guest's link is never asked here.
 */
async function requireMembership() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const ctx = await membershipFor(session, session.eventId);
  if (!ctx) throw new Error("No tournament");
  return { session, ctx };
}

/**
 * WHOEVER SPEAKS FOR THIS TARGET: an account, or a guest's player link for the
 * target's own event (`messagingContextFor`, J39/J40 PR 2; the SF-1/D-1
 * lesson). The read/post/mark-read doors ask this, never `getSession()` alone.
 */
async function requireActor(target: MessagingTarget): Promise<MessagingActor> {
  const actor = await messagingContextFor(target);
  if (!actor) throw new Error("Not authenticated");
  return actor;
}

/** Bounded at the boundary: a `"use server"` export is called with whatever the caller likes. */
const asText = (v: unknown, max: number): string => (typeof v === "string" && v.length <= max ? v : "");

/**
 * Nothing is posted in a lapsed club's read-only archive (2026-10-21) — the
 * threads stay readable, and the sentence says why the box will not send.
 * Not in `requireMembership`, which the reads go through too.
 */
async function archivedFor(session: { eventId: string; role: string }): Promise<string | null> {
  return archiveRefusalFor(session.eventId, session.role === "player" ? "player" : "organizer");
}

/**
 * One conversation. Null for "no such thread" AND for "not yours" — telling
 * those apart would confirm a thread exists to somebody not entitled to know.
 */
export async function readThread(threadId: string): Promise<ThreadView | null> {
  const id = asText(threadId, 64);
  if (!id) return null;
  const { ctx } = await requireActor({ threadId: id });
  return threadView(ctx, id);
}

/**
 * Post to a scope, creating its conversation on the first message. A guest's
 * posts are held to a budget on their pass (`guest-post`, S8), never cleared.
 */
export async function sendMessage(scope: string, body: string): Promise<PostResult> {
  const key = asText(scope, 512);
  if (!key) return { ok: false, error: "Unknown conversation." };
  const actor = await requireActor({ scope: key });
  const archived = await archivedFor(actor);
  if (archived) return { ok: false, error: archived };
  if (actor.guest) {
    const budget = await checkRateLimit("guest-post", actor.guest.passId);
    if (!budget.allowed) return { ok: false, error: budget.message };
  }
  const res = await postToScope(actor.ctx, key, asText(body, 20_000), actor.name);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** Move the caller's read watermark. No-op for a thread they cannot see. */
export async function markThreadRead(threadId: string): Promise<void> {
  const id = asText(threadId, 64);
  if (!id) return;
  const { ctx } = await requireActor({ threadId: id });
  await markReadService(ctx, id);
  revalidatePath("/", "layout");
}

/**
 * Start or reopen a direct conversation.
 *
 * WHO it is with does come from the caller, which makes this the one action in
 * the file that has to validate ids rather than derive them. Each is somebody's
 * entry in THIS tournament — the only thing the picker was given — and the
 * service checks every one before a thread exists. It took email addresses
 * until 2026-10-11, which meant the picker had to be sent everybody's.
 */
export async function startDirectThread(playerIds: string[], firstMessage = ""): Promise<PostResult> {
  const { session, ctx } = await requireMembership();
  const archived = await archivedFor(session);
  if (archived) return { ok: false, error: archived };
  const res = await openDirectThreadWithPlayers(ctx, playerIds, session.name, firstMessage);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/**
 * Post to a flight, round or team the organizer runs but is not in.
 *
 * Separate endpoint from `sendMessage` because it deliberately widens beyond
 * the caller's own membership, which is what running a tournament requires.
 * The widening is bounded twice over: to staff, and to structural scopes whose
 * id is verified against this tournament — never a private group's
 * conversation or a direct message.
 */
export async function broadcastToScope(scope: string, body: string): Promise<PostResult> {
  const { session, ctx } = await requireMembership();
  const archived = await archivedFor(session);
  if (archived) return { ok: false, error: archived };
  const res = await staffBroadcast(ctx, scope, body, session.name);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/**
 * Turn direct messages on or off for the caller.
 *
 * Takes no id — the row is the caller's own: an account's roster row by its
 * own email and club, a guest's pass (J39/J40 PR 2). `from` says which screen
 * pressed, so a browser holding both an account and a link sets the one that
 * screen was drawn for; it picks between the caller's own two credentials,
 * never anybody else's. Returns false when an account has no roster row to
 * carry the preference, which the screen reports rather than silently
 * pretending to have saved.
 */
export async function setMyMessagesOptOut(optOut: boolean, from?: "player" | "console"): Promise<{ ok: boolean; error?: string }> {
  const { ctx } = await requireActor({ surface: from === "player" ? "player" : "console" });
  const saved = await setMessagesOptOut(ctx, optOut === true);
  if (!saved) return { ok: false, error: "You're not on the club roster yet, so there's nothing to save this against." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * What texting this scope would do, without doing it.
 *
 * Staff only — the recipient count and the skip reasons name members, which is
 * roster data. Shown before the send because "84 people, 2 segments each" is
 * the only number that changes what somebody writes.
 */
export async function previewSmsBroadcast(scope: string, body: string): Promise<SmsPlan | null> {
  const { ctx } = await requireMembership();
  if (ctx.role !== "admin" && ctx.role !== "assistant") return null;
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    // The ISO CODE, not the free-text symbol. `currencySymbol` predates the
    // currency setting and `saveOrganizationCurrency` never touches it, so a
    // club that set itself to GBP still had "$" here and was quoted its text
    // costs in the wrong money.
    select: { name: true, smsRateMicros: true, currency: true },
  });
  return planSmsBroadcast(
    ctx,
    scope,
    body,
    org?.name ?? "",
    org?.smsRateMicros ?? 0,
    currencySymbol(org?.currency || DEFAULT_CURRENCY),
  );
}

/** Post to a scope and text everyone in it who asked to be texted. */
export async function broadcastWithText(
  scope: string,
  body: string,
): Promise<PostResult & { texted?: number; failed?: number; skipped?: number }> {
  const { session, ctx } = await requireMembership();
  const archived = await archivedFor(session);
  if (archived) return { ok: false, error: archived };
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true },
  });
  const res = await broadcastWithSms(ctx, scope, body, session.name, org?.name ?? "");
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/**
 * Agree, or stop agreeing, to receive texts.
 *
 * No id parameter: the row is the caller's own, found by their session email
 * and their own club. The timestamps are written because "did you have consent
 * when you sent it" is answered by a date and not by a flag.
 */
export async function setMySmsOptIn(optIn: boolean): Promise<{ ok: boolean; error?: string }> {
  const { ctx } = await requireMembership();
  const now = new Date();
  const res = await prisma.member.updateMany({
    where: { organizationId: ctx.organizationId, email: { equals: ctx.whoKey, mode: "insensitive" } },
    data: optIn ? { smsOptIn: true, smsOptInAt: now } : { smsOptIn: false, smsOptOutAt: now },
  });
  if (res.count === 0) {
    return { ok: false, error: "You're not on the club roster yet, so there's nothing to save this against." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
