"use client";
import { useState, useTransition } from "react";
import { createEvent, cloneEvent } from "@/app/actions/tournament";
import { templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";
import { TOURNAMENT_SHAPES, type TournamentShape } from "@/lib/tournament-shape";
import { retentionNotice, planFor } from "@/lib/plans";
import { Icon } from "./Icon";
import { orgProfile } from "@/lib/domain/org-profile";
import { startFromGroups, copiedEventId, type CopyableEvent } from "@/lib/domain/start-from";

/**
 * Create-a-tournament step on the picker screen. Shown prominently when
 * someone has none yet (straight after sign-up), and as a secondary action
 * once they do.
 */
export function CreateFirstTournament({
  first,
  plan = "free",
  organizationNamed = false,
  clubSteps = [],
  orgKind = "",
  copyable = [],
  organizations = [],
}: {
  first: boolean;
  /**
   * The plan to warn about when this person has NO organization yet — which
   * is the only case this is read in, and "free" is then right, because the
   * organization about to be created starts on it.
   *
   * Where organizations DO exist, the warning follows the one selected below;
   * see `retention`. This prop was the only source, was never passed by its
   * one caller, and therefore told every club in the product that its
   * finished tournaments might not be kept.
   */
  plan?: string;
  /**
   * Whether the organization has a name its organizer chose.
   *
   * Every organization has a name from birth — sign-up derives one from the
   * person — so this is `organizationWasNamed`, not `!!name`. It decides
   * whether the "Who's running this?" field below is a real question or a
   * dead one; see the field.
   */
  organizationNamed?: boolean;
  /**
   * The club answers the first tournament is still waiting on.
   *
   * From `orgSetupState().outstanding` — the required steps of the club's own
   * setup, before its first tournament exists. Empty for an existing club (one
   * tournament proves the questions are answered), empty for a one-off outing
   * with friends (no shared roster, so no members step, and their name is
   * their own), and empty once the club has worked through them.
   *
   * TWO KINDS OF STEP, and the difference is the whole design of this form.
   * `profile` — naming the club — is answerable HERE, because `orgName` below
   * is passed to `createEvent` and names the organization on the way through;
   * so it becomes a required field rather than a redirect, and nobody is sent
   * away to do a thing they could do in the same breath. Everything else has
   * its own screen and is offered as a link.
   */
  clubSteps?: Array<{ key: string; title: string; href: string }>;
  /**
   * What kind of outfit this organizer runs — club, community or personal.
   *
   * Every word on this screen that names the outfit reads it through
   * `orgProfile`, so a society is called a society and a solo organizer is
   * never shown a screen about a club they do not have. Empty resolves to
   * `personal`, which is both the schema default and the kind a lazily created
   * organization gets — so somebody who has no organization yet is described
   * exactly as they will be a moment later.
   */
  orgKind?: string;
  /**
   * This organizer's own tournaments, NEWEST FIRST, that they may copy.
   *
   * THE BEST STARTING POINT A CLUB HAS IS ONE OF ITS OWN. Last year's
   * championship carries this club's rounds, formats, courses and settings,
   * decided by somebody who knows the golf — which no template can. The
   * dashboard's form has offered this for a long time and this one never did,
   * so an organizer creating their second tournament from the picker got
   * eleven generic templates and no sight of the event they were plainly
   * repeating.
   *
   * Empty on a genuinely first tournament, which is the case this component
   * was built for — so nothing changes there.
   */
  copyable?: CopyableEvent[];
  /**
   * The organizations this person may create in — see
   * `organizationsForOrganizer`.
   *
   * Asked ONLY when there is more than one. Somebody who runs a single club is
   * not made to answer a question with one answer, which is the common case
   * and where an extra field would be pure friction. Somebody who runs a club
   * AND a society was never asked at all, and always got the club.
   */
  organizations?: Array<{ id: string; name: string; kind: string; plan: string }>;
}) {
  /** Every word on this screen that names the outfit comes from here. */
  const outfit = orgProfile(orgKind);
  /**
   * Naming the club is answerable on this form; everything else is not.
   *
   * Split here rather than by the caller so the component that OWNS the name
   * field is the one deciding it can satisfy that step — a caller deciding it
   * would be a second place that has to know this form has an org-name box.
   */
  const clubNameRequired = clubSteps.some((s) => s.key === "profile");
  const elsewhere = clubSteps.filter((s) => s.key !== "profile");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [open, setOpen] = useState(first);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE_KEY);
  // Nothing preselected. See the field below.
  const [shape, setShape] = useState<TournamentShape | "">("");
  /**
   * Which organization this belongs to.
   *
   * Defaults to the first, which IS the one that would have been chosen
   * silently — `organizationsForOrganizer` returns them in the same order
   * `organizationForNewEvent` picks by. So the field changes nothing for
   * somebody who does not touch it, and gives everybody else the choice they
   * never had.
   */
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  /**
   * The tournament being copied, when "Start from" names one.
   *
   * Derived from the select's own value rather than held in a second piece of
   * state: one control, one answer, and `copiedEventId` is what tells a
   * template key from an event id. Declared here because it reads `template`.
   */
  const copyFrom = copyable.find((e) => e.id === copiedEventId(template));

  /**
   * THE PLAN OF THE ORGANIZATION THIS IS ACTUALLY FOR.
   *
   * The retention warning below is a red box telling somebody their finished
   * tournament may not be kept. It read a `plan` prop that the one caller —
   * `/choose` — never passed, so it defaulted to "free" and said that to every
   * organizer in the product, paying or not.
   *
   * Read from the SELECTED organization rather than a single value, so
   * somebody who runs a paid club and a free society is told the truth about
   * whichever one they pick. Falling back to the prop covers the case where
   * there is no organization yet, where "free" is correct: the one about to be
   * created starts there.
   */
  const activePlan = organizations.find((o) => o.id === organizationId)?.plan ?? plan;
  const retention = retentionNotice(activePlan);
  const planName = planFor(activePlan).name;

  const submit = () => {
    // A COPY NEEDS NO SHAPE. It is played the way its source was, and asking
    // would let the two disagree — the same rule `EventSwitcher` states.
    if (!name.trim() || (!copyFrom && !shape)) return;
    startTransition(async () => {
      if (copyFrom) await cloneEvent(copyFrom.id, name);
      else await createEvent(name, template, shape, orgName, organizationId || undefined);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary"
        style={{ alignSelf: "flex-start", marginTop: 18 }}
      >
        <Icon name="plus" /> Create another tournament
      </button>
    );
  }

  return (
    <div className="card elev-sm" style={{ gap: 12, marginTop: first ? 0 : 18 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          {first ? "Organizing an event?" : "Create a tournament"}
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Just a name to start — dates, course, format and field all come next, and can be changed any time.
        </p>
      </div>
      <div className="field">
        <label>Tournament name</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Club Championship 2026"
          autoFocus
        />
      </div>
      {/* WHOSE TOURNAMENT THIS IS, asked only when there is a choice.

          An organizer who runs one club is not made to answer a question with
          one answer. One who runs a club and a society was never asked at all
          and always got the club — kinds sort alphabetically, so "club" beat
          "community" every time, and the event took the club's roster, its
          settings, its plan allowance and its honours board with it. */}
      {organizations.length > 1 && (
        <div className="field">
          <label htmlFor="new-org">Who is this for?</label>
          <select
            id="new-org"
            className="input"
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            Its members, its settings and its season. A tournament cannot be moved afterwards.
          </p>
        </div>
      )}

      {/* Asked before anything else, because it decides what the rest of setup
          is even about: a single round has no next round to carry into, and a
          knockout has a bracket where a league has none.

          AND NOTHING IS PRESELECTED. This opened with "A series of rounds"
          highlighted — the middle option, chosen by a constant — so somebody
          typing a name and pressing Create made a league without ever reading
          the three. It is the same fault as the defaulted Round Robin one
          screen along, in the one place the app has a person to ask. Create
          stays disabled until this is answered.

          NOT ASKED WHEN COPYING. A copy is played the way its source was, so
          offering the question would let the two disagree — and answering it
          would do nothing, which is worse. The same rule the dashboard's form
          already states. */}
      {!copyFrom && (
      <div className="field">
        <label>How is it played?</label>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {TOURNAMENT_SHAPES.map((s) => {
            const active = s.key === shape;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setShape(s.key)}
                /* Which one is chosen, said in something other than a colour.
                   These three decide what the whole of setup then asks, and
                   the answer was carried by a background tint and a border and
                   nothing else — so read aloud, this is three identical
                   buttons and no way to tell which is selected. Create stays
                   disabled until one is, which makes an unannounced answer
                   worse rather than harmless: the button says no and the form
                   does not say why. */
                aria-pressed={active}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: active
                    ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
                    : "var(--color-bg)",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>
                  {s.blurb}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/**
       * "START FROM", NOT "WHAT KIND OF TOURNAMENT?".
       *
       * The old label asked the newcomer to classify their event against a
       * list of six — and a list that short cannot be a classification of
       * golf. Somebody whose event was not on it had every reason to conclude
       * the app does not run it. The organizer's own switcher, on `/event`,
       * has always said "Start from" and meant it; the screen shown to the
       * person least able to tell the difference was the one making the
       * stronger claim.
       *
       * Grouped by how many play a side, from `templateGroup`, so eleven
       * starting points read as three short lists instead of one long one —
       * and so the group a template belongs to is derived from the format it
       * starts rather than kept in a second list beside it.
       */}
      <div className="field">
        <label>Start from</label>
        {/* ONE SOURCE, SHARED WITH THE DASHBOARD'S FORM. This built its own
            list and `EventSwitcher` built another, and the two had drifted
            into different answers to the same question: that one offered a
            copy of an existing tournament and no suggestions, this one offered
            suggestions and no copy — and listed seven of its eleven entries
            TWICE, once under "Suits a single round" and again under its side
            size. Seventeen options for eleven starting points.

            `startFromGroups` is now the only place that decides, so they
            cannot diverge again. */}
        <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
          {startFromGroups({ copyable, shape, orgKind }).map((group) => {
            const options = group.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ));
            // A group with no label renders its options bare — "set it up
            // yourself" is not a kind of golf, and putting it under a heading
            // would say it was.
            return group.label === "" ? options : (
              <optgroup key={group.label} label={group.label}>{options}</optgroup>
            );
          })}
        </select>
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {copyFrom
            ? `Copies the settings, rounds and courses from ${copyFrom.name.trim() || "that tournament"} — never its players, scores or access codes. Dates start empty and everything stays editable.`
            : `${templateFor(template).blurb} A starting point only — every setting, format and round stays editable afterwards.`}
        </p>
      </div>
      {/* Names the organization created for this organizer's first tournament,
          so a club's events read under the club rather than under a person.
          Only shown on the first tournament — once an organization exists it is
          never renamed, so the field would do nothing on later events.

          AND ONLY WHILE THE ORGANIZATION IS STILL UNNAMED, which "the first
          tournament" is not the same question as. `orgName` never renames an
          existing organization — `organizationForNewEvent` says so — so for
          anybody who named their society before creating anything, this was a
          box that did nothing, above a sentence that was false: it promised
          "leave blank to run it under your own name", and the event went under
          the society either way.

          That is not a rare path. The setup checklist on this very screen puts
          "Name your society" FIRST and "Create your first tournament" LAST, so
          working through it in the order offered lands here every time. Walked
          on 2026-09-10 as a new society secretary, which is how it was found. */}
      {(first || clubNameRequired) && !organizationNamed && (
        <div className="field">
          {/* REQUIRED once the club-first gate applies, and optional otherwise.
              A club is set up once and its tournaments are many, so naming it
              comes before the first one — but the name is collected HERE
              rather than by sending somebody to Club settings and back,
              because typing it satisfies the rule outright: the organization
              is named on the way through creation. */}
          <label>
            Who&rsquo;s running this?{" "}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              {clubNameRequired ? "— your club or society, set once for every tournament" : "— club, society or company (optional)"}
            </span>
          </label>
          <input
            className="input"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. Cedar Dunes Golf Club"
          />
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            {/* TWO READERS OF ONE RULE, AND THEY MUST NOT DISAGREE. The label
                above now says "set once for every tournament" when the gate
                applies, and this line went on saying "Leave blank" underneath
                it — the same eyeful telling somebody the field is required and
                optional at once, which is this codebase's most-repeated
                defect. Both read `clubNameRequired`.

                The screen is NAMED from the kind rather than hard-coded. It
                used to say "the organization's own settings" because on a
                first tournament the organization may not exist yet and is
                created as `personal`, whose screen is "Outing settings" and
                not a club's — `settingsLabel` was written for exactly that
                case. `orgProfile("")` still answers `personal`, so the
                fallback is the old wording's meaning, said in the app's own
                words. */}
            {clubNameRequired
              ? `It goes on every scorecard, the console header and the public leaderboard. Change it later on ${outfit.settingsLabel}.`
              : `Leave blank to run it under your own name. You can set this later on ${outfit.settingsLabel}.`}
          </p>
        </div>
      )}
      {/* Said before the tournament exists, not after it finishes. A club that
          loses its member-guest results the next morning was not warned
          enough, and burying this in a settings screen would be the same as
          not saying it. */}
      {retention && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--color-danger-bg)",
            border: "1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)",
          }}
        >
          <Icon name="warning-circle" style={{ color: "var(--color-danger)", fontSize: 15, marginTop: 1 }} />
          <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            <b>On the {planName} plan:</b> {retention}
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            pending ||
            !name.trim() ||
            /* A copy needs no shape: it is played the way its source was. */
            (!copyFrom && !shape) ||
            (clubNameRequired && !orgName.trim()) ||
            /* Steps with their own screen — the member list, today. Not
               answerable here, so the button waits rather than pretending. */
            elsewhere.length > 0
          }
          onClick={submit}
        >
          {pending ? "Creating…" : "Create tournament"} <Icon name="arrow-right" />
        </button>
        {!first && (
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
      {/* A disabled button that does not say why is a dead end, and this one
          is disabled for THREE different reasons now. Naming the step that is
          actually outstanding is the difference between "the app is broken"
          and "I have one more thing to answer".

          The club name is last because it is last on the form, and because it
          is the one a newcomer will not guess: the other two are the fields
          they were plainly in the middle of filling in. Found by walking this
          screen as a new society secretary — with a name and a shape chosen
          and the club still unnamed, the button was dead and said nothing. */}
      {!pending &&
        (!name.trim() || (!copyFrom && !shape) || (clubNameRequired && !orgName.trim())) &&
        elsewhere.length === 0 && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {!name.trim()
              ? copyFrom
                ? "Give the new one a name — the rest comes across with it."
                : "Give it a name, then say how it's played."
              : !copyFrom && !shape
                ? "Say how it's played — that decides what the rest of setup asks."
                : `Name your ${outfit.noun} above — it is set once, for every tournament you will ever run.`}
          </p>
        )}

      {/* THE STEPS THAT ARE NOT ANSWERABLE HERE, as links to where they are.
          A sentence saying "finish setting up your society first" would leave
          somebody hunting for which part — and the checklist above already
          names them, so the honest thing is to point at the same rows rather
          than describe them a second time in different words.

          Shown last, under the disabled button, because it is the answer to
          "why can I not press that" and it is read after the press. */}
      {!pending && elsewhere.length > 0 && (
        <div style={{ fontSize: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Icon name="warning-circle" style={{ color: "var(--color-accent)" }} />
          <span className="text-muted">
            Set up your {outfit.noun} first — it is answered once, and every tournament you run is built on
            it:
          </span>
          {elsewhere.map((s) => (
            <a key={s.key} className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 10px" }} href={s.href}>
              {s.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
