"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { switchEvent, createEvent, cloneEvent, deleteEvent } from "@/app/actions/tournament";
import { templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";
import { startFromGroups, copiedEventId } from "@/lib/domain/start-from";
import { TOURNAMENT_SHAPES, type TournamentShape } from "@/lib/tournament-shape";
import { Icon } from "./Icon";
import { useOrgProfile } from "./OrgProfileProvider";

export interface EventRow {
  id: string;
  name: string;
  status: string;
  dates: string;
  course: string;
  players: number;
  isActive: boolean;
  hasAccess: boolean;
  /** Organizer on this event — the bar for copying and deleting it. */
  isOrganizer: boolean;
  /**
   * A casual round rather than a tournament — and temporary with it.
   *
   * This list is headed "Your tournaments" and counts what is in it, so a
   * Sunday fourball sat in it as one: same columns, same weight, nothing
   * saying it deletes itself in a day. A club with one championship and three
   * quick rounds was told it had four tournaments.
   *
   * It also appeared in "Start from" as something to copy a new tournament
   * OUT of, which is offering a round of golf as a template for a
   * competition.
   *
   * Optional so the two callers that do not know yet behave exactly as they
   * did — absent means "a tournament", which is what everything in this list
   * used to be.
   */
  isCasual?: boolean;
}

const STATUS: Record<string, { label: string; tag: string }> = {
  draft: { label: "Draft", tag: "tag-neutral" },
  registration: { label: "Registration", tag: "tag-accent" },
  ready: { label: "Ready", tag: "tag-accent" },
  live: { label: "Live", tag: "tag-accent-2" },
  completed: { label: "Completed", tag: "tag-neutral" },
};

export function EventSwitcher({
  events,
  organizations = [],
}: {
  events: EventRow[];
  /**
   * The organizations this person may create in — see
   * `organizationsForOrganizer`. Asked only when there is more than one.
   */
  organizations?: Array<{ id: string; name: string; kind: string }>;
}) {
  const consoleOutfit = useOrgProfile();
  const [name, setName] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  // Deliberately defaults to a blank tournament even though copying is listed
  // first: anyone who clicks Create without reading gets exactly what that
  // button has always done, and copying stays a decision they made on purpose.
  const [source, setSource] = useState(DEFAULT_TEMPLATE_KEY);
  /**
   * HOW IT IS PLAYED, WHICH THIS SCREEN NEVER ASKED.
   *
   * `createEvent(name, source)` was called with no shape at all, so every
   * tournament created from here became a series of rounds — the fallback in
   * `shapeOf` — and nothing on the screen said so. That is the path a
   * RETURNING organizer uses: `/choose` is for people who have none yet, and
   * this card is where everyone else creates anything.
   *
   * The consequence is not cosmetic. The shape decides whether standings carry
   * between rounds, whether there is a cut, and whether the bracket and
   * qualification screens exist at all — so a club medal built from here
   * arrived dressed as a league, with two screens it would never use.
   *
   * Empty, not preselected, for the same reason `/choose` no longer
   * preselects: a default answer to "how is it played" is the app deciding.
   */
  const [shape, setShape] = useState<TournamentShape | "">("");
  /**
   * Whose tournament this is, when there is a choice.
   *
   * Defaults to the first, which IS the one that would have been chosen
   * silently — so nothing changes for somebody who does not touch it.
   */
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Only tournaments this person organizes. A copy is created inside the source
  // tournament's organization, so anything less than organizer would let a
  // player create events in a club they merely play in — cloneEvent rejects it
  // regardless, but the list shouldn't offer what the action refuses.
  /**
   * A casual round is not a template for a tournament.
   *
   * `copyable` gated on being the organizer, which a quick round's creator
   * always is — so every Sunday fourball appeared in "Start from" as something
   * to build a club championship out of. A copy of one carries no field, no
   * rounds and no flights; what it carries is a two-player match's settings,
   * which is not a starting point anybody wants.
   */
  const copyable = events.filter((e) => e.isOrganizer && !e.isCasual);

  /**
   * The two lists this screen was showing as one.
   *
   * Split rather than filtered, because a quick round still has to be
   * reachable from here — it is where you go to switch back to the round you
   * set up an hour ago. What it must not do is be counted, headed and columned
   * as a tournament.
   */
  const tournaments = events.filter((e) => !e.isCasual);
  const casual = events.filter((e) => e.isCasual);
  const copyFrom = copyable.find((e) => e.id === copiedEventId(source));
  /**
   * WHOSE GOLF THE LIST SHOULD LEAD WITH — see `startFromGroups`.
   *
   * The SELECTED organization first, because somebody who runs a club and a
   * society is creating this one for exactly one of them, and the list should
   * follow the answer they just gave rather than the console they happen to
   * be standing in. Falls back to that console’s own outfit, which is the
   * only answer there is when they run one.
   */
  const listFor = organizations.find((o) => o.id === organizationId)?.kind ?? consoleOutfit.kind;
  const blurb = copyFrom
    ? `Copies the settings, rounds and courses from ${copyFrom.name || "that tournament"} — never its players, scores or access codes. Dates start empty and everything stays editable.`
    : templateFor(source).blurb + " Every setting stays editable afterwards.";

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <span className="card-title" style={{ fontSize: 15 }}>Your tournaments</span>
        {/* Counts TOURNAMENTS. It counted `events.length`, so a club with one
            championship and three Sunday fourballs was told it had four
            tournaments — under a heading that says exactly what it means. */}
        <span className="text-muted" style={{ fontSize: 12 }}>{tournaments.length} total</span>
      </div>

      <div className="table-scroll">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Status</th>
              <th>Course</th>
              <th style={{ textAlign: "right" }}>Players</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {tournaments.map((e) => {
              const s = STATUS[e.status] ?? STATUS.draft;
              return (
                <tr key={e.id} style={e.isActive ? { background: "var(--color-accent-900)" } : undefined}>
                  <td style={{ fontWeight: 500 }}>
                    {e.name || "Untitled"}
                    <div className="text-muted" style={{ fontSize: 11 }}>{e.dates || "No dates set"}</div>
                  </td>
                  <td><span className={`tag ${s.tag}`}>{s.label}</span></td>
                  <td className="text-muted">{e.course || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.players}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                      {confirmingId === e.id ? (
                        <>
                          <span className="text-muted" style={{ fontSize: 12 }}>Delete?</span>
                          {/* NAMED. Every control in this table acted on a
                              row and said only what it did — twelve identical
                              "Delete tournament" buttons to anyone reading by
                              name, and a "Confirm delete" that destroys a
                              tournament without saying which. */}
                          <button type="button" className="btn btn-icon" title={`Delete ${e.name || "this tournament"} for good`} aria-label={`Delete ${e.name || "this tournament"} for good`} disabled={pending} style={{ color: "var(--color-accent)" }} onClick={() => startTransition(() => deleteEvent(e.id))}>
                            <Icon name="check" />
                          </button>
                          <button type="button" className="btn btn-icon" title={`Keep ${e.name || "this tournament"}`} aria-label={`Keep ${e.name || "this tournament"}`} onClick={() => setConfirmingId("")}>
                            <Icon name="x" />
                          </button>
                        </>
                      ) : (
                        <>
                          {e.isActive ? (
                            <span className="tag tag-outline">Managing</span>
                          ) : e.hasAccess ? (
                            <button type="button" className="btn btn-secondary" aria-label={`Manage ${e.name || "this tournament"}`} disabled={pending} onClick={() => startTransition(() => switchEvent(e.id))}>
                              Manage
                            </button>
                          ) : (
                            <span className="text-muted" style={{ fontSize: 12 }}>No access</span>
                          )}
                          {e.isOrganizer && (
                            <button type="button" className="btn btn-icon" title={`Delete ${e.name || "this tournament"}`} aria-label={`Delete ${e.name || "this tournament"}`} disabled={pending} onClick={() => setConfirmingId(e.id)}>
                              <Icon name="trash" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* THE QUICK ROUNDS, on their own and saying what they are.

          They were in the table above: same columns, same weight, counted in
          the same total, and nothing anywhere saying they delete themselves
          after a day. Somebody with a championship and three Sunday fourballs
          read "4 tournaments" and had no way to tell which was which.

          Still listed, because this is where you come to switch back to the
          round you set up an hour ago. Just not listed as a tournament. */}
      {casual.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="card-kicker">Quick rounds</span>
            <span className="text-muted" style={{ fontSize: 11.5 }}>
              Temporary — deleted about a day after they&rsquo;re set up
            </span>
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {casual.map((e) => (
              <div
                key={e.id}
                className="mini-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: e.isActive ? "var(--color-accent-900)" : "transparent",
                }}
              >
                <Icon name="clock" style={{ flex: "none" }} />
                <span style={{ fontWeight: 500, minWidth: 0 }}>{e.name || "Untitled round"}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {e.players} player{e.players === 1 ? "" : "s"}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                  {e.isActive ? (
                    <span className="tag tag-outline">Open</span>
                  ) : e.hasAccess ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label={`Open ${e.name || "this round"}`}
                      disabled={pending}
                      onClick={() => startTransition(() => switchEvent(e.id))}
                    >
                      Open
                    </button>
                  ) : (
                    <span className="text-muted" style={{ fontSize: 12 }}>No access</span>
                  )}
                  {e.isOrganizer && (
                    <button
                      type="button"
                      className="btn btn-icon"
                      title={`Delete ${e.name || "this round"}`}
                      aria-label={`Delete ${e.name || "this round"}`}
                      disabled={pending}
                      onClick={() => setConfirmingId(e.id)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
                {/* The same confirm the table above uses, because deleting a
                    round somebody is mid-way through is just as permanent. */}
                {confirmingId === e.id && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
                    <span className="text-muted" style={{ fontSize: 12 }}>Delete this round?</span>
                    <button
                      type="button"
                      className="btn btn-icon"
                      title={`Delete ${e.name || "this round"} for good`}
                      aria-label={`Delete ${e.name || "this round"} for good`}
                      disabled={pending}
                      style={{ color: "var(--color-accent)" }}
                      onClick={() => startTransition(() => deleteEvent(e.id))}
                    >
                      <Icon name="check" />
                    </button>
                    <button type="button" className="btn btn-icon" title="Cancel" onClick={() => setConfirmingId("")}>
                      <Icon name="x" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--color-divider)", paddingTop: 12, marginTop: 4 }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label>Create a new tournament</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Club Championship 2026" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label>Start from</label>
          {/* ONE SOURCE, SHARED WITH THE PICKER'S FORM — see `startFromGroups`.
              This built its own list and `CreateFirstTournament` built another,
              and the two had drifted into different answers to the same
              question: this one offered a copy and no suggestions, that one
              offered suggestions and no copy. */}
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            {startFromGroups({ copyable, shape, orgKind: listFor }).map((group) => {
              const options = group.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ));
              return group.label === "" ? options : (
                <optgroup key={group.label} label={group.label}>{options}</optgroup>
              );
            })}
          </select>
        </div>
        {/* WHOSE, when this person runs more than one outfit.

            A copy keeps its source's organization, so the question only
            applies to a tournament being created fresh — the same reason the
            shape is not asked there. */}
        {!copyFrom && organizations.length > 1 && (
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Who is this for?</label>
            <select
              className="input"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        {/* Not asked when COPYING: a copy is played the way its source was,
            and offering the question there would let the two disagree. */}
        {!copyFrom && (
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>How is it played?</label>
            <select
              className="input"
              value={shape}
              onChange={(e) => setShape(e.target.value as TournamentShape | "")}
            >
              <option value="">Choose…</option>
              {TOURNAMENT_SHAPES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !name.trim() || (!copyFrom && !shape)}
          onClick={() => {
            const copyId = copiedEventId(source);
            setError("");
            startTransition(async () => {
              const res = copyId
                ? await cloneEvent(copyId, name)
                : await createEvent(name, source, shape, undefined, organizationId || undefined);
              if (res && !res.ok) setError(res.error ?? "Could not create the tournament.");
            });
            setName("");
          }}
        >
          <Icon name="plus" /> Create tournament
        </button>
      </div>
      {/* Why the button is dead, naming the step that is actually outstanding.
          Create used to be enabled with an empty name and silently made
          "New Tournament"; now it says what it wants. */}
      {!pending && (!name.trim() || (!copyFrom && !shape)) && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {!name.trim()
            ? "Name it first."
            : "Say how it's played — that decides what the rest of setup asks."}
        </p>
      )}
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{blurb}</p>
      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}

      {/* THE OTHER THING SOMEBODY COMES HERE TO MAKE, and until now the only
          screen offering it was one they could no longer reach.

          `/match/new` is "two people, one round, one screen", and it was
          linked from exactly one place: `/choose`. But `page.tsx` sends anyone
          with an active event straight to their landing screen, so once the
          first tournament exists that door only reopens through the ORG
          onboarding checklist — which disappears at 3 of 3. This screen is
          where a returning organizer goes to create anything, and every one of
          its six templates is a tournament.

          The cost of the gap is on the record: two abandoned draft events in
          the development database, five minutes apart, both with zero players
          and both with their round left on the default Round Robin. Somebody
          wanting one match against one person built a tournament twice and
          gave up. The option they wanted already existed.

          A LINK, not another form. The same argument as on /choose: what the
          match screen asks — two names, holes, whether shots are given —
          belongs together on one page, and half of it inline here would split
          the decision across two places again. */}
      <Link
        href="/match/new"
        className="card elev-sm"
        style={{
          marginTop: 4,
          display: "flex",
          // `.card` is `display: flex; flex-direction: column`, so setting
          // `display: flex` inline changes nothing and the row comes out as a
          // centred stack. Both cards on /choose had exactly this.
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          textDecoration: "none",
          color: "var(--color-text)",
          border: "1px solid var(--color-divider)",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 9,
            background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)",
          }}
        >
          <Icon name="sword" style={{ color: "var(--color-accent-2)", fontSize: 16 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>
            Just playing a round?
          </div>
          {/* Said "two players, one round, hole by hole", which described the
              screen exactly until it learned about medals and fourballs. A
              door that undersells what is behind it is not a small error: it
              is read INSTEAD of the screen by everybody who decides here. */}
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
            A match, a medal or a fourball. Up to eight players, one round, no tournament
            needed.
          </div>
        </div>
        <Icon
          name="arrow-right"
          style={{ color: "var(--color-accent-300)", marginLeft: "auto", flex: "none" }}
        />
      </Link>
    </div>
  );
}
