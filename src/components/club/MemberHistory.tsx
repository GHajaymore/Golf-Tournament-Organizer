import Link from "next/link";
import { memberHistoryHref, type ConsoleMode } from "@/lib/console-url";
import { memberHistory, type RosterMember } from "@/lib/services/roster";
import { indexLabel } from "@/lib/domain/handicap-label";
import { meetingsFor } from "@/lib/services/head-to-head";
import { recordAgainst, recordLine, recordVerdict } from "@/lib/domain/head-to-head";

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
 * WHAT ONE MEMBER HAS PLAYED AT THIS CLUB (moved out of `/member`'s page by R7, so Members can draw it too).
 *
 * A server component with no directive. It decides nothing about WHO may see it: the page that mounts it
 * has passed `requireOrgScreen` for the roster's roles (admin and assistant, never a player), and every
 * read here is scoped to `organizationId`. The member's id is checked against THIS club's roster before it
 * is used, so an id from another club is simply not found, the same answer as a typo.
 *
 * `base` is where a member's link goes: `/member` (today) or `/roster` (Members, while it is shown). The
 * one component is mounted once per request by the one boolean `shown.has("members")`.
 */
export async function MemberHistory({
  organizationId,
  members,
  memberId,
  base,
  previewMode,
}: {
  organizationId: string;
  /** THIS club's roster, read ONCE by the page (`loadRoster`); the id is looked up in it and nowhere else. */
  members: RosterMember[];
  memberId: string | undefined;
  base: "/member" | "/roster";
  /** The preview the request is in, so a link inside a previewed screen stays inside it (`previewModeNow`). */
  previewMode: ConsoleMode | null;
}) {
  const selected = members.find((m) => m.id === memberId) ?? null;
  const history = selected ? await memberHistory(organizationId, selected.id) : [];
  /**
   * HEAD-TO-HEAD (2026-09-28) — this member's record against everybody they
   * have met in a match here, each meeting counted exactly as that
   * tournament's own table counted it (`meetingsFor`).
   */
  const records = selected && history.length ? recordAgainst(selected.id, await meetingsFor(organizationId, selected.id)) : [];
  const nameOfMember = new Map(members.map((m) => [m.id, m.name]));
  const hrefOf = (id: string) => memberHistoryHref(id, base, previewMode);

  return (
    <>
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
      ) : !selected && base === "/roster" ? (
        /* The list above already holds every name: no second list of them here (R7 review P2). */
        <p className="text-muted" style={{ margin: 0 }}>
          Press a member&rsquo;s name in the list above to see what they have played.
        </p>
      ) : !selected ? (
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Choose a member</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {members.map((m) => (
              <li key={m.id}>
                <Link href={hrefOf(m.id)}>{m.name}</Link>{" "}
                <span className="text-muted" style={{ fontSize: 13 }}>
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

      {selected && history.length > 0 && (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="match-record">
          <h2 id="match-record" style={{ marginTop: 0, fontSize: 16 }}>
            Match record
          </h2>
          {records.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              No finished matches against another member yet. Match play, knockouts and team-cup singles count
              here; medals and team four-balls do not.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Against</th>
                    <th>Record</th>
                    <th>Last met</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const last = r.meetings[0];
                    const lastWon = last.winner === selected.id;
                    return (
                      <tr key={r.opponentId}>
                        <td>
                          <Link href={hrefOf(r.opponentId)}>
                            {nameOfMember.get(r.opponentId) ?? "A former member"}
                          </Link>
                        </td>
                        <td>
                          <strong>{recordVerdict(r)}</strong>
                          <div className="text-muted" style={{ fontSize: 13 }}>
                            {recordLine(r)}
                          </div>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {last.winner === null ? "Halved" : lastWon ? "Won" : "Lost"}
                          {last.margin && last.margin !== "AS" ? ` ${last.margin}` : ""}
                          <div className="text-muted" style={{ fontSize: 13 }}>
                            {[last.eventName, last.where].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
