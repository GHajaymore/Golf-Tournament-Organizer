"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currencySymbol, DEFAULT_CURRENCY } from "@/lib/domain/money-format";
import {
  membershipFor,
  threadsFor,
  threadView,
  postToScope,
  markRead as markReadService,
  openDirectThread,
  staffBroadcast,
  composableScopes,
  unreadTotal,
  messagesOptOutFor,
  setMessagesOptOut,
  planSmsBroadcast,
  broadcastWithSms,
  type SmsPlan,
  type ThreadListItem,
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

async function requireMembership() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const ctx = await membershipFor(session.eventId, session.email, session.role);
  if (!ctx) throw new Error("No tournament");
  return { session, ctx };
}

/** Every conversation the caller can see. */
export async function listThreads(): Promise<ThreadListItem[]> {
  const { ctx } = await requireMembership();
  return threadsFor(ctx);
}

/**
 * One conversation. Null for "no such thread" AND for "not yours" — telling
 * those apart would confirm a thread exists to somebody not entitled to know.
 */
export async function readThread(threadId: string): Promise<ThreadView | null> {
  const { ctx } = await requireMembership();
  return threadView(ctx, threadId);
}

/** Post to a scope, creating its conversation on the first message. */
export async function sendMessage(scope: string, body: string): Promise<PostResult> {
  const { session, ctx } = await requireMembership();
  const res = await postToScope(ctx, scope, body, session.name);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** Move the caller's read watermark. No-op for a thread they cannot see. */
export async function markThreadRead(threadId: string): Promise<void> {
  const { ctx } = await requireMembership();
  await markReadService(ctx, threadId);
  revalidatePath("/", "layout");
}

/**
 * Start or reopen a direct conversation.
 *
 * The addresses DO come from the caller here, which makes this the one action
 * in the file that has to validate ids rather than derive them — the service
 * checks every one against this tournament's field and this club's roster
 * before a thread exists.
 */
export async function startDirectThread(withEmails: string[], firstMessage = ""): Promise<PostResult> {
  const { session, ctx } = await requireMembership();
  const res = await openDirectThread(ctx, withEmails, session.name, firstMessage);
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
  const res = await staffBroadcast(ctx, scope, body, session.name);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** Scopes the caller may start a conversation in, labelled for a picker. */
export async function listComposableScopes() {
  const { ctx } = await requireMembership();
  return composableScopes(ctx);
}

/** Unread count for the nav badge. */
export async function unreadMessageCount(): Promise<number> {
  const { ctx } = await requireMembership();
  return unreadTotal(ctx);
}

/** Whether the caller has turned off direct messages. */
export async function myMessagesOptOut(): Promise<boolean> {
  const { ctx } = await requireMembership();
  return messagesOptOutFor(ctx);
}

/**
 * Turn direct messages on or off for the caller.
 *
 * Takes no id — the row is found by the caller's own email and their own club,
 * so there is nothing here to point at somebody else. Returns false when they
 * have no roster row to carry the preference, which the screen reports rather
 * than silently pretending to have saved.
 */
export async function setMyMessagesOptOut(optOut: boolean): Promise<{ ok: boolean; error?: string }> {
  const { ctx } = await requireMembership();
  const saved = await setMessagesOptOut(ctx, optOut);
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
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true },
  });
  const res = await broadcastWithSms(ctx, scope, body, session.name, org?.name ?? "");
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** Whether the caller has agreed to receive texts. */
export async function mySmsOptIn(): Promise<boolean> {
  const { ctx } = await requireMembership();
  const member = await prisma.member.findFirst({
    where: { organizationId: ctx.organizationId, email: { equals: ctx.email, mode: "insensitive" } },
    select: { smsOptIn: true },
  });
  return member?.smsOptIn ?? false;
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
    where: { organizationId: ctx.organizationId, email: { equals: ctx.email, mode: "insensitive" } },
    data: optIn ? { smsOptIn: true, smsOptInAt: now } : { smsOptIn: false, smsOptOutAt: now },
  });
  if (res.count === 0) {
    return { ok: false, error: "You're not on the club roster yet, so there's nothing to save this against." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
