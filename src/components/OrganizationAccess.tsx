"use client";
import { useId, useState } from "react";
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
import { MoreInfo } from "./MoreInfo";
import { useAction } from "./useAction";
import { roleName, orgRoleName } from "@/lib/roles";
import { describeOrgRoleChange } from "@/lib/access-roles";
import { RoleChangeConfirm } from "./AccessClient";
import { EMAIL_MAX, PERSON_NAME_MAX } from "@/lib/domain/typed-limits";

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
// The names come from `roles.ts`, where the invitation email reads them too.
const ORG_ROLE_OPTS = ["owner", "admin", "member", "guest"].map((v) => ({ v, l: orgRoleName(v) }));
export function OrganizationAccess({
  report,
  canEdit,
  asks,
  seats,
  organizer = "organizer",
}: {
  /** The club's word for who runs it — organizer or organiser (`golf-terms.ts`). */
  organizer?: string;
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
  const fid = useId();
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  /** The role each waiting person would be given, keyed by request. */
  const [grant, setGrant] = useState<Record<string, string>>({});
  const { pending, error, run } = useAction();
  // The role change waiting for a second, deliberate press: one at a time, as on a tournament's
  // access screen. Picking a role on another row moves the question there.
  const [confirm, setConfirm] = useState<{ memberId: string; next: string } | null>(null);

  /**
   * A REFUSAL IS SAID WHERE THE PRESS WAS.
   *
   * There are three places to press on this screen — somebody asking to be let
   * in, a row of the roster, and "Add staff" at the bottom — and one line at
   * the very top where every refusal was printed. Measured 2026-10-13 at laptop
   * size: "Enter a valid email address." under a press of Add staff was wholly
   * off the screen, so the button looked as though it had done nothing. The
   * same thing the course editor did, found the same morning.
   */
  const [pressed, setPressed] = useState("");
  const press = (where: string, fn: Parameters<typeof run>[0], after?: () => void) => {
    setPressed(where);
    run(fn, after);
  };
  const refusedAt = (where: string) =>
    error && pressed === where ? (
      <p role="alert" className="form-error" style={{ margin: "6px 0 0" }}>
        <Icon name="warning-circle" /> {error}
      </p>
    ) : null;

  const staff = report.people.filter((p) => p.orgRole);
  // The count the server guards on, so "the only Commissioner" reads the same in the warning as in the refusal.
  const ownerCount = staff.filter((p) => p.orgRole === "owner").length;
  const eventOnly = report.people.filter((p) => !p.orgRole);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Only a refusal that belongs to no press in particular. */}
      {error && !pressed && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
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
          <MoreInfo short="They see nothing of yours until you say so." style={{ margin: "-2px 0 4px" }}>
            They typed this {from}&rsquo;s name when setting up their own and were told it already
            exists. Nothing has changed yet.
          </MoreInfo>
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
                  <div className="text-muted" style={{ fontSize: 13 }}>
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
                      onClick={() => press(`ask:${ask.id}`, () => approveJoinRequest(ask.id, grant[ask.id] ?? "admin"))}
                    >
                      Add them
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => press(`ask:${ask.id}`, () => declineJoinRequest(ask.id))}
                    >
                      Decline
                    </button>
                  </div>
                )}
                {refusedAt(`ask:${ask.id}`)}
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
          <MoreInfo
            short={seats === 1 ? `1 person holds a staff seat` : `${seats} people hold a staff seat`}
            style={{ marginTop: 2 }}
          >
            A seat is organizer or assistant rights somewhere, which is what your plan counts. Members
            and guests are on this list without holding one.
          </MoreInfo>
          {/* The Commissioner line must keep saying BILLING. The word
              describes control, not money — unlike "Owner", which said it by
              implication — so if this sentence is ever shortened, the one
              thing that actually distinguishes this role from Admin
              disappears with it. Their powers are otherwise identical:
              `canAdministerOrg` is `owner || admin`. Behind the ⓘ it is
              still the whole sentence, word for word. */}
          <MoreInfo short="What each role means" style={{ margin: "0 0 4px" }}>
            {/* Two of these said something the app does not do (2026-10-10).
                A Commissioner CAN be removed or changed while there is
                another; only the last one is kept. And a Member is not shut
                out until given access: they can open every tournament this
                club runs, as a player — it is STAFF rights that are given
                event by event. */}
            <b>Commissioner</b> — runs this account and holds the billing. There is always at least
            one. <b>Admin</b> — organizer on every tournament this {from} runs, without being added to
            each one. <b>Member</b> — can open every tournament this {from} runs, as a player; staff
            rights only where given on an event.{" "}
            {/* The one role that grants LESS. A charity day and a league
                substitute are the same person to the app: in for one event,
                not a member — so they must not see what the club is running
                the rest of the year. Upgrade them to Member if they join. */}
            <b>Guest</b> — in for one event only: a charity entrant, a league substitute, a sponsor.
            They never see the club&rsquo;s other tournaments. Make them a Member if they join.
          </MoreInfo>
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
                        <span className="tag tag-neutral" style={{ marginLeft: 6, fontSize: 13 }}>
                          {/* Added by you and not back since: the name stays
                              theirs to show (2026-10-11). */}
                          {p.invited ? "Invited — not opened yet" : "invited"}
                        </span>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: 13 }}>{p.email}</td>
                    <td>
                      <div className="seg">
                        {ORG_ROLE_OPTS.map((o) => (
                          <label className="seg-opt" key={o.v}>
                            <input
                              type="radio"
                              name={`orgrole-${p.memberId}`}
                              checked={(confirm?.memberId === p.memberId ? confirm.next : p.orgRole) === o.v}
                              disabled={!canEdit || pending}
                              // Re-picking the role they hold just withdraws the question.
                              onChange={() => setConfirm(p.orgRole === o.v ? null : { memberId: p.memberId!, next: o.v })}
                            />
                            {o.l}
                          </label>
                        ))}
                      </div>
                      {/* ASKED, THEN DONE. This committed on the radio: one stray tap
                          made a member an organizer on every tournament the club
                          runs, or a co-organizer a guest, and the only sign was
                          the row redrawing. A tournament's access screen has
                          asked first since that was found there; this is the
                          same question, in the same words. */}
                      {confirm?.memberId === p.memberId &&
                        (() => {
                          const change = describeOrgRoleChange({ name: p.name || p.email, role: p.orgRole ?? "" }, confirm.next, ownerCount, orgRoleName, from);
                          return change ? (
                            <RoleChangeConfirm
                              change={change}
                              pending={pending}
                              onConfirm={() => press(`row:${p.memberId}`, () => setOrganizationMemberRole(p.memberId!, confirm.next), () => setConfirm(null))}
                              onCancel={() => setConfirm(null)}
                            />
                          ) : null;
                        })()}
                      {refusedAt(`row:${p.memberId}`)}
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
                        onConfirm={() => press(`row:${p.memberId}`, () => removeOrganizationMember(p.memberId!))}
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
          <MoreInfo short="Pro shop staff and co-organizers." style={{ marginTop: -4 }}>
            Players are added per tournament on Registration — they never take a staff seat.
          </MoreInfo>
          <div className="field">
            <label htmlFor={`${fid}-name`}>Name</label>
            <input id={`${fid}-name`} className="input" value={name} maxLength={PERSON_NAME_MAX} disabled={!canEdit || pending} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${fid}-email`}>Email</label>
            <input
              id={`${fid}-email`}
              className="input"
              type="email"
              maxLength={EMAIL_MAX}
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
              press(
                "add",
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
          {refusedAt("add")}
          {!canEdit && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Only a Commissioner or Admin can manage staff.
            </p>
          )}
        </div>
      </div>

      {/* ── Access report ─────────────────────────────────────────────── */}
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Who can access what</span>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {report.people.length} people · {report.events.length} tournaments
          </span>
        </div>
        <MoreInfo short="Including access a club role gives." style={{ margin: "-2px 0 6px" }}>
          Effective access, including roles inherited from an organization role. A
          <span className="tag tag-neutral" style={{ margin: "0 4px", fontSize: 13 }}>{from}</span>
          marker means the person was never added to that tournament directly.
        </MoreInfo>

        {report.events.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 13 }}>No tournaments yet.</span>
        ) : (
          // A region a KEYBOARD can scroll. This table is read-only — nothing in it takes focus — and it
          // is wider than its card whenever the club has several tournaments, so somebody without a
          // mouse could not reach the columns past the edge at all (found by the first accessibility
          // audit, 2026-10-13). A stop in the tab order with a name, and the arrow keys do the rest.
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Who is in which tournament — scroll sideways for more">
            <table className="table" style={{ fontSize: 13, minWidth: 520 }}>
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
                      {p.name && <div className="text-muted" style={{ fontSize: 13 }}>{p.email}</div>}
                    </td>
                    <td>
                      {p.orgRole ? (
                        <span className={`tag ${p.orgRole === "owner" ? "tag-accent" : "tag-neutral"}`}>
                          {orgRoleName(p.orgRole)}
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
                              {roleName(a.role, organizer)}
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
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
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
