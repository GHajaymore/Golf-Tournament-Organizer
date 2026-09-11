import "server-only";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { screenName } from "@/lib/nav";
import { isOrgKind } from "@/lib/domain/org-profile";
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
 * The three screens whose name depends on the tournament open in front of you.
 *
 * Two move for a CASUAL ROUND: `MATCH_ITEM_LABEL` turns `dashboard` into "This
 * round" and `reports` into "Export this round", because a Sunday fourball has
 * no desk and nothing to export but its own card. One moves for the ORGANIZATION
 * — `/organization` is "Club settings", "Society settings" or "Outing settings"
 * depending on what the outfit is.
 *
 * `/organization` is here because the first cut of this got it wrong and the
 * walk showed it: a society's sidebar read "Society settings" and its browser
 * tab read "Club settings". Titling from `NAV`'s constant was only half the
 * job — `screenName` did not know about either relabel, which was invisible for
 * as long as the sidebar was the only thing reading it. Both now resolve a
 * label through `itemLabel`, so they cannot drift again.
 *
 * THE SAME EVENT THE SIDEBAR IS LOOKING AT, resolved the same way.
 *
 * Written first to read the `ng_active_event` cookie directly, which is
 * cheaper and is what `getSession` prefers — and it was wrong in the one case
 * that matters. That cookie is set when somebody creates or switches
 * tournament; a staff member who signs in and lands on a colleague's event has
 * never set it, and `getSession` then falls back to their newest accessible
 * event. The sidebar would read "Society settings" off that fallback while the
 * tab read "Club settings" off no cookie at all — the same two-names-for-one-
 * screen fault, moved rather than fixed.
 *
 * So this asks the session, and then one primary-key lookup, on three routes.
 * Every other console screen is static.
 */
export async function screenMetadataForEvent(href: string): Promise<Metadata> {
  const session = await getSession();
  const event = session?.eventId
    ? await prisma.event.findUnique({
        where: { id: session.eventId },
        select: { shape: true, organization: { select: { kind: true } } },
      })
    : null;
  const kind = event?.organization.kind ?? "";
  return {
    title: screenName(href, isMatch(event?.shape), isOrgKind(kind) ? kind : undefined),
  };
}
