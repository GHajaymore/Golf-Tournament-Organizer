import "server-only";
import { cache } from "react";
import { getSession, type Session } from "./auth";
import { getGuestSession, playerViewChosen, type GuestSession } from "./guest-auth";
import { effectiveAccess } from "./services/access";
import type { GuestIdentity } from "./domain/player-link";

/**
 * WHO IS LOOKING AT THE PLAYER APP — an account, or a guest's player link
 * (J39/J40 PR 1; design §2.5, the review's S4 and S5).
 *
 * A viewer has the SHAPE of a `Session`, so the player screens read the event,
 * the name and the role exactly as before; `guest` says which kind it is. A
 * guest viewer carries an EMPTY email on purpose: every by-address reader
 * (`byAddress`, `membershipFor`, `clubEventsFor`, the money and prize readers)
 * already answers nobody for "", so a reader that has not learnt about guests
 * shows a guest nothing rather than somebody else's (fail closed). The readers
 * that HAVE learnt ask `myPlayerIdsFor`.
 *
 * What holds a link to one event is that the viewer carries only the pass's
 * event and entry, and every other door still calls `getSession()` and gets
 * null (`ORG_GUEST_ROLES` is about a User's seat at a club, not about links).
 */

/** A session, or a guest's link wearing a session's shape. */
export type PlayerViewer = Session & { guest: GuestIdentity | null };

/** The viewer a live pass makes. A player in one event, nothing wider, and no address. */
export function guestViewer(g: GuestSession): PlayerViewer {
  return {
    userId: "",
    accountId: "",
    eventId: g.eventId,
    name: g.name,
    email: "",
    role: "player",
    viewRole: "player",
    guest: { passId: g.passId, version: g.version, playerId: g.playerId, eventId: g.eventId, status: g.status },
  };
}

/**
 * Whether a signed-in account REACHES this event: its own, or one its access
 * reaches (an Account row, or a seat at the club, including a plain member's
 * `player` access to every event of their club). The writes' own test
 * (`requireScoreEntryForStage`: the account path first).
 */
async function accountReaches(account: Session, eventId: string): Promise<boolean> {
  if (account.eventId && account.eventId === eventId) return true;
  return (await effectiveAccess(account.email, eventId)) !== null;
}

/**
 * THE ONE PRECEDENCE, for what the screen shows AND what a save acts as
 * (security re-look D-1; SF-1). Does the link speak for its event in this
 * browser? Only for its own event; never beside an account that reaches that
 * event (the account acts as itself there, as the writes do); and never when
 * the person chose their own account. `playerViewSwitch` and `guestActorFor`
 * both ask this, so the screen cannot show one identity while a save acts as
 * another.
 */
async function linkSpeaksFor(account: Session | null, guest: GuestSession, eventId: string): Promise<boolean> {
  if (guest.eventId !== eventId) return false;
  if (!account) return true;
  if (await accountReaches(account, eventId)) return false;
  return (await playerViewChosen()) !== "account";
}

export interface PlayerViewSwitch {
  viewer: PlayerViewer | null;
  /** The other credential this browser holds, to offer beside this one (S4); never merged. */
  other: { kind: "account"; name: string } | { kind: "guest"; name: string } | null;
}

/**
 * THE VIEWER, RESOLVED PER EVENT (S4). A member of club A invited as a guest
 * to club B's outing is signed in to A: the link must still speak for B's
 * entry. So when this browser holds both, the link answers for the pass's own
 * event unless the person chose their account (`choosePlayerView`) or the
 * account itself reaches that event (`linkSpeaksFor`, the writes' precedence); the two are offered side by side and never merged — a guest
 * viewer never borrows the account's events, and an account viewer never the
 * link's entry.
 */
export const playerViewSwitch = cache(async (): Promise<PlayerViewSwitch> => {
  const [account, guest] = await Promise.all([getSession(), getGuestSession()]);
  if (!guest) return { viewer: account ? { ...account, guest: null } : null, other: null };
  if (!account) return { viewer: guestViewer(guest), other: null };
  // An account that reaches the link's event acts as itself there (D-1): the link is not offered,
  // because nothing pressed through it would act as the guest.
  if (await accountReaches(account, guest.eventId)) return { viewer: { ...account, guest: null }, other: null };
  if (!(await linkSpeaksFor(account, guest, guest.eventId))) return { viewer: { ...account, guest: null }, other: { kind: "guest", name: guest.name } };
  return { viewer: guestViewer(guest), other: { kind: "account", name: account.name } };
});

export async function getPlayerViewer(): Promise<PlayerViewer | null> {
  return (await playerViewSwitch()).viewer;
}

/** The one answer to "which entries are mine" lives with `myPlayerIds` (`services/me.ts`). */
export { myPlayerIdsFor, type Who } from "./services/me";

/**
 * THE GUEST WHO WRITES IN THIS EVENT, or null (S4, for a write whose event is
 * known from its round). The link speaks for its own event's entry beside a
 * sign-in only when that account does not reach the event. Never wider.
 */
export async function guestActorFor(eventId: string, account: Session | null): Promise<PlayerViewer | null> {
  const guest = await getGuestSession();
  // The read side's own precedence (`linkSpeaksFor`): never beside an account that reaches the
  // event, never after "Your own account" (SF-1, D-1).
  if (!guest || !(await linkSpeaksFor(account, guest, eventId))) return null;
  return guestViewer(guest);
}
