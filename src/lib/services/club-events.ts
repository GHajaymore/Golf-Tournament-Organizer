import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { accessibleEvents } from "./access";
import { registrationStatus, entryDatesOf } from "../registration";
import { todayIso } from "../deadline";
import {
  eventBand,
  whenOf,
  entryWindowNote,
  entryProgress,
  placesNote,
  BAND_LABEL,
  type EventBand,
} from "../domain/club-event-card";
import { venueOf } from "./registration";
import { seasonWindow, type SeasonWindow } from "../domain/club-season";

/**
 * EVERY TOURNAMENT A MEMBER'S CLUB IS RUNNING, AND WHERE THEY STAND IN IT.
 *
 * The screen this feeds is the one thing a club system has that this app did
 * not: sign in, see what your club is running, put your name down. Golf Genius
 * and ForeTees both open on it. Here a member could reach a tournament only if
 * an organizer had added them to it by hand — so the answer to "what's on next
 * month?" was to ask somebody.
 *
 * THE STATUS IS THE CONSOLE'S OWN. `registrationStatus` is what the organizer's
 * registration screen shows, and it already folds together the four things that
 * close a door — the tournament finished, the organizer closed it by hand, the
 * deadline passed, the field is full — into one label with a sentence
 * explaining it. Deriving a second opinion here is how a member reads "Open"
 * on a tournament the console calls full.
 *
 * ENTERED IS ANSWERED PER MEMBER, by email against the Player rows, which is
 * the same resolution `myPlayerIds` uses for the card guards. A member who is
 * in the field gets their standing in it; one who is not gets the way in.
 */

export interface ClubEventRow {
  eventId: string;
  name: string;
  /** When it is played, as a sentence derived from the dates below. May be empty. */
  dates: string;
  /** What the club calls this one — outing, charity day. See domain/play-kind.ts. */
  playKind: string;
  /** The first day played, `yyyy-mm-dd`, or "" — what seasons are worked out from. */
  startOn: string;
  /** Whether the club has fixed those dates — see `datesTentative` on Event. */
  datesTentative: boolean;
  /** "Royal Ashdown, Forest Row" — course and town, as the entry form shows it. */
  venue: string;
  /** The league or society this belongs to, when it belongs to one. */
  seriesName: string;
  /** draft | registration | ready | live | completed. */
  eventStatus: string;
  /** "Open", "Closed", "Full" — the same word the console uses. */
  statusLabel: string;
  /** One sentence saying why, for the ones that are shut. */
  statusDetail: string;
  /**
   * When entries open and close, as a member reads it — "Entries open 14 Sep ·
   * close 27 Sep", "Entries close 27 Sep" — or "" when neither is set, or the
   * tournament is over and the dates no longer mean anything.
   *
   * Written here rather than on the screen so it is one sentence with one set
   * of rules, next to the status it has to agree with.
   */
  entryDates: string;
  /** Whether this member could put their name down right now. */
  canEnter: boolean;
  /** Whether they already have. */
  entered: boolean;
  /** Where the sign-up form lives, when there is one to offer. */
  registrationHref: string;
  /**
   * Whether there is anything to LOOK at yet.
   *
   * A closed tournament is not a dead end — it is the one a member most wants
   * to open, because it has a result on it. A draft nobody has touched is,
   * and offering a board with nothing on it teaches a member that the link
   * does not work.
   */
  canView: boolean;
  /** "Results" once it is over, "Leaderboard" while it is being played. */
  viewLabel: string;
  /** The coloured band across the card — see `domain/club-event-card.ts`. */
  band: EventBand;
  bandLabel: string;
  /** Which "When" filter it falls under. */
  when: "upcoming" | "now" | "finished";
  /** "Closes in 9 days" / "Entries open tomorrow", or "". */
  windowNote: string;
  /** Where THIS member stands — "You're on the waiting list…" — or "". */
  yourStatus: string;
  /** 0..1 through the entry window, or null without two real dates. */
  progress: number | null;
  /** "18 of 32 places left", "Full — waiting list open", or "". */
  placesNote: string;
}

/**
 * Memoised per request with React's `cache`: the play shell's layout reads
 * this for the tournament switcher and Today reads it again for the watching
 * card, and one render should not count the club's cards twice. Outside a
 * render (the audit tests) it is simply the function.
 */
export const clubEventsFor = cache(clubEventsUncached);

/**
 * The season window of the club this tournament belongs to.
 *
 * Read from the club rather than passed around, so the player's list and the
 * organizer's screens group by the same answer. A tournament with no club, or
 * a club that has never set one, falls back to the calendar year — which is
 * `seasonWindow`'s own reading of an unanswered question.
 */
export async function clubSeasonFor(eventId: string): Promise<SeasonWindow> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization: { select: { seasonStartsOn: true, seasonEndsOn: true } } },
  });
  return seasonWindow(event?.organization?.seasonStartsOn ?? "", event?.organization?.seasonEndsOn ?? "");
}

async function clubEventsUncached(email: string): Promise<ClubEventRow[]> {
  const reachable = await accessibleEvents(email);
  if (reachable.length === 0) return [];

  const ids = reachable.map((r) => r.eventId);
  /**
   * TOURNAMENTS, NOT CASUAL ROUNDS (2026-09-19, Ajay's rule: "casual rounds or
   * your side bets should not count as previous rounds").
   *
   * A casual round is stored as an Event because that is what the app hangs a
   * card off, not because it is one — the same distinction `activeEventCount`
   * draws for billing and the club settings page draws for its tournament
   * count. Without this filter, a fourball somebody set up on a Tuesday
   * appeared on the club's fixture list beside the Club Championship, and
   * once seasons group that list it would be filed as part of the club's
   * history for ever.
   *
   * TWO TESTS, because either alone is a guess. `shape: "match"` is what
   * `match-setup` writes, and `expiresAt` is the expiry only a casual round
   * carries — `round-expiry.ts`: "a casual round carries an expiry and a
   * tournament does not". A row that fails either test is not something a club
   * organized, whatever it is.
   */
  const events = await prisma.event.findMany({
    where: { id: { in: ids }, shape: { not: "match" }, expiresAt: null },
    include: { series: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  /**
   * Counted in ONE query rather than per event.
   *
   * A club with forty tournaments on the books would otherwise issue forty
   * counts to render one list, and this screen is the first thing a member
   * opens.
   */
  const confirmedCounts = await prisma.player.groupBy({
    by: ["eventId"],
    where: { eventId: { in: ids }, status: "confirmed" },
    _count: { _all: true },
  });
  const confirmedBy = new Map(confirmedCounts.map((c) => [c.eventId, c._count._all]));

  const mine = await prisma.player.findMany({
    where: { eventId: { in: ids }, email: { equals: email, mode: "insensitive" } },
    select: { eventId: true, status: true },
  });
  /**
   * ENTERED MEANS CONFIRMED — the rule `myPlayerIds` and every card guard use.
   * This counted any row, so a player on the waiting list read "You’re in" in
   * the switcher while Today, asking the confirmed field, told them they were
   * not entered. A pending or waitlisted row is said as such, and is not
   * offered the entry form a second time.
   */
  const enteredIn = new Set(mine.filter((p) => p.status === "confirmed").map((p) => p.eventId));
  const waitingIn = new Set(
    mine.filter((p) => p.status === "waitlisted" || p.status === "pending").map((p) => p.eventId),
  );

  /**
   * WHETHER THERE IS ANYTHING BEHIND THE LINK, COUNTED RATHER THAN ASSUMED.
   *
   * This asked `status` — "ready, live or completed" — and the seeded Demo Cup
   * disproves it on the first screen it renders: `status: "draft"`, fifty-four
   * results in. CLAUDE.md says the same thing in as many words, that clubs run
   * tournaments in draft and a gate keyed on launching would lock players out
   * of rounds they are in the middle of.
   *
   * So the question is asked of the ROWS. A tournament with a card or a
   * fixture on it has a board worth opening whatever its status column says;
   * one with neither does not, and sending a member to an empty table teaches
   * them the link is broken rather than that the tournament has not started.
   *
   * Two grouped queries rather than two per event, for the same reason the
   * confirmed counts above are grouped.
   */
  const [cardEvents, matchEvents] = await Promise.all([
    prisma.scorecard.groupBy({ by: ["eventId"], where: { eventId: { in: ids } }, _count: { _all: true } }),
    prisma.match.groupBy({ by: ["eventId"], where: { eventId: { in: ids } }, _count: { _all: true } }),
  ]);
  const hasResults = new Set([
    ...cardEvents.map((c) => c.eventId),
    ...matchEvents.map((m) => m.eventId),
  ]);

  /**
   * AN EMPTY DRAFT IS NOT ON THE CLUB'S FIXTURE LIST (2026-09-19).
   *
   * A tournament the club has not published, with nothing on it, told a member
   * nothing they could act on — and the card read "Closed", which says "this
   * was open and you missed it" about something that has never opened. Seen on
   * the seeded club's "Winter Series — Not Yet Planned": a name and nothing
   * else.
   *
   * A DRAFT WITH RESULTS STAYS, which the audit suite caught this rule getting
   * wrong. Clubs do play tournaments they never launched — `canView` already
   * says "there is something on it" — and hiding one that people are scoring
   * would be far worse than showing an empty one.
   */
  return events
    .filter((event) => event.status !== "draft" || hasResults.has(event.id))
    .map((event) => {
    const status = registrationStatus({
      eventStatus: event.status,
      deadline: event.regDeadline,
      opens: event.regOpens,
      capacity: event.capacity,
      confirmedCount: confirmedBy.get(event.id) ?? 0,
      override: event.registrationOverride,
    });

    const entered = enteredIn.has(event.id);
    /**
     * `registrationOpen` is the organizer's master switch and is separate from
     * the four reasons above: a club that has not opened entries at all has no
     * form to send anybody to, however healthy the deadline looks.
     */
    const waiting = !entered && waitingIn.has(event.id);
    const canEnter = !entered && !waiting && status.acceptingEntries && event.registrationOpen;
    const band = eventBand({ eventStatus: event.status, regState: status.state, canEnter, entered });
    const today = todayIso();

    return {
      band,
      bandLabel: BAND_LABEL[band],
      when: whenOf(band),
      /**
       * WHERE THIS MEMBER STANDS, separately from the entry window.
       *
       * It used to ride on `windowNote`, which the card renders only for the
       * "open" and "soon" bands — so a member on the WAITING LIST, which
       * happens when a tournament is full and therefore closed, was told
       * nothing about themselves at all. Read off the seeded club's Am-Am on
       * 2026-09-19: "All 12 places taken; further entries join the waitlist",
       * and not a word about the fact that they were on it.
       *
       * Their own status is the one line on the card that is about them, so it
       * is its own field and the screen shows it whatever the band.
       */
      yourStatus: waiting ? "You’re on the waiting list — the organizer will confirm your place." : "",
      windowNote: entryWindowNote({ band, opens: event.regOpens, closes: event.regDeadline, today }),
      progress: band === "open" || band === "soon" ? entryProgress(event.regOpens, event.regDeadline, today) : null,
      placesNote:
        band === "open" || band === "soon"
          ? placesNote(event.capacity, confirmedBy.get(event.id) ?? 0, status.waitlisting)
          : "",
      eventId: event.id,
      name: event.name,
      dates: event.dates,
      // The calendar date this is grouped by — see `domain/club-season.ts`. The
      // sentence above is what a member READS; this is what the app sorts on,
      // and the two cannot disagree because the sentence is derived from it.
      startOn: event.startOn,
      playKind: event.playKind,
      // Said on the card, because a member plans around this one line. See
      // `datesTentative` on the schema.
      datesTentative: event.datesTentative,
      venue: venueOf(event.course, event.city),
      seriesName: event.series?.name ?? "",
      eventStatus: event.status,
      statusLabel: status.label,
      statusDetail: status.detail,
      entryDates: entryDatesOf(event.regOpens, event.regDeadline, event.status),
      canEnter,
      entered,
      registrationHref: canEnter ? `/register/${event.registrationToken}` : "",
      /**
       * Worth opening if there is something on it, or if the club has said it
       * is under way. Counted, not assumed — see the note above `hasResults`.
       */
      canView: hasResults.has(event.id) || ["ready", "live", "completed"].includes(event.status),
      viewLabel: event.status === "completed" ? "Results" : "Leaderboard",
    };
  });
}
