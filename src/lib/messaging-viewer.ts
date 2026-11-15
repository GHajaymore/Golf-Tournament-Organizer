import "server-only";
import { getSession, type Session } from "./auth";
import { getPlayerViewer, guestActorFor, type PlayerViewer } from "./player-viewer";
import { prisma } from "./db";
import { parseScopeKey, threadInOutwardKey, type MembershipContext } from "./domain/messaging";
import { membershipFor } from "./services/messaging";

/**
 * WHO IS ACTING IN MESSAGING, for one target (J39/J40 PR 2; design §1.2, the
 * SF-1/D-1 lesson applied before it can recur).
 *
 * The messaging actions take no event id: the console and the player app share
 * them. Asked of `getPlayerViewer()` alone, a member of club A holding a
 * guest's link for club B would read the CONSOLE as the account and send as
 * the guest — refused everywhere, a broken console, and the screen showing one
 * identity while the server acts as another. So the event comes from the
 * TARGET (the thread, or the scope's own object), and PR 1's one precedence
 * (`guestActorFor`, through `linkSpeaksFor`) says whether the link speaks for
 * that event. Otherwise the account speaks, for its OWN event, as it always has.
 *
 * `eventOf` NEVER AUTHORISES. It only picks which of the caller's own two
 * credentials speaks. The authorisation is still `visibleScopes(ctx)` in the
 * same `where` clause as every read (`services/messaging.ts`): an event id
 * taken from a target the caller cannot see picks a context in which that
 * target is not visible, so the call returns nothing.
 */

export interface MessagingTarget {
  threadId?: string;
  scope?: string;
  /**
   * Which screen pressed, for a press with no thread or scope (the opt-out
   * switch): "player" asks the player screen's viewer, as the screen drew it;
   * anything else the account. Picks between the caller's own credentials
   * only, like `eventOf`, never anyone else's.
   */
  surface?: "player" | "console";
}

export interface MessagingActor {
  ctx: MembershipContext;
  /** The name posts go out under: the account's, or the guest entry's. */
  name: string;
  /** The guest identity speaking, or null for an account. Never taken from an argument. */
  guest: PlayerViewer["guest"];
  /** The account's event (for the archive refusal and the role), or the guest's. */
  eventId: string;
  role: Session["role"];
}

/** Bounded, so a scope string off the wire never becomes an unbounded lookup. */
const MAX_ID = 64;
const plainId = (v: string) => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;

/**
 * The event a target belongs to, or null when it names none of its own. A
 * club thread, `event:`, `players:` and `staff:` name none: the caller's own
 * event answers for them.
 */
export async function eventOf(target: MessagingTarget): Promise<string | null> {
  if (target.threadId !== undefined) {
    if (!plainId(target.threadId)) return null;
    const t = await prisma.thread.findUnique({ where: { id: target.threadId }, select: { eventId: true } });
    return t?.eventId ?? null;
  }
  if (target.scope === undefined || typeof target.scope !== "string" || target.scope.length > 512) return null;
  const named = threadInOutwardKey(target.scope);
  if (named) return eventOf({ threadId: named });
  const parsed = parseScopeKey(target.scope);
  if (!parsed) return null;
  const id = parsed.kind === "foursome" ? parsed.id.split("#")[0] ?? "" : parsed.id;
  if (!plainId(id)) return null;
  const pick = (row: { eventId: string } | null) => row?.eventId ?? null;
  switch (parsed.kind) {
    case "round":
    case "foursome":
      return pick(await prisma.stage.findUnique({ where: { id }, select: { eventId: true } }));
    case "flight":
      return pick(await prisma.group.findUnique({ where: { id }, select: { eventId: true } }));
    case "team":
      return pick(await prisma.team.findUnique({ where: { id }, select: { eventId: true } }));
    case "match":
      return pick(await prisma.match.findUnique({ where: { id }, select: { eventId: true } }));
    case "desk":
      return pick(await prisma.player.findUnique({ where: { id }, select: { eventId: true } }));
    default:
      return null;
  }
}

/**
 * THE ONE RESOLVER every messaging action asks. Null when this browser holds
 * neither a sign-in nor a link that speaks for the target, or when the person
 * has no place there (a waiting guest: S5).
 */
export async function messagingContextFor(target: MessagingTarget): Promise<MessagingActor | null> {
  const account = await getSession();
  const fromScreen = target.surface === "player" && target.threadId === undefined && target.scope === undefined;
  if (fromScreen) {
    // A press with no target, from the player screen: whoever that screen was drawn for.
    const viewer = await getPlayerViewer();
    if (!viewer?.eventId) return null;
    return actorOf(viewer, viewer.eventId);
  }
  const eventId = (await eventOf(target)) ?? account?.eventId ?? (await getPlayerViewer())?.eventId ?? null;
  if (eventId) {
    const guest = await guestActorFor(eventId, account);
    if (guest) return actorOf(guest, eventId);
  }
  if (!account?.eventId) return null;
  return actorOf({ ...account, guest: null }, account.eventId);
}

async function actorOf(viewer: PlayerViewer, eventId: string): Promise<MessagingActor | null> {
  const ctx = await membershipFor(viewer, eventId);
  if (!ctx) return null;
  return { ctx, name: viewer.name, guest: viewer.guest, eventId, role: viewer.guest ? "player" : viewer.role };
}
