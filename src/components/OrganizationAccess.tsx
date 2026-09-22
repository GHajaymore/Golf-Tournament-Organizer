"use client";
import { useState } from "react";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import {
  addOrganizationMember,
  setOrganizationMemberRole,
  removeOrganizationMember,
} from "@/app/actions/organization";
import { approveJoinRequest, declineJoinRequest } from "@/app/actions/join";
import type { AccessReport } from "@/lib/services/access";
import type { PendingAsk } from "@/lib/services/join-requests";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { useAction } from "./useAction";

/**
 * "Commissioner", not "Owner". Ajay's call, 2026-08-21 — a considered choice,
 * so do not quietly "correct" it back.
 *
 * The stored value stays `owner`, deliberately. It is read by sixteen places in
 * the access layer — `canAdministerOrg`, the seat count in `limits.ts`,
 * `org-access.ts`, the org-owner backfill — and every one of them is an
 * authorization decision. Renaming a string that gates authorization, to change
 * a word no user can see, is risk bought for nothing. What people read is this
 * map, and this map is the whole of it.
 *
 * Why not "Owner" or "Account holder": at a club the person in this seat is
 * usually the PROFESSIONAL or the competition secretary — an employee. The club
 * holds the account; they only run it. Any word asserting ownership is
 * therefore false for the most professional audience, while being exactly right
 * for a society. "Commissioner" describes CONTROL rather than property, which
 * is true for the pro, the society captain and one person running an outing
 * alike.
 *
 * The known cost, accepted: a golf club has a Captain, a Secretary and a
 * President, and no Commissioner — so it reads as borrowed at a club, and it
 * does not by itself say "billing". The sentence below carries the billing
 * meaning explicitly for that reason, and it must keep doing so.
 *
 * Rejected: "Captain", which is the right word in the real world and cannot be
 * had — `captainId` already means a FLIGHT's captain, and one word with two
 * meanings is the defect this codebase keeps unwinding. "Head" reads as Head
 * Professional. "Organizer" is taken by the per-event role below.
 */
const ORG_ROLE_OPTS = [
  { v: "owner", l: "Commissioner" },
  { v: "admin", l: "Admin" },
  { v: "member", l: "Member" },
  { v: "guest", l: "Guest" },
];

const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "Commissioner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};
const EVENT_ROLE_LABEL: Record<string, string> = { admin: "Organizer", assistant: "Assistant", player: "Player" };

export function OrganizationAccess({
  report,
  canEdit,
  asks,
  seats,
}: {
  report: AccessReport;
  canEdit: boolean;
  /** People waiting to be let in. Empty for almost every club, almost always. */
  asks: PendingAsk[];
  /**
   * How many people hold a STAFF SEAT — the number the plan allowance counts,
   * and the number the stat card at the top of this page prints.
   *
   * PASSED IN, not derived here, and that is the point. This table and that
   * card both used the word "staff" for two different sets, and on real rows
   * they disagreed in BOTH directions (measured 2026-09-21): the seeded club
   * read 1 against 2, because the roster holds a `member` who has no organizer
   * rights at all; the demo club read 3 against 1, because two people hold
   * admin on individual events and have no organization row. Neither set
   * contains the other, so the comment on that card claiming it was the
   * broader one was wrong.
   *
   * `staffSeatCount` is the single definition — organizer or assistant rights
   * anywhere in the outfit, deduplicated by email — and it is the one with
   * money attached, since it is what refuses the next person added. Computing
   * a second opinion from `report` here is exactly how the two came to
   * disagree, so this takes the authoritative number rather than recomputing
   * one that would agree only by luck.
   */
  seats: number;
}) {
  /** "club" / "society" / "outing" — the thing a role can be inherited FROM. */
  // The RESOLVED profile from the console context, not `orgProfile(orgKind)`:
  // the kind alone cannot know what this outfit CALLS itself, so a US league
  // read "society" here. The provider carries kind, country and the override
  // together and every screen in the console is inside it.
  const from = useOrgProfile().noun;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  /** The role each waiting person would be given, keyed by request. */
  const [grant, setGrant] = useState<Record<string, string>>({});
  const { pending, error, run } = useAction();

  const staff = report.people.filter((p) => p.orgRole);
  const eventOnly = report.people.filter((p) => !p.orgRole);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {/* ── Somebody asking to be let in ──────────────────────────────────
          ABOVE THE STAFF LIST, because it is the only thing on this screen
          with a person waiting on the other end of it. The same-name warning
          tells the second secretary of a league "ask them to add you"; this is
          where that ask arrives.

          Only shown when there is one — an empty "no requests" panel on every
          club's screen forever is noise, and this feature is rare by design. */}
      {asks.length > 0 && (
        <div className="card elev-sm" style={{ boxShadow: "inset 0 0 0 1px var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 15 }}>
            Asked to join ({asks.length})
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 4px" }}>
            They typed this {from}&rsquo;s name when setting up their own and were told it already
            exists. Nothing has changed yet — they see nothing of yours until you say so.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {asks.map((ask) => (
              <div
                key={ask.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: 8,
                  borderTop: "1px solid var(--color-divider)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{ask.name}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {ask.email}
                    {ask.note ? ` — “${ask.note}”` : ""}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {/* ADMIN FIRST, and it is the default the button grants.
                        Whoever sends one of these is the league's other
                        organizer, not a spectator: let them in as a Member and
                        they can see the calendar and run nothing, so they go
                        back and build their own outfit anyway — which is the
                        split this whole feature exists to stop. */}
                    <select
                      className="input"
                      style={{ width: "auto", fontSize: 13 }}
                      value={grant[ask.id] ?? "admin"}
                      onChange={(e) => setGrant({ ...grant, [ask.id]: e.target.value })}
                      aria-label={`Role for ${ask.name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="guest">Guest</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending}
                      onClick={() => run(() => approveJoinRequest(ask.id, grant[ask.id] ?? "admin"))}
                    >
                      Add them
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => run(() => declineJoinRequest(ask.id))}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Staff ─────────────────────────────────────────────────────── */}
      <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm">
          {/* The outfit's own word, capitalised for a heading — "Organization
              staff" over a page headed "Club settings" is the same mismatch
              Ajay pointed at in the intro sentence, one card down.

              And ROSTER rather than "staff", because this table lists everyone
              holding a role at the outfit and two of the four roles — Member
              and Guest — confer no organizer rights whatever. Calling that
              count "staff" is what put a 2 here under a stat card reading 1,
              on the same screen, with no way to tell which was wrong. */}
          <span className="card-title" style={{ fontSize: 15 }}>
            {from.charAt(0).toUpperCase() + from.slice(1)} roster ({staff.length})
          </span>
          {/* The reconciliation, said rather than left for the reader to
              notice. The two numbers are both correct and count different
              things; what was missing was any sentence admitting it. */}
          <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
            {seats === 1
              ? `1 person holds a staff seat`
              : `${seats} people hold a staff seat`}{" "}
            — organizer or assistant rights somewhere, which is what your plan counts. Members and
            guests are on this list without holding one.
          </p>
          <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 4px" }}>
            {/* The Commissioner line must keep saying BILLING. The word
                describes control, not money — unlike "Owner", which said it by
                implication — so if this sentence is ever shortened, the one
                thing that actually distinguishes this role from Admin
                disappears with it. Their powers are otherwise identical:
                `canAdministerOrg` is `owner || admin`. */}
            <b>Commissioner</b> — runs this account, holds the billing, and cannot be removed.{" "}
            <b>Admin</b> — organizer on every tournament this {from} runs, without being added to
            each one. <b>Member</b> — staff pool; access only where explicitly given on an event.{" "}
            {/* The one role that grants LESS. A charity day and a league
                substitute are the same person to the app: in for one event,
                not a member — so they must not see what the club is running
                the rest of the year. Upgrade them to Member if they join. */}
            <b>Guest</b> — in for one event only: a charity entrant, a league substitute, a sponsor.
            They never see the club&rsquo;s other tournaments. Make them a Member if they join.
          </p>
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th style={{ width: 210 }}>Organization role</th>
                  <th style={{ width: 90 }}>Tournaments</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {staff.map((p) => (
                  <tr key={p.email}>
                    <td style={{ fontWeight: 500 }}>
                      {p.name || "—"}
                      {/* No tooltip on the tag: "invited" is the state —
                          asked, not yet signed in. The title said the same
                          thing in more words, to a mouse only. */}
                      {!p.hasLogin && (
                        <span className="tag tag-neutral" style={{ marginLeft: 6, fontSize: 10 }}>
                          invited
                        </span>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{p.email}</td>
                    <td>
                      <div className="seg">
                        {ORG_ROLE_OPTS.map((o) => (
                          <label className="seg-opt" key={o.v}>
                            <input
                              type="radio"
                              name={`orgrole-${p.memberId}`}
                              checked={p.orgRole === o.v}
                              disabled={!canEdit || pending}
                              onChange={() => run(() => setOrganizationMemberRole(p.memberId!, o.v))}
                            />
                            {o.l}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {Object.keys(p.access).length}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {/* Revoking a colleague's access to every event the club
                          runs, from an unlabelled × in a table row. */}
                      <ConfirmButton
                        icon="x"
                        title="Remove from organization"
                        confirmLabel="Remove them"
                        disabled={!canEdit || pending}
                        onConfirm={() => run(() => removeOrganizationMember(p.memberId!))}
                      />
                    </td>
                  </tr>
                ))}
                {staff.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted" style={{ padding: "10px 6px" }}>
                      No staff yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Add staff</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-4px 0 0" }}>
            Pro shop staff and co-organizers. Players are added per tournament on Registration — they never
            take a staff seat.
          </p>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} disabled={!canEdit || pending} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              disabled={!canEdit || pending}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@club.com"
            />
          </div>
          <div className="field">
            <label>Role</label>
            <div className="seg">
              {ORG_ROLE_OPTS.map((o) => (
                <label className="seg-opt" key={o.v}>
                  <input
                    type="radio"
                    name="neworgrole"
                    checked={role === o.v}
                    disabled={!canEdit || pending}
                    onChange={() => setRole(o.v)}
                  />
                  {o.l}
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!canEdit || pending || !email.trim()}
            onClick={() =>
              run(
                () => addOrganizationMember(email, name, role),
                () => {
                  setEmail("");
                  setName("");
                  setRole("member");
                },
              )
            }
          >
            <Icon name="plus" /> Add staff
          </button>
          {!canEdit && (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Only an owner or admin can manage staff.
            </p>
          )}
        </div>
      </div>

      {/* ── Access report ─────────────────────────────────────────────── */}
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Who can access what</span>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {report.people.length} people · {report.events.length} tournaments
          </span>
        </div>
        <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 6px" }}>
          Effective access, including roles inherited from an organization role. A
          <span className="tag tag-neutral" style={{ margin: "0 4px", fontSize: 10 }}>{from}</span>
          marker means the person was never added to that tournament directly.
        </p>

        {report.events.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 13 }}>No tournaments yet.</span>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 12, minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 170 }}>Person</th>
                  <th style={{ width: 90 }}>Org role</th>
                  {report.events.map((e) => (
                    <th key={e.id} style={{ textAlign: "center", minWidth: 110 }}>
                      {e.name || "Untitled"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.people.map((p) => (
                  <tr key={p.email}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.name || p.email}</div>
                      {p.name && <div className="text-muted" style={{ fontSize: 11 }}>{p.email}</div>}
                    </td>
                    <td>
                      {p.orgRole ? (
                        <span className={`tag ${p.orgRole === "owner" ? "tag-accent" : "tag-neutral"}`}>
                          {ORG_ROLE_LABEL[p.orgRole] ?? p.orgRole}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {report.events.map((e) => {
                      const a = p.access[e.id];
                      return (
                        <td key={e.id} style={{ textAlign: "center" }}>
                          {a ? (
                            <span
                              className={`tag ${a.role === "admin" ? "tag-accent" : "tag-neutral"}`}
                              title={a.source === "organization" ? "Inherited from organization role" : "Granted on this tournament"}
                            >
                              {EVENT_ROLE_LABEL[a.role] ?? a.role}
                              {a.source === "organization" ? ` · ${from}` : ""}
                            </span>
                          ) : (
                            <span className="text-muted">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {eventOnly.length > 0 && (
          <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            {/* NOT "are not staff". The demo club has two people here holding
                ADMIN on individual events — they consume a staff seat and do
                not appear in the roster above, which is the other direction of
                the same confusion. What is true of all of them is that they
                have no role at the {from} itself. */}
            {eventOnly.length} more have access through individual tournaments only, without a role
            at the {from} — mostly players.
          </p>
        )}
      </div>
    </div>
  );
}
