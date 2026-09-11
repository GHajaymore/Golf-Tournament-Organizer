import { prisma } from "@/lib/db";

/**
 * The notices an organizer has posted, for whoever is about to read them.
 *
 * ONE READER, BECAUSE THE LAST ONE WAS BUILT INLINE AND ONLY ONCE. The
 * dashboard's own comment, directly above where this query used to live,
 * records the previous instance of exactly this bug — about the availability
 * card: "It used to be built inline here — and only here, which is why the one
 * screen players actually land on never showed it."
 *
 * Announcements were the next line down, built inline there and only there.
 * `/announcements` tells the organizer "Pinned posts sit at the top of every
 * player's dashboard" and "Posts appear on every player's dashboard" — and
 * `landingScreenFor("player")` returns `/me`, the player tab bar offers Today,
 * Board, My card, Rules and Money, and nothing under `(player)` mentioned an
 * announcement at all. A player could reach `/dashboard` by typing it, and had
 * no reason to know it was there.
 *
 * So an organizer posting "frost delay, tee times back an hour" reached
 * nobody, from the screen built for reaching everybody. Walked on 2026-09-11.
 *
 * Pinned first, then newest, which is the order the dashboard already used and
 * the only order that makes "pinned" mean anything.
 */
export async function announcementsFor(eventId: string, take = 3) {
  // A saved round-trip, not a safety guard: `getSession` returns "" for
  // somebody with no tournament, and `where: { eventId: "" }` would match
  // nothing anyway. Said plainly because the test beside it first claimed
  // this prevented an unfiltered read, which it does not.
  if (!eventId) return [];
  return prisma.announcement.findMany({
    where: { eventId },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take,
  });
}
