import "server-only";
import { redirect } from "next/navigation";
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
