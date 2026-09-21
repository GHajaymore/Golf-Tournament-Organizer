import { screenMetadata } from "@/lib/screen-metadata";
import { requireOrgScreen } from "@/lib/page-helpers";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadRoster, memberHistory } from "@/lib/services/roster";
import { indexLabel } from "@/lib/domain/handicap-label";

/**
 * `Player.status` in words. Its stored values are `confirmed | waitlisted |
 * withdrawn`, per the schema.
 *
 * LOCAL ON PURPOSE, and this is the first screen to print them as prose —
 * everywhere else counts them or filters on them. `HandicapSetup` keeps its
 * own `STATUS_LABEL` the same way. If a second screen ever needs these words,
 * that is the moment to move this to `domain/` rather than copy it: two
 * hand-written spellings of one stored value is the drift this codebase keeps
 * paying for.
 *
 * Falls back to the raw value rather than to a blank or a guess. A status
 * nobody has taught this map about should read as itself, not disappear.
 */
const ENTRY_STATUS: Record<string, string> = {
  confirmed: "Played",
  waitlisted: "Waiting list",
  withdrawn: "Withdrawn",
};

/**
 * WHAT ONE MEMBER HAS PLAYED AT THIS CLUB.
 *
 * `memberHistory` was written, tested and reachable from nothing: a club's
 * entry and handicap history sat in the database and on no screen. It was on
 * the unreached-service register from 2026-09-18 as an open decision, and Ajay
 * settled it on 2026-09-20 — a proper screen with its own nav entry, rather
 * than a table bolted onto the roster.
 *
 * A SCREEN RATHER THAN A ROW EXPANDER, and the reason is what the history is
 * FOR. The roster answers "who is in the club" and is read across, a hundred
 * names at a time. This answers "what has this one person done", which is a
 * different posture: a secretary checking a handicap before a committee
 * meeting, or answering a member who thinks their index is wrong. That reading
 * wants the whole screen, and it wants a URL somebody can send.
 *
 * WHY A QUERY PARAMETER RATHER THAN `/member/[id]`. A dynamic segment is
 * skipped by `e2e/routes.ts#consoleScreens`, which filters directory names
 * starting with `[` — so the screen would have had no heading assertion, no
 * sideways-scroll measurement and no touch-target floor, on a filesystem sweep
 * built precisely so a new screen is covered the day it is added. `?member=`
 * keeps it in the sweep and gives the no-selection case a real state to be
 * walked in, which is the state `verify-lifecycle.mjs` exercises and the one
 * most likely to be wrong.
 *
 * NO TOURNAMENT NEEDED. `requireOrgScreen` is the door `/roster` and
 * `/organization` use: the club is the thing that has members, and a society
 * that has not created its first tournament still has a roster to read. Using
 * the per-event door would have made a club screen depend on the tournament it
 * outlives — the deadlock `/roster`'s own comment describes.
 */
export const metadata = screenMetadata("/member");

export default async function MemberHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { organizationId } = await requireOrgScreen("member");
  const params = await searchParams;

  const members = await loadRoster(organizationId);
  /**
   * The id is checked against THIS club's roster before it is used.
   *
   * `memberHistory` scopes its own query to the organization as well, so a
   * stranger's id returns nothing rather than somebody else's record — but a
   * screen that renders "no entries" for a member who exists elsewhere is
   * confirming that the id is real. Resolving the name here means an id from
   * another club is simply not found, which is the same answer as a typo.
   */
  const selected = members.find((m) => m.id === params.member) ?? null;
  const history = selected ? await memberHistory(organizationId, selected.id) : [];

  return (
    <>
      <PageHeader
        kicker="Members"
        title={selected ? selected.name : "Member history"}
        subtitle={
          selected
            ? "Every tournament this member has entered, and the handicap each was played off."
            : "Pick a member to see what they have played and the handicap each round was scored on."
        }
        actions={
          <Link className="btn btn-ghost" href="/roster">
            Back to members
          </Link>
        }
      />

      {members.length === 0 ? (
        /**
         * A club with nobody in it yet. Says what to do rather than printing an
         * empty table — the state every club is in for its first ten minutes,
         * and the one `verify-lifecycle.mjs` walks.
         */
        <section className="card">
          <p style={{ margin: 0 }}>
            There are no members on this club&rsquo;s roster yet. Add them on{" "}
            <Link href="/roster">Members</Link> and their tournament history will build up here as
            they enter.
          </p>
        </section>
      ) : !selected ? (
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Choose a member</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {members.map((m) => (
              <li key={m.id}>
                <Link href={`/member?member=${encodeURIComponent(m.id)}`}>{m.name}</Link>{" "}
                <span className="text-muted" style={{ fontSize: 12 }}>
                  · {m.entryCount === 1 ? "1 tournament" : `${m.entryCount} tournaments`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : history.length === 0 ? (
        /**
         * A real member who has entered nothing. Distinct from "no members" and
         * from a tournament they played — an absence stated as an absence, not
         * as a table with no rows in it.
         */
        <section className="card">
          <p style={{ margin: 0 }}>
            {selected.name} has not entered any of the club&rsquo;s tournaments yet. Casual rounds
            are not counted here — they are not club competitions, and they do not build a
            handicap.
          </p>
        </section>
      ) : (
        <section className="card">
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Tournament</th>
                  <th>Dates</th>
                  <th>Status</th>
                  {/* The handicap AS IT STOOD, not the member's index today —
                      which is the whole reason this record is worth keeping. */}
                  <th>Played off</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.eventName}-${i}`}>
                    <td>{h.eventName}</td>
                    <td>{h.eventDates || <span className="text-muted">&mdash;</span>}</td>
                    <td>{ENTRY_STATUS[h.status] ?? h.status}</td>
                    {/* `indexLabel`, never the raw number: `handicapSource:
                        "none"` stores 0, which is indistinguishable from a
                        genuine scratch golfer to anything that prints the
                        figure. The service carries the source for exactly
                        this, and #441-#443 swept fourteen screens for it. */}
                    <td>{indexLabel(h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
