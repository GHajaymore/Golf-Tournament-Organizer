import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { clubEventsFor } from "@/lib/services/club-events";
import { enterTournament } from "@/app/actions/auth";
import { screenMetadata } from "@/lib/screen-metadata";
import { Icon } from "@/components/Icon";

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
 * to find out what was on next month was to ask somebody.
 *
 * NOT A FIFTH TAB. `player-nav.ts` keeps the play shell to four and says why —
 * Money is the single exception and earns it by being conditional, so "nothing
 * had to leave, and nobody is asked to read past a tab their event does not
 * use". This is a destination reached from Today rather than a permanent
 * fixture at the bottom of a phone that is out on a golf course.
 *
 * EVERY EVENT IS SHOWN, INCLUDING THE ONES THAT ARE SHUT. A closed tournament
 * with an honest badge tells a member the club exists and is busy; hiding it
 * tells them nothing and invites the question this screen is meant to answer.
 * That is also the answer to whether a half-configured tournament should be
 * hidden — it should be labelled, not concealed.
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {events.map((e) => (
            <div key={e.eventId} className="card elev-sm">
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span className="card-title" style={{ minWidth: 0 }}>{e.name}</span>
                {/* The console's own word for it, so a member cannot read
                    "Open" on a tournament the organizer's screen calls full. */}
                <span
                  className={e.canEnter ? "tag tag-accent" : "tag tag-neutral"}
                  style={{ flex: "0 0 auto" }}
                >
                  {e.entered ? "Entered" : e.statusLabel}
                </span>
              </div>

              {/* The series is the league or society it belongs to — the
                  "Men's League" or "SMGA" a member recognises before they
                  recognise the tournament's own name. */}
              {e.seriesName && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {e.seriesName}
                </div>
              )}

              <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                {[e.dates, e.venue].filter(Boolean).join(" · ") || "Dates to be confirmed"}
              </div>

              {/* The entry window, whether or not it is open yet — a member
                  deciding what to play next month wants the dates as much as
                  the badge. */}
              {e.entryDates && !e.entered && (
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500 }}>{e.entryDates}</div>
              )}

              {/* Why it is shut, in the console's own sentence. Only where it
                  adds something the badge did not already say. */}
              {!e.canEnter && !e.entered && e.statusDetail && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {e.statusDetail}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {e.canEnter && (
                  <Link className="btn btn-primary" href={e.registrationHref}>
                    Enter this tournament <Icon name="arrow-right" />
                  </Link>
                )}

                {/* A CLOSED TOURNAMENT IS NOT A DEAD END — it is the one a
                    member most wants to open, because it has a result on it.
                    Entering it is a server action rather than a link because
                    the play shell renders whichever tournament is ACTIVE, so
                    the active-event cookie has to move before the board can
                    show this one. Same mechanism `/choose` uses to switch. */}
                {e.canView && (
                  <form action={openTournament}>
                    <input type="hidden" name="eventId" value={e.eventId} />
                    <button className="btn btn-ghost" type="submit">
                      {e.viewLabel} <Icon name="arrow-right" />
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
