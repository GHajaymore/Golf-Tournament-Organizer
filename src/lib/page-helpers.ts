import "server-only";
import { redirect } from "next/navigation";
import { getSession, PLAYER_SCREENS, type Session } from "./auth";
import { loadEventState, type EventState } from "./services/tournament";

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/");
  return session;
}

/** Guard a screen key against the current view-role; players get a limited set. */
export async function requireScreen(key: string): Promise<Session> {
  const session = await requireSession();
  if (session.viewRole === "player" && !PLAYER_SCREENS.has(key)) redirect("/dashboard");
  return session;
}

export async function requireState(): Promise<{ session: Session; state: EventState }> {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  return { session, state };
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
