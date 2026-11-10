import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { teesForEvent, roundTeeId } from "@/lib/services/handicaps";
import { ladiesTeeFor, ladiesTeeOn, teeIdFor } from "@/lib/domain/handicap";
import { redirect } from "next/navigation";
import { RegistrationClient } from "@/components/RegistrationClient";
import { DisqualifyPanel } from "@/components/DisqualifyPanel";
import { isLaunched } from "@/lib/domain/lifecycle-state";
import { tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { entryNeedsEmail } from "@/lib/tournament-settings";
import { brandForEvent, formattingForEvent } from "@/lib/services/organization";
import { rosterForEvent } from "@/lib/services/roster";
import { handicapBodyForEvent } from "@/lib/services/integrations";
import { bodyInProse, bodyShortLabel } from "@/lib/domain/handicap-body";
import { phoneRequiredFor } from "@/lib/plans";
import { fieldLimitFor } from "@/lib/services/waitlist";
import { fieldCapFor } from "@/lib/services/limits";
import { SetupFlowRail, SetupFlowFooter } from "@/components/SetupFlowRail";
import { setupRailFor, screenLocksFor } from "@/lib/services/tournament-status";
import { recentChanges } from "@/lib/services/recent-changes";
import { RecentChanges } from "@/components/RecentChanges";
import { flightLabel } from "@/lib/domain/flight-label";
import { awaitingApproval } from "@/lib/registration";
import { fieldFactsFor } from "@/lib/services/field-change";
import { FIELD_CHANGES, addFlightPick, fieldBanner, fieldDoors, flagsUnplaced, reserveOffered, unplacedWords } from "@/lib/domain/field-change";
import { WithdrawnList } from "@/components/WithdrawnList";
import { acrossRoundsRefusal } from "@/lib/services/round-change";

export const metadata = screenMetadata("/registration");

export default async function RegistrationPage() {
  const session = await requireScreen("registration");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  // The machine's lock on the field (PR 5b) — the one the entry terms ask (`refuseIfLocked(…, "field")`);
  // the field's own day-of doors are `fieldDoors`, below.
  const field = await screenLocksFor(session.eventId, ["field"]);
  const locked = field.locks.length > 0;
  /**
   * THE FIELD'S DOORS — the one field rule (day-of field changes, PR A), from
   * the same facts the actions ask (`fieldFactsFor` → `fieldChangeAllowed`), so
   * no control is offered that its action refuses. Null facts (no tournament)
   * is redirected above; a missing read refuses everything rather than nothing.
   */
  const fieldFacts = await fieldFactsFor(session.eventId);
  const doors = fieldFacts
    ? fieldDoors(fieldFacts)
    : (Object.fromEntries(FIELD_CHANGES.map((c) => [c, "This tournament could not be read."])) as ReturnType<typeof fieldDoors>);
  const underWay = fieldFacts ? fieldBanner(fieldFacts) : null;
  /**
   * THE UNPLACED FLAG (J04, state machine PR 7a): every confirmed player in no
   * flight, by name, where flights are a division or the pairings — said for as
   * long as it is true, outside a cup too. The "Choose a flight" beside each
   * name is the way to put them in one.
   */
  const unplacedFlag =
    fieldFacts && flagsUnplaced(fieldFacts.family, fieldFacts.flights) ? unplacedWords(state.confirmed.filter((p) => !p.groupId).map((p) => p.name)) : "";
  // Where this screen sits in setting the tournament up. Null for a match.
  const flow = await setupRailFor(session.eventId);
  const brand = await brandForEvent(session.eventId);
  const roster = await rosterForEvent(session.eventId);
  // The club's handicap body — GHIN, England Golf, Golf Ireland … — for the
  // "where this player's handicap comes from" words on the add form.
  const body = await handicapBodyForEvent(session.eventId);

  // Flight label per player, for the confirmed-field table (absorbs the old Roster screen).
  const flightByPlayer = new Map<string, string>();
  state.groups.forEach((g, i) => {
    for (const p of state.confirmed) if (p.groupId === g.id) flightByPlayer.set(p.id, flightLabel(g.name, i));
  });

  const eventTees = await teesForEvent(state.event.id);
  const roundTee = roundTeeId(eventTees, state.event.defaultTeeId);
  // Kept rows only — before launch a withdrawal with no history is deleted, not
  // kept; after launch a confirmed player is always kept (day-of field changes).
  const withdrawn = state.players.filter((p) => p.status === "withdrawn").map((p) => ({ id: p.id, name: p.name }));

  /**
   * WHAT EACH PLAYER PLAYS IF THE ORGANIZER LEAVES THEM ALONE, AND WHY: their
   * flight's set, the course's ladies' set, or the tournament's. Asked of
   * `teeIdFor` — the one resolver the boards use — with no set of the player's
   * own, so the label on this screen cannot name different tees from the card.
   */
  const teeById = new Map(eventTees.map((t) => [t.id, t] as const));
  const playingAt = roundTee ? teeById.get(roundTee)?.courseId : undefined;
  const ladies = ladiesTeeOn(teeById, playingAt);
  const flightTeeOf = new Map(state.groups.map((g) => [g.id, g.teeId]));
  const teePolicy = settingsOf(state.event).teePolicy;
  const inheritedTee = (p: (typeof state.players)[number]): string => {
    const flights = p.groupId ? (flightTeeOf.get(p.groupId) ?? null) : null;
    const hers = ladiesTeeFor(p.gender, ladies);
    const id = teeIdFor(teePolicy, null, flights, roundTee, (t) => !playingAt || teeById.get(t)?.courseId === playingAt, hers);
    const name = teeById.get(id)?.name;
    if (!name) return "";
    const whose = id === roundTee ? "tournament’s" : id === flights ? "flight’s" : id === hers ? "ladies’" : "tournament’s";
    return `${name} (${whose})`;
  };

  /**
   * ONE ROW, FOR ALL THREE LISTS (2026-10-11).
   *
   * The table below is drawn three times — the field, the waiting list, the
   * entries waiting for approval — and each list was built by its own copy of
   * this. Only the field's copy carried the tee, so the Tees dropdown on a
   * waiting-list row saved and then showed the round's set again (found by the
   * control crawl: nine choices "lost" on a scramble's waiting list). A field
   * one list is given is now a field every list is given.
   */
  const asRow = (p: (typeof state.players)[number]) => ({
    id: p.id,
    name: p.name,
    handicap: p.handicap,
    handicapType: p.handicapType,
    handicapSource: p.handicapSource,
    seed: p.seed,
    email: p.email,
    phone: p.phone,
    homeClub: p.homeClub,
    flight: flightByPlayer.get(p.id),
    teeId: p.teeId,
    inheritedTee: inheritedTee(p),
    // Serialised, because a Date does not survive the server/client
    // boundary as a Date. The badge is rendered from this on the client so
    // "2 days ago" is relative to the reader's clock, not the server's.
    promotedAt: p.promotedAt ? p.promotedAt.toISOString() : null,
    // "Don't show my name on public pages" (2026-10-24).
    publicNameWithheld: p.publicNameWithheld,
    // Member or guest, as stored (A039); the screen reads it through `entryStanding`.
    standing: p.standing,
  });

  return (
    <>
      <SetupFlowRail flow={flow} href="/registration" />
    <RegistrationClient
      handicapBody={{ id: body.id, label: bodyShortLabel(body), prose: bodyInProse(body), number: body.number }}
      noFormatYet={state.stages.length === 0 && state.confirmed.length === 0}
      // The sets an organizer may put somebody on, and what a blank resolves
      // to, so the column never shows an empty box meaning "the round’s".
      tees={eventTees.map((t) => ({ id: t.id, name: t.name }))}
      teePolicy={settingsOf(state.event).teePolicy}
      // Whether one player's tees may change now, and if not why — the very call `setPlayerTee`
      // refuses with (the rounds rule, `field-tees`), so the Tees column is drawn shut with the
      // sentence rather than offered and then refused (the finding after round G594-1, 10 Nov).
      teesDoor={await acrossRoundsRefusal(session.eventId, { kind: "field-tees" })}
      needsEmail={entryNeedsEmail(settingsOf(state.event))}
      defaultTeeName={
        eventTees.find((t) => t.id === roundTee)?.name
          ? `${eventTees.find((t) => t.id === roundTee)?.name} (tournament’s)`
          : "Tournament’s tees"
      }
      event={{
        name: state.event.name,
        // The capacity the entry actions apply — the plan's field cap over
        // the stored number — so "Confirmed 10 of 10 · Full" here matches what
        // an eleventh entrant is actually told (walked 2026-09-30).
        capacity: await fieldLimitFor(state.event),
        // The terms form edits what the organizer set, not what the plan lets in.
        storedCapacity: state.event.capacity,
        planLimit: await fieldCapFor(state.event.organizationId),
        status: state.event.status,
        regDeadline: state.event.regDeadline,
        regOpens: state.event.regOpens,
          registrationOverride: state.event.registrationOverride,
        inviteMessage: state.event.inviteMessage,
        organizationName: brand?.name,
        dates: state.event.dates,
        course: state.event.course,
        city: state.event.city,
        registrationOpen: state.event.registrationOpen,
        registrationApproval: state.event.registrationApproval,
        // What the add action will insist on, through the one rule it asks, so
        // the form cannot say "required" where the server lets in no mobile.
        requirePhone: phoneRequiredFor(state.event.requirePhone),
        registrationToken: state.event.registrationToken,
        locale: (await formattingForEvent(session.eventId)).locale,
        today: state.today,
      }}
      confirmed={state.confirmed.map(asRow)}
      waitlist={state.waitlist.map(asRow)}
      pendingEntries={awaitingApproval(state.players).map(asRow)}
      locked={locked}
      fieldLocks={field.locks}
      correction={field.correction}
      doors={doors}
      underWay={underWay}
      flights={state.groups.map((g, i) => ({ id: g.id, label: flightLabel(g.name, i) }))}
      unplacedFlag={unplacedFlag}
      addFlight={fieldFacts ? addFlightPick(fieldFacts) : null}
      offerReserve={fieldFacts ? reserveOffered(fieldFacts) : false}
      isAdmin={session.viewRole === "admin"}
      roster={roster}
    />
      {/* THE COMMITTEE'S RULING (2026-10-08). Only once play has begun —
          there is nothing to be disqualified from before it — and outside the
          setup lock, since that is when the lock is on. */}
      {isLaunched(state.event.status) && (
        <DisqualifyPanel
          field={state.confirmed.map((p) => ({ id: p.id, name: p.name }))}
          disqualified={state.players.filter((p) => p.status === "disqualified").map((p) => ({ id: p.id, name: p.name }))}
          // A league is a field that changes week to week — attendance tracked
          // per round. Not "more than one stroke round": a 36-hole
          // championship is that too, and there a DQ IS for every round.
          league={tracksPerRound(settingsOf(state.event).attendanceMode as AttendanceMode)}
        />
      )}
      {/* WHO WITHDREW (2026-10-09, grid cell T45). Removing a player who has
          already played keeps them as withdrawn — "their results are kept" —
          and then they were on no list on this page: not the field, not the
          waitlist, nowhere. A disqualification has its own line above; a
          withdrawal had none. Their scores and any money still stand.
          And since day-of field changes (PR A), each has Put back. */}
      <WithdrawnList withdrawn={withdrawn} door={doors.reinstate} />
      {/* WHO CAME AND WENT — the field's lines from the audit log (Ajay,
          2026-09-27). A member who withdraws themselves took the confirmed
          count from 19 to 18 with nothing here saying who or when. */}
      <div style={{ marginTop: 16 }}>
        <RecentChanges
          title="Recent changes to the field"
          empty="No entries or withdrawals recorded yet."
          rows={await recentChanges(session.eventId, { only: "field", take: 20 })}
          locale={(await formattingForEvent(session.eventId)).locale}
          showKind={false}
        />
      </div>
      <SetupFlowFooter flow={flow} href="/registration" />
    </>
  );
}
