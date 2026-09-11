import "server-only";
import { prisma } from "../db";
import { todayIso } from "../deadline";
import { cleanIsoDate, shortDate } from "../domain/round-dates";
import { isMatch } from "../tournament-shape";
import { roundLabel } from "../domain/round-label";

/**
 * Whether the person setting up a casual round is due to play a TOURNAMENT
 * round today.
 *
 * A quick round is a separate, private thing: its own field, its own pot, its
 * own card, and it is deleted a day later. That is exactly right for a Sunday
 * fourball and exactly wrong for the morning of the club medal — where the
 * committee has drawn a tee sheet, the group is set, and the money is the
 * club's. Somebody who sets up a quick round on that morning ends up with two
 * cards for one round of golf: the one the club will score them on, and one
 * that vanishes tomorrow taking their skins with it.
 *
 * So they are TOLD, and not stopped. There are real reasons to build one
 * anyway — a private bet inside a fourball is a thing golfers do, and the
 * group-games screen inside the tournament is where that belongs, which is
 * what the warning points at. Refusing would be the app deciding it knows
 * better than somebody standing on the tee.
 *
 * TODAY, not "any live tournament". A league runs for four months and a
 * member of it is not playing a tournament round on a Tuesday in June —
 * warning them every time they open this screen is how a warning stops being
 * read, which is the same argument `org-setup.ts` makes about consequences
 * nobody can act on.
 */
export interface TournamentClash {
  eventId: string;
  eventName: string;
  /** "Round 2", or the organizer's own description of it. */
  roundLabel: string;
  /** "Tue 19 May" — the day, already formatted on the server. */
  dateLabel: string;
  /** A tee sheet has been published, so their group and time are decided. */
  teeSheetPublished: boolean;
  /** The tournament runs its own pots, so a second one would split the field. */
  hasMoneyGame: boolean;
}

/**
 * The tournament round this person is due to play today, or null.
 *
 * Confirmed entrants only. Somebody on the waitlist is not playing, and
 * telling them to follow a tee sheet they are not on would be worse than
 * saying nothing.
 *
 * Casual rounds are excluded by shape — one quick round is not a reason to
 * warn somebody off another — which also keeps this from firing on the round
 * they set up an hour ago.
 */
export async function tournamentClashFor(
  email: string,
  now: Date = new Date(),
): Promise<TournamentClash | null> {
  const today = todayIso(now);

  const entries = await prisma.player.findMany({
    where: {
      email: { equals: email, mode: "insensitive" },
      status: "confirmed",
      event: { status: "live" },
    },
    select: {
      event: {
        select: {
          id: true,
          name: true,
          shape: true,
          stages: {
            // `type` is here for `roundLabel`, which is the ONLY thing in this
            // app allowed to count rounds — a cut is a stage and not a round,
            // so position+1 numbers them wrongly the moment one exists. This
            // reader had `Round ${position + 1}` and `round-number-source`
            // caught it, which is exactly what that guard is for.
            select: {
              id: true,
              type: true,
              description: true,
              playedOn: true,
              teeSheetPublished: true,
            },
            orderBy: { position: "asc" },
          },
          _count: { select: { skinsPots: true, contests: true, sideGames: true } },
        },
      },
    },
  });

  for (const { event } of entries) {
    // A quick round is not a tournament, whatever else is true of it.
    if (isMatch(event.shape)) continue;

    const roundToday = event.stages.find((s) => cleanIsoDate(s.playedOn) === today);
    if (!roundToday) continue;

    return {
      eventId: event.id,
      eventName: event.name,
      // The organizer's own description wins, exactly as every other screen
      // does it — "Club Medal" is more use than "Round 1". The fallback goes
      // through `roundLabel`, the one counter, which does not count a cut as
      // a round.
      roundLabel: roundToday.description.trim() || roundLabel(event.stages, roundToday.id),
      dateLabel: shortDate(today),
      teeSheetPublished: roundToday.teeSheetPublished,
      hasMoneyGame:
        event._count.skinsPots > 0 || event._count.contests > 0 || event._count.sideGames > 0,
    };
  }

  return null;
}
