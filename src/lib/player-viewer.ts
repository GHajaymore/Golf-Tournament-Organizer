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

/** Staff of this event keep their own powers there, whatever link the browser also holds. */
async function staffOf(account: Session, eventId: string): Promise<boolean> {
  const access = await effectiveAccess(account.email, eventId);
  return access?.role === "admin" || access?.role === "assistant";
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
 * event unless the person chose their account (`choosePlayerView`) or is staff
 * of that event; the two are offered side by side and never merged — a guest
 * viewer never borrows the account's events, and an account viewer never the
 * link's entry.
 */
export const playerViewSwitch = cache(async (): Promise<PlayerViewSwitch> => {
  const [account, guest] = await Promise.all([getSession(), getGuestSession()]);
  if (!guest) return { viewer: account ? { ...account, guest: null } : null, other: null };
  if (!account) return { viewer: guestViewer(guest), other: null };
  if (await staffOf(account, guest.eventId)) return { viewer: { ...account, guest: null }, other: null };
  if ((await playerViewChosen()) === "account") return { viewer: { ...account, guest: null }, other: { kind: "guest", name: guest.name } };
  return { viewer: guestViewer(guest), other: { kind: "account", name: account.name } };
});

export async function getPlayerViewer(): Promise<PlayerViewer | null> {
  return (await playerViewSwitch()).viewer;
}

/** The one answer to "which entries are mine" lives with `myPlayerIds` (`services/me.ts`). */
export { myPlayerIdsFor, type Who } from "./services/me";

/**
 * THE GUEST WHO WRITES IN THIS EVENT, or null (S4, for a write whose event is
 * known from its round). The link speaks for its own event's entry even beside
 * a sign-in, unless the account is staff there. Never wider than that event.
 */
export async function guestActorFor(eventId: string, account: Session | null): Promise<PlayerViewer | null> {
  const guest = await getGuestSession();
  if (!guest || guest.eventId !== eventId) return null;
  if (account && (await staffOf(account, eventId))) return null;
  /**
   * AND NOT WHEN THE PERSON CHOSE THEIR OWN ACCOUNT (security review SF-1): the
   * screen then shows them as themselves, so the server must act as them too —
   * never the guest whose link this phone also holds. The read side
   * (`playerViewSwitch`) and this write side ask the same choice.
   */
  if (account && (await playerViewChosen()) === "account") return null;
  return guestViewer(guest);
}
