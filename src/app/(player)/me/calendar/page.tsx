import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireSession } from "@/lib/page-helpers";
import { clubCommitmentsFor } from "@/lib/services/club-calendar";
import { todayIso } from "@/lib/deadline";
import { screenMetadata } from "@/lib/screen-metadata";
import { ClubCalendar } from "@/components/ClubCalendar";

export const metadata = screenMetadata("/me/calendar");

/**
 * YOUR GOLF, ACROSS THE WHOLE CLUB, ON DAYS.
 *
 * `/me/events` is the club's fixture list — what is on, and how to enter. This
 * is the other half of the same question a member asks in the spring: not
 * "what is the club running" but "what have *I* got on, and when". Every
 * tournament they hold a confirmed place in, laid on a calendar, so a holiday
 * or a work trip can be checked against the season in one look rather than by
 * opening each tournament in turn.
 *
 * It is also where a member manages their availability across every league at
 * once. Where a league still lets a player choose — opt-in or opt-out, before
 * the round's deadline — the row carries an In/Out control wired to
 * `setOwnAttendance`, which re-checks ownership of that specific round rather
 * than trusting whichever tournament happens to be open.
 *
 * NOT A TAB, by decision — see PLAYER_CALENDAR in player-nav.ts. Four tabs is
 * the cap, and this is a plan-ahead screen, not one a player stands on during a
 * round.
 */
export default async function ClubCalendarPage() {
  const session = await requireSession();
  const commitments = await clubCommitmentsFor(session.email);

  return (
    <>
      <div className="page-kicker">Your club</div>
      <h1 className="page-title">Your calendar</h1>

      {commitments.length === 0 ? (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-title">Nothing on your calendar yet</span>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
            Once you are entered in one of your club&rsquo;s tournaments, its rounds appear here on the
            days they are played — and where a league lets you choose your weeks, you can set them from
            this screen.
          </p>
          <Link
            href="/me/events"
            className="btn btn-secondary"
            style={{ marginTop: 12, alignSelf: "flex-start" }}
          >
            <Icon name="calendar-dots" /> See what your club is running
          </Link>
        </div>
      ) : (
        <>
          <p className="text-muted" style={{ margin: "10px 0 18px", fontSize: 13, lineHeight: 1.5 }}>
            Every round you are entered in, across the club. Where a league still lets you choose,
            set whether you are in right here.
          </p>
          <ClubCalendar commitments={commitments} today={todayIso()} />
        </>
      )}
    </>
  );
}
