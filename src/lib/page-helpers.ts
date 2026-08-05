import "server-only";
import { redirect } from "next/navigation";
import { getSession, PLAYER_SCREENS, ADMIN_ONLY_SCREENS, type Session } from "./auth";
import { loadEventState, type EventState } from "./services/tournament";

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/");
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
  const vr = session.viewRole;
  if (vr === "player" && !PLAYER_SCREENS.has(key)) redirect("/dashboard");
  if (vr === "assistant" && ADMIN_ONLY_SCREENS.has(key)) redirect("/dashboard");
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
