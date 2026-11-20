import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { settingsOf } from "@/lib/services/tournament";
import { flightTeeCounts } from "@/lib/tournament-settings";
import { tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { GroupingControls } from "@/components/GroupingControls";
import { generatesPairings } from "@/lib/stage-types";
import { ScopeLockBanner } from "@/components/ScopeLockBanner";
import { SetupFlowRail, SetupFlowFooter } from "@/components/SetupFlowRail";
import { setupRailFor, screenLocksFor } from "@/lib/services/tournament-status";
import { FlightBoard } from "@/components/FlightBoard";
import { FlightTeeSelect } from "@/components/FlightTeeSelect";
import { unratedFlightWarning, teesForEvent, roundTeeId } from "@/lib/services/handicaps";
import type { FormationRule } from "@/lib/domain";
import { Icon } from "@/components/Icon";
import { flightLabel } from "@/lib/domain/flight-label";
import { indexLabel } from "@/lib/domain/handicap-label";
import Link from "next/link";
import { lockFactsFor } from "@/lib/services/tournament-facts";
import { tournamentFamily } from "@/lib/domain/tournament-status";
import { flagsUnplaced, unplacedWords } from "@/lib/domain/field-change";
import { acrossRoundsRefusal } from "@/lib/services/round-change";

export const metadata = screenMetadata("/grouping");

export default async function GroupingPage() {
  const session = await requireScreen("grouping");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  /**
   * The machine's lock on the flights (PR 5b) — the one `regenGroups`,
   * `renameGroup` and `setFlightsConfirmed` ask. A lock BY THE DRAW is left to
   * the board, which already draws "confirmed" and the button that reopens it:
   * this screen IS that lock's way out, so a banner sending people here would
   * point at itself. Only a lock by launch or completion shuts the screen.
   */
  const flights = await screenLocksFor(session.eventId, ["flights"]);
  const flightLocks = flights.locks.filter((l) => l.by !== "draw");
  const locked = flightLocks.length > 0;
  // Where this screen sits in setting the tournament up. Null for a match.
  const flow = await setupRailFor(session.eventId);
  const manual = state.event.formationRule === "manual";
  /**
   * THE UNPLACED FLAG (J04, state machine PR 7a), the same words Entries says:
   * who is in the field but in no flight, where flights are a division or the
   * pairings. Entries is where a late entrant is put in one ("Choose a flight"
   * beside their name), so this points there.
   */
  const lockFacts = await lockFactsFor(session.eventId);
  const unplacedFlag =
    lockFacts && flagsUnplaced(tournamentFamily(lockFacts), state.groups.length)
      ? unplacedWords(state.confirmed.filter((p) => !p.groupId).map((p) => p.name))
      : "";
  // A handicap-balanced draw is balanced on Course Handicaps, so unrated tees
  // make it quietly uneven. The scoring warning on Rounds & format is about a
  // different consequence of the same gap and fires on a different trigger.
  const drawWarning = await unratedFlightWarning(session.eventId, state.event.formationRule);
  // The sets a division may be put on, and what a flight claiming none
  // plays — resolved through the same reader the scoring uses.
  const eventTees = await teesForEvent(session.eventId);
  const roundTee = roundTeeId(eventTees, state.event.defaultTeeId);
  // Wherever a flight's set is READ — the scorer's own answer, see
  // `flightTeeCounts`. This said "only by flight; under any other policy
  // nothing reads a flight's claim", which is wrong about two of them: where
  // players are assigned individually, the unassigned play their flight's.
  // Under one set for everyone the control would change no score, and is not
  // drawn. Both ways of showing the flights read these two.
  const byFlightTees = flightTeeCounts(settingsOf(state.event).teePolicy);
  const roundTeeName = eventTees.find((t) => t.id === roundTee)?.name;
  const defaultTeeName = roundTeeName ? `${roundTeeName} (round’s)` : "The round’s tees";
  /**
   * Whether a flight's tees may change now, and if not why — the very call
   * `setFlightTee` refuses with (the rounds rule, `field-tees`), so each
   * flight's Tees box is drawn shut with the sentence rather than offered and
   * then refused (the finding after round G594-1, 10 Nov).
   */
  const teesDoor = await acrossRoundsRefusal(session.eventId, { kind: "field-tees" });

  const cards = state.groups.map((g, i) => {
    const players = state.confirmed.filter((p) => p.groupId === g.id).sort((a, b) => a.handicap - b.handicap);
    const avg =
      players.length === 0
        ? 0
        : Math.round((players.reduce((s, p) => s + p.handicap, 0) / players.length) * 10) / 10;
    // What every board calls it — the club's own name, "Flight A" for a bare
    // letter, the position only when nothing is set. See `flightLabel`.
    const label = flightLabel(g.name, i);
    return {
      id: g.id,
      label,
      name: g.name?.trim() ?? "",
      avg,
      players,
      captainId: g.captainId,
      viceCaptainId: g.viceCaptainId,
      teeId: g.teeId,
    };
  });

  const mode = (["auto", "count", "perFlight"].includes(state.event.flightMode)
    ? state.event.flightMode
    : "auto") as "auto" | "count" | "perFlight";

  return (
    <>
      <SetupFlowRail flow={flow} href="/grouping" />
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h1 className="page-title">Flights</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Divide the field into flights. Pick a formation rule, preview the result, then generate.
        </p>
      </div>

      <ScopeLockBanner locks={flightLocks} correction={flights.correction} isAdmin={session.viewRole === "admin"} />

      {unplacedFlag && (
        <p className="card elev-sm" style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 }} data-testid="unplaced-flag">
          <span>
            <Icon name="warning" /> {unplacedFlag}{" "}
            <Link href="/registration">Choose a flight beside their name on Entries</Link>
          </span>
        </p>
      )}

      {drawWarning && (
        <p
          style={{
            display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 14px",
            padding: "10px 12px", borderRadius: "var(--radius-md)", fontSize: 13, lineHeight: 1.5,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 32%, transparent)",
          }}
        >
          <Icon name="warning" style={{ fontSize: 15, marginTop: 1, flex: "none" }} />
          {drawWarning}
        </p>
      )}

      <GroupingControls
        players={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapType: p.handicapType, handicapSource: p.handicapSource, seed: p.seed }))}
        currentRule={state.event.formationRule as FormationRule}
        currentMode={mode}
        currentValue={state.event.flightValue}
        locked={locked}
        drawsPairings={state.stages.some((s) => generatesPairings(s.type))}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Current flights</span>
        <span className="text-muted" style={{ fontSize: 13 }}>Active in the tournament</span>
      </div>
      {cards.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13 }}>No flights yet — choose a rule and generate.</div>
      ) : manual ? (
        /* Manual is the one rule where the organizer's hand IS the policy, so
           it is the one place a player may be dragged between flights. Doing it
           under a seeded or handicap rule would leave a grouping that no longer
           matches the rule naming it, and the next regenerate would undo it. */
        <FlightBoard
          cards={cards}
          locked={locked}
          canEdit={session.viewRole !== "player"}
          // Organizer only, as `setFlightTee` is — see `canSetTees`.
          canSetTees={session.viewRole === "admin"}
          confirmed={state.event.flightsConfirmed}
          // Captains are named whenever attendance is tracked per round —
          // including under `captains` mode, where knowing who to chase for a
          // list is the entire point.
          leadership={tracksPerRound(settingsOf(state.event).attendanceMode as AttendanceMode)}
          byFlightTees={byFlightTees}
          tees={eventTees.map((t) => ({ id: t.id, name: t.name }))}
          defaultTeeName={defaultTeeName}
          teesDoor={teesDoor}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {cards.map((g) => (
            <div key={g.id} className="card elev-sm" style={{ gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{g.label}</span>
                <span className="text-muted" style={{ fontSize: 13 }}>avg hcp {g.avg}</span>
              </div>
              {/* The flight's tees, where the tournament decides them by
                  flight — on flights the app drew too, not only Manual ones
                  (see `FlightTeeSelect`). */}
              {byFlightTees && eventTees.length > 0 && (
                <FlightTeeSelect
                  groupId={g.id}
                  label={g.label}
                  teeId={g.teeId ?? null}
                  tees={eventTees.map((t) => ({ id: t.id, name: t.name }))}
                  defaultTeeName={defaultTeeName}
                  disabled={locked || session.viewRole !== "admin"}
                  teesDoor={teesDoor}
                />
              )}
              {g.players.map((pl) => (
                <div
                  key={pl.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 13,
                    padding: "4px 0",
                    borderBottom: "1px solid var(--color-divider)",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</span>
                  <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{indexLabel(pl)}</span>
                </div>
              ))}
              {g.players.length === 0 && (
                <span className="text-muted" style={{ fontSize: 13 }}>No players assigned.</span>
              )}
            </div>
          ))}
        </div>
      )}
      <SetupFlowFooter flow={flow} href="/grouping" />
    </>
  );
}
