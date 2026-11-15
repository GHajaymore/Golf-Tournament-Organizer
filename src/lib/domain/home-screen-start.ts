import { landingScreenFor, type Role } from "@/lib/roles";

/**
 * WHERE THE HOME-SCREEN APP OPENS (J39/J40 PR 2, G3; design §8 item 3).
 *
 * An iPhone home-screen app keeps its OWN cookie jar, apart from Safari's, so
 * a guest who tapped their link in Safari and then pressed Add to Home Screen
 * opens the app signed out. The manifest's `start_url` was "/", the held front
 * door, which offers sign-in and nothing a guest can use. So the app starts at
 * `/start`, which sends each kind of person where they belong:
 *
 *   an account            its own home, exactly as "/" sends it (`landingScreenFor`)
 *   a guest's live link   Today (/me)
 *   a link that has ended /p, which says so ("This link no longer works")
 *   nobody                /p: the code box, one press away, and "Have an account? Sign in"
 *
 * Pure, so the four are tested without a request. The landing page itself
 * (`src/app/page.tsx`, Ajay's) is not touched.
 */

export type StartFacts =
  | { kind: "account"; eventId: string; viewRole: Role }
  | { kind: "guest" }
  | { kind: "nobody"; holdsEndedLink: boolean };

export function startDestination(f: StartFacts): string {
  if (f.kind === "account") return f.eventId ? landingScreenFor(f.viewRole) : "/choose";
  if (f.kind === "guest") return "/me";
  return f.holdsEndedLink ? "/p?ended=1" : "/p";
}

/** The manifest's own start: every installed app (iOS, Android, desktop) opens here. */
export const HOME_SCREEN_START = "/start";
