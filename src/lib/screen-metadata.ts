import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ACTIVE_COOKIE, verify } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { screenName } from "@/lib/nav";
import { isMatch } from "@/lib/tournament-shape";

/**
 * WHAT A SCREEN IS CALLED IN THE BROWSER TAB.
 *
 * Every console screen and the player's own screen inherited the root layout's
 * `title.default` — "TourneyHQ — Golf tournament management, from the draw to
 * the payout" — because not one of them named itself. The root metadata
 * already carries a `template` ("%s · TourneyHQ") and its comment says "every
 * page that names itself needs the suffix"; `/play`, `/choose`, `/live` and
 * `/privacy` do. The twenty-one console screens and `/me` never did, so the
 * template had nothing to fill.
 *
 * Walked on 2026-09-11: signed in as a society organizer with the tee sheet,
 * score entry and the leaderboard open, and all three tabs read the same
 * marketing sentence, truncated to "TourneyHQ — Golf tour…". The tabs are
 * indistinguishable, and so is every entry in the history menu and every
 * bookmark. That is the one screen `nav.ts` calls "at-desk" — someone working
 * for an hour on a wide screen, which is exactly the person who keeps four
 * tabs open.
 *
 * THE NAME COMES FROM THE SIDEBAR, not from a second list. `screenName` reads
 * `NAV`, which is already the single source for the link, the icon and the
 * touch tier — so a screen renamed in the sidebar is renamed in the tab on the
 * same line. Its own comment states the rule this follows: "spelling a screen's
 * name out a second time is how the app came to have a checklist row reading
 * 'Rounds & format'... neither of which is a screen."
 *
 * The sidebar label rather than the `<h1>`, where the two differ. A tab is read
 * as "which of my windows is this", and the answer wants to be the words the
 * organizer clicked — "Rules reference", not "The rules this competition runs
 * under". Eighteen of the twenty-one already match exactly; `/access` did not,
 * and was brought into line with its own door rather than given a third name.
 */
export function screenMetadata(href: string): Metadata {
  return { title: screenName(href) };
}

/**
 * The two screens a casual round calls something else.
 *
 * `MATCH_ITEM_LABEL` relabels exactly two keys — `dashboard` becomes "This
 * round" and `reports` becomes "Export this round" — because a Sunday fourball
 * has no desk and nothing to export but its own card. Titling those two
 * statically would put "Dashboard" and "Reports & export" back into a casual
 * round's browser tab, which is the tournament wording that was deliberately
 * taken out of its sidebar. A screen naming itself one thing in the sidebar and
 * another in the tab is the disagreement `screenName` exists to prevent, so the
 * two readers stay in step.
 *
 * ONE PRIMARY-KEY LOOKUP, and only on these two routes. Every other console
 * screen is static. Resolving the full session here would be correct and
 * costs an `accessibleEvents` fan-out per request for a string; the active-event
 * cookie is what `getSession` prefers anyway, and a tournament is the right
 * answer when there is no cookie to read — a casual round always sets one
 * (`setActiveEvent` runs when the round is created), and the fallback for a
 * signed-in organizer with no cookie is their newest TOURNAMENT.
 */
export async function screenMetadataForShape(href: string): Promise<Metadata> {
  const eventId = verify((await cookies()).get(ACTIVE_COOKIE)?.value);
  const event = eventId
    ? await prisma.event.findUnique({ where: { id: eventId }, select: { shape: true } })
    : null;
  return { title: screenName(href, isMatch(event?.shape)) };
}
