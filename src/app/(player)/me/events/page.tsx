import { requireSession } from "@/lib/page-helpers";
import { clubEventsFor } from "@/lib/services/club-events";
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
  await enterTournament(eventId);
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
 * NOT A FIFTH TAB. `player-nav.ts` keeps the play shell to four and says why —
 * Money is the single exception and earns it by being conditional. This is a
 * destination reached from Today.
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

  return (
    <>
      <div className="page-kicker">Your club</div>
      <h1 className="page-title">Events</h1>

      {events.length === 0 ? (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-title">Nothing on the calendar</span>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Your club has not published any tournaments yet. When it does, they
            will appear here and you can enter from this screen.
          </p>
        </div>
      ) : (
        <ClubEventsList events={events} openAction={openTournament} />
      )}
    </>
  );
}
