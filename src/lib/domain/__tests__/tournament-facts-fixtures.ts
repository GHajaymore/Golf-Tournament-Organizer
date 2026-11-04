/**
 * Hand-built `TournamentFacts` for the state machine's tests — one healthy
 * tournament per format family, each ready to launch, plus the moves that take
 * one through its steps. Invented, and pure: no database, no names of anybody.
 */
import type { DrawFacts, Family, RoundFacts, TournamentFacts } from "../tournament-status";

export function round(over: Partial<RoundFacts> & { id: string; position: number }): RoundFacts {
  return {
    label: `Round ${over.position + 1}`,
    type: "Stroke Play Round",
    format: "Stroke Play",
    playing: true,
    stableford: false,
    scorable: true,
    scheduled: true,
    drawsPairings: false,
    cutFed: false,
    matches: 0,
    matchesOver: 0,
    teeSheetSaved: true,
    hasResult: false,
    closed: false,
    ...over,
  };
}

export function facts(over: Partial<TournamentFacts> = {}): TournamentFacts {
  return {
    today: "2026-11-03",
    status: "draft",
    legacyStatus: "",
    configUnlocked: false,
    correction: null,
    shape: "single",
    named: true,
    dated: true,
    venued: true,
    startOn: "2026-11-14",
    endOn: "2026-11-14",
    moneyAnswered: true,
    bracketMode: "single",
    flightsConfirmed: false,
    playSuspended: false,
    confirmed: 12,
    groups: 2,
    unplacedInFlights: 0,
    teams: { needed: false, sides: 0, unsided: 0 },
    cup: null,
    rounds: [round({ id: "r1", position: 0 })],
    missingCards: [],
    knockout: null,
    cupDecided: null,
    review: { pendingConfirmations: 0, disputed: 0 },
    ...over,
  };
}

const draw = (label: string, entrants: number, finalDecided = false): DrawFacts => ({ label, entrants, finalDecided });

/** One healthy tournament per family, set up and ready to launch. */
export const FAMILY_FIXTURES: Record<Family, () => TournamentFacts> = {
  stroke: () => facts(),
  stableford: () => facts({ rounds: [round({ id: "r1", position: 0, format: "Stableford", stableford: true })] }),
  match: () =>
    facts({
      confirmed: 2,
      groups: 1,
      rounds: [round({ id: "r1", position: 0, type: "Single Match Stage", format: "Match Play", matches: 1, teeSheetSaved: null })],
    }),
  roundRobinFlights: () =>
    facts({
      confirmed: 8,
      rounds: [round({ id: "r1", position: 0, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: 12, teeSheetSaved: null })],
    }),
  knockout: () =>
    facts({
      confirmed: 8,
      groups: 0,
      rounds: [round({ id: "r1", position: 0, type: "Bracket Stage", format: "Match Play", teeSheetSaved: null })],
      knockout: { draws: [draw("", 8)], thirdPlace: { on: false, decided: false } },
    }),
  flightedKnockout: () =>
    facts({
      confirmed: 24,
      groups: 0,
      bracketMode: "flights",
      rounds: [round({ id: "r1", position: 0, type: "Bracket Stage", format: "Match Play", teeSheetSaved: null })],
      knockout: { draws: [draw("Flight A", 8), draw("Flight B", 8), draw("Flight C", 8)], thirdPlace: { on: false, decided: false } },
    }),
  teamCup: () =>
    facts({
      confirmed: 16,
      teams: { needed: true, sides: 0, unsided: 16 },
      cup: { flights: 2, unplaced: 0 },
      rounds: [
        round({ id: "r1", position: 0, type: "Team Session", format: "Four-Ball", teeSheetSaved: null }),
        round({ id: "r2", position: 1, type: "Team Session", format: "Singles", teeSheetSaved: null }),
      ],
    }),
  league: () =>
    facts({
      confirmed: 16,
      groups: 4,
      startOn: "2026-11-10",
      endOn: "2026-12-01",
      rounds: [0, 1, 2].map((i) =>
        round({ id: `w${i + 1}`, position: i, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: 8, teeSheetSaved: null }),
      ),
    }),
  casual: () =>
    facts({
      shape: "match",
      status: "live",
      configUnlocked: true,
      confirmed: 4,
      groups: 0,
      moneyAnswered: false,
      rounds: [round({ id: "r1", position: 0, teeSheetSaved: null })],
    }),
};

export const FAMILIES = Object.keys(FAMILY_FIXTURES) as Family[];

/** Launched, as `launchTournament` leaves it: live, configuration locked. */
export function launched(f: TournamentFacts): TournamentFacts {
  return { ...f, status: "live", configUnlocked: false };
}

/** Every playing round played and closed, and — for a knockout — every Final decided. */
export function playedOut(f: TournamentFacts): TournamentFacts {
  return {
    ...launched(f),
    rounds: f.rounds.map((r) => ({ ...r, hasResult: true, closed: r.type === "Bracket Stage" ? false : true, matchesOver: r.matches })),
    knockout: f.knockout ? { ...f.knockout, draws: f.knockout.draws.map((d) => ({ ...d, finalDecided: true })) } : null,
    cupDecided: f.cup ? true : null,
  };
}

export function completed(f: TournamentFacts): TournamentFacts {
  return { ...playedOut(f), status: "completed" };
}
