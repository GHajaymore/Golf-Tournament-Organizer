import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireSession } from "@/lib/page-helpers";
import { clubEventsFor, clubSeasonFor } from "@/lib/services/club-events";
import { enterTournament } from "@/app/actions/auth";
import { screenMetadata } from "@/lib/screen-metadata";
import { ClubEventsList } from "@/components/ClubEventsList";

export const metadata = screenMetadata("/me/events");

/**
 * Open one of the club's tournaments on the player's board.
 *
 * `setActiveEvent` rather than a plain link, because the play shell renders
 * whichever tournament is ACTIVE — a link to `/me/board` would show whichever
 * one they were last in, which is the wrong tournament and says nothing about
 * it being wrong.
 *
 * Authorization is NOT re-implemented here. `enterTournament` resolves
 * `effectiveAccess` and throws for anybody without it, which is the same rule
 * `clubEventsFor` listed the row under — so a forged `eventId` posted at this
 * form is refused by the guard that already exists rather than by a second
 * copy of it written on a screen.
 */
async function openTournament(formData: FormData): Promise<void> {
  "use server";
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) return;
  // Stay in the player app, and land where the button said: the board for
  // Leaderboard / Results, Today for a tournament you are in that has no
  // results yet. It sent everybody to their role's home, so an organizer who
  // also plays was thrown into the console from a player screen.
  await enterTournament(eventId, formData.get("to") === "today" ? "player" : "board");
}

/**
 * WHAT YOUR CLUB IS RUNNING, AND HOW TO GET INTO IT.
 *
 * The one screen a club system has that this app did not. A member could reach
 * a tournament only if an organizer had added them to it by hand, so the way
 * to find out what was on next month was to ask somebody. It is now also where
 * a member ENTERS: the organizer sets the tournament up and when entries open
 * and close, and every member sees it here — an email is optional.
 *
 * A TAB SINCE 2026-09-19, in place of Rules — the club's choice; see
 * PLAYER_TABS in `player-nav.ts`. The casual round lives here too.
 *
 * EVERY EVENT IS SHOWN, INCLUDING THE ONES THAT ARE SHUT. A closed tournament
 * with an honest band tells a member the club exists and is busy; hiding it
 * tells them nothing. The filters are how a member narrows the list, and they
 * are theirs to set — nothing is hidden by default.
 *
 * The list, the filters and the cards are `ClubEventsList`; every value on a
 * card — the band, "Closes in 9 days", places left — is decided on the server
 * in `clubEventsFor`, from the same `registrationStatus` the organizer reads.
 */
export default async function ClubEventsPage() {
  const session = await requireSession();
  const events = await clubEventsFor(session.email);
  // The club's own season, so this list groups the way its fixture card reads.
  const season = await clubSeasonFor(session.eventId);

  return (
    <>
      <div className="page-kicker">Your club</div>
      <h1 className="page-title">Events</h1>

      {/* A ROUND OF YOUR OWN, beside everything the club runs. It was a row on
          Today; since Events became a tab (2026-09-19) this is where "what can
          I play" lives, so there is one place to look rather than two. */}
      <Link
        href="/match/new"
        className="card elev-sm"
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          textDecoration: "none",
          color: "var(--color-text)",
        }}
      >
        <Icon name="sword" style={{ color: "var(--color-accent-300)", fontSize: 20 }} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Play a casual round</span>
          <span className="text-muted" style={{ fontSize: 12.5 }}>
            Just you and your group — no tournament needed
          </span>
        </span>
        <Icon name="arrow-right" />
      </Link>

      {/* THE MEMBER'S OWN HALF of this screen's question. Events is "what is my
          club running"; the calendar is "what have I got on, and when". A slim
          link rather than a second full card, so the fixture list below stays
          the point of the screen. */}
      <Link
        href="/me/calendar"
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          textDecoration: "none",
          color: "var(--color-text)",
          fontSize: 13.5,
        }}
      >
        <Icon name="calendar-check" style={{ color: "var(--color-accent-300)", fontSize: 18 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          Your calendar
          <span className="text-muted" style={{ display: "block", fontSize: 12 }}>
            Every round you&rsquo;re in, on the days they&rsquo;re played
          </span>
        </span>
        <Icon name="arrow-right" className="text-muted" />
      </Link>

      {events.length === 0 ? (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-title">Nothing on the calendar</span>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Your club has not published any tournaments yet. When it does, they
            will appear here and you can enter from this screen.
          </p>
        </div>
      ) : (
        <ClubEventsList events={events} openAction={openTournament} season={season} />
      )}
    </>
  );
}
