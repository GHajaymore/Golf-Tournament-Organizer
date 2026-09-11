import "server-only";
import { redirect } from "next/navigation";
import { primaryOrganizationFor } from "@/lib/services/organization";
import { headers } from "next/headers";
import { getSession, type Session } from "./auth";
import { canAccessScreen, landingScreenFor } from "./roles";
import { signInUrlFor } from "./domain/safe-next";
import { loadEventState, type EventState } from "./services/tournament";

/**
 * The sign-in URL, remembering where this request was trying to go.
 *
 * The path comes from the headers `middleware.ts` sets, because a server
 * component cannot see its own URL. If those headers are missing — a route the
 * matcher excludes, or a render outside a request — this degrades to the plain
 * sign-in page, which is exactly what happened before and is never wrong, only
 * less helpful.
 */
async function signInUrl(): Promise<string> {
  try {
    const h = await headers();
    const path = h.get("x-pathname");
    if (!path) return "/";
    return signInUrlFor(path, h.get("x-search") ?? "");
  } catch {
    return "/";
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  /**
   * Sends them back afterwards instead of dropping them on the landing page.
   *
   * An organizer texts a player a link to the tee sheet; the player is not
   * signed in, and used to arrive at the marketing page with no trace of where
   * they had been going. On a phone, at a course, that is where you lose them.
   */
  if (!session) redirect(await signInUrl());
  return session;
}

/**
 * A session plus a selected tournament. Someone who has signed up but has no
 * tournament yet holds a valid session with no event — every screen inside the
 * app shell needs one, so send them to the picker to create or choose it.
 */
export async function requireEventSession(): Promise<Session> {
  const session = await requireSession();
  if (!session.eventId) redirect("/choose");
  return session;
}

/**
 * A CLUB SCREEN, which needs a club rather than a tournament.
 *
 * `requireScreen` sends anyone without an active tournament to `/choose`, and
 * that is right for the tournament's own screens — there is nothing to show.
 * It is wrong for the club's: Members, Season standings and Club settings
 * belong to the organization and outlive every tournament it ever runs, and
 * routing them through `requireEventSession` is what made a brand-new club
 * invent a tournament before it could write down who its members are.
 *
 * Same role check, different prerequisite. Somebody who runs no club at all —
 * a player invited to somebody else's tournament — still goes to `/choose`,
 * because a club screen with no club is the empty case `/choose` exists for.
 */
export async function requireOrgScreen(
  key: string,
): Promise<{ session: Session; organizationId: string }> {
  const session = await requireSession();

  /**
   * THE ROLE ON A SESSION IS DERIVED FROM EVENT ACCESS, and a brand-new club
   * has no events.
   *
   * `getSession` reads `accessibleEvents`, and returns `role: "player"` when
   * that list is empty — which is right for somebody who has been invited to
   * nothing, and wrong for the secretary who has just created a club and not
   * yet a tournament. So the screen check refused them their own club's
   * settings, and the redirect sent them to `/choose` to make a tournament:
   * the exact loop this change exists to break. Found by walking a fresh
   * society sign-up on 2026-09-11, after the rest of it was already working.
   *
   * WITH A TOURNAMENT OPEN, nothing changes — the role check is the one every
   * other console screen makes, so a player inside somebody's tournament still
   * cannot reach that club's settings.
   *
   * WITHOUT ONE, the permission comes from the club instead:
   * `organizationsForOrganizer` returns only organizations this person owns or
   * administers, so membership of the returned club IS the authorization. It
   * is a narrower test than the role check, not a looser one.
   */
  if (session.eventId && !canAccessScreen(session.viewRole, key)) {
    redirect(landingScreenFor(session.viewRole));
  }
  const organizationId = await primaryOrganizationFor(session);
  if (!organizationId) redirect("/choose");
  return { session, organizationId };
}

/** Guard a screen key against the current view-role. */
export async function requireScreen(key: string): Promise<Session> {
  const session = await requireEventSession();
  if (!canAccessScreen(session.viewRole, key)) redirect(landingScreenFor(session.viewRole));
  return session;
}

export async function requireState(): Promise<{ session: Session; state: EventState }> {
  const session = await requireEventSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/choose");
  return { session, state };
}

/** Setup config is frozen once the event is live/completed, unless the organizer unlocked it. */
export function isSetupLocked(event: { status: string; configUnlocked: boolean }): boolean {
  return (event.status === "live" || event.status === "completed") && !event.configUnlocked;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
