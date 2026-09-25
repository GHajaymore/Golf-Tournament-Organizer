import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireEventSession } from "@/lib/page-helpers";
import { captainTeamSheetFor } from "@/lib/services/league-nomination";
import { captainNominatePair, captainWithdrawPair } from "@/app/actions/league";
import { PairBuilder } from "@/components/PairBuilder";
import { screenMetadata } from "@/lib/screen-metadata";

export const metadata = screenMetadata("/me/team");

/**
 * A CAPTAIN'S OWN TEAM SHEET.
 *
 * The organizer has always been able to nominate a club's pairs on the console;
 * this is the same team sheet, for the captain, on their phone, for the ONE
 * flight they run. It reuses the console's `PairBuilder` unchanged — only the
 * actions differ, and the captain's authorise against the flight they captain
 * rather than the active-event cookie (see `captainClubs` in actions/league.ts).
 *
 * Availability is shown and never enforced, exactly as on the console: a
 * captain picks who plays from who is available, and may still pick somebody
 * who has not answered, because a captain often knows what the app does not.
 * A last-minute swap after the sheet is set is a word to the organizer, who
 * makes it on the tee sheet — the captain's screen is for the selection, not
 * the start sheet.
 *
 * NOT A TAB — reached from a link on Events, and only shown to a captain. Four
 * tabs is the cap, and most players never captain anything.
 */
export default async function CaptainTeamPage() {
  const session = await requireEventSession();
  const sheet = await captainTeamSheetFor(session.eventId, session.email);

  return (
    <>
      <div className="page-kicker">Your team</div>
      <h1 className="page-title">Team selection</h1>

      {!sheet || sheet.clubs.length === 0 ? (
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-title">No team to pick here</span>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
            You&rsquo;ll see a team sheet here when your club has made you captain of a flight in a
            league that runs a weekly sign-up. Then you can pick who plays each week from those
            available.
          </p>
          <Link
            href="/me/events"
            className="btn btn-secondary"
            style={{ marginTop: 12, alignSelf: "flex-start" }}
          >
            <Icon name="arrow-left" /> Back to your events
          </Link>
        </div>
      ) : (
        <>
          <p className="text-muted" style={{ margin: "10px 0 18px", fontSize: 13, lineHeight: 1.5 }}>
            Picking for {sheet.round.label}
            {sheet.round.dateLabel ? ` · ${sheet.round.dateLabel}` : ""}
            {sheet.seasonOver ? " — the season&rsquo;s last round" : ""}. Choose who plays from those
            available. A late change after this is set is a word to your organiser, who makes it on the
            tee sheet.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {sheet.clubs.map((club) => (
              <PairBuilder
                key={club.clubId}
                club={club}
                stageId={sheet.round.stageId}
                onNominate={captainNominatePair}
                onWithdraw={captainWithdrawPair}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
