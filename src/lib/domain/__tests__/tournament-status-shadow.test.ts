import { describe, it, expect } from "vitest";
import { tournamentStatus, tournamentFamily, LOCK_SCOPES, type TournamentFacts } from "../tournament-status";
import { setupFlow, type SetupFacts } from "../setup-flow";
import {
  configurationLocked,
  isFinished,
  isLaunched,
  lifecycleMismatch,
  nextLifecycleAction,
  resultsIn,
  tournamentPhase,
} from "../lifecycle-state";
import { completingCheckFor, finishRefusal, playRefusal } from "../phase-gate";
import { playOverOf } from "../tournament-switcher";
import { STATUS_META } from "@/lib/format";
import { screenName } from "@/lib/nav";
import { isKnockoutRound, isStraightKnockout } from "@/lib/stage-types";
import { FAMILY_FIXTURES, FAMILIES, facts, round, launched, playedOut, completed } from "./tournament-facts-fixtures";

/**
 * THE SHADOW: today's readers and the machine, side by side, on the same facts.
 *
 * PR 1 switches nothing over, so the proof that it is a refactor and not a
 * rewrite is this file: for one tournament per format family at every step,
 * and for each disagreement shape the proposal names, every reader on main is
 * run on the facts and its answer is put beside the machine's. They must AGREE
 * — except where a disagreement is listed in `DISAGREEMENTS` below, by id,
 * with the machine's intended answer. A listed disagreement that stops
 * happening fails too, so the list cannot rot into decoration.
 *
 * "Today's readers" are called, not imitated: `setupFlow`, `nextLifecycleAction`,
 * `tournamentPhase`, `lifecycleMismatch` over `resultsIn`, `playRefusal`,
 * `finishRefusal` + `completingCheckFor`, `playOverOf` (the switcher's "Play
 * complete" and the home's `resultsWaiting`), `configurationLocked` and the
 * two other locks, and `STATUS_META`. Two of them read the database on main
 * and are fed here from the facts by the rule they use:
 *
 *   resultsIn      counts cards and settled matches and NO `BracketWinner` —
 *                  a Bracket Stage files nothing else (CLAUDE.md, "which table
 *                  a round files its result in"), so here it is the rounds with
 *                  a result that are not knockout rounds;
 *   flightsOpenForChange  refuses a finished knockout or one with any
 *                  `BracketWinner`.
 */

type Reader =
  | "step"
  | "chip"
  | "journey"
  | "underWay"
  | "setupCurrent"
  | "launchRefusal"
  | "nextAction"
  | "playRefusal"
  | "completeRefusal"
  | "homeSaysComplete"
  | `lock:${(typeof LOCK_SCOPES)[number]}`;

/**
 * EVERY KNOWN DISAGREEMENT, with what the machine says instead. D1–D8 are the
 * proposal's (section 1c), P1–P5 the Golf Pro's ruled changes from today
 * (panel 8.2), N1–N2 what the machine adds that no reader on main says.
 */
export const DISAGREEMENTS = {
  D1a: "A medal with no flights: today's rail holds on Flights (\"No flights yet\") while Launch works. Machine: flights are optional for stroke and Stableford — setup is complete, journey Launch.",
  D1b: "A tournament of several rounds with one undated (not a league): today's rail holds on Rounds & formats while Launch works. Machine: a warning, never a hold (8.2 table).",
  D1c: "A single match with no flights: today's rail holds on Flights. Machine: Flights is not shown to a single match (8.2).",
  D2: "A knockout played before launch: `resultsIn` reads no BracketWinner, so today it is not under way and its journey is Setup/Launch. Machine: `hasResult` counts BracketWinner — under way, journey Play.",
  D3: "Play over with a card awaiting sign-off: the home (`resultsWaiting`) says Complete is the job while the dashboard refuses it. Machine: Complete is the job, refused in place, with the way out.",
  D3k: "A knockout with every Final decided: `playOverOf` can never be true (nobody closes a Bracket Stage), so today it stays Live and the home never says Complete. Machine: Play over.",
  D4a: "Named, with a venue and no dates: today's details step is ticked while launch refuses \"no dates\". Machine: the details step needs the date — setup holds on it.",
  D4b: "A round with no course card: today's rail is complete while launch refuses the card. Machine: Rounds & formats holds.",
  D5: "A draft being played: today's chip says \"Setting up\" beside a journey of Play. Machine: \"Setting up · results in\" (TD Q5).",
  D6: "A casual round: today `nextLifecycleAction` offers Complete for it. Machine: no next action — it is never on the home (2e).",
  D7: "#994's Needs-you strip (not on main): pinned in tournament-status.test.ts — no date asked of a one-round medal's round, no tee sheet of a round robin.",
  D8: "#994's per-round \"under way\" (not on main): pinned in tournament-status.test.ts — a round is under way when it has a result, never because its day came.",
  P1: "A team round with a player on no side: today only \"no sides at all\" refuses. Machine: refused — a player on no side cannot be scored.",
  P2: "A match or knockout of one player (or a single match with no match made): today the bar is one player. Machine: refused — there is nothing to play.",
  P3: "A round robin with a player in no flight: today unchecked at launch. Machine: refused — no flight, no fixtures.",
  P4: "A cup with a player on neither team: today a rail step only. Machine: refused (8.2 table).",
  P5: "A league whose next week has no day and no deadline: today a rail step only. Machine: refused (Golf Pro Q4, J08).",
  J08: "A league whose next week is dated and later weeks are not (PR 3): today's rail holds on Rounds & formats until EVERY week has a day. Machine: the step is done; the later weeks are named in the launch dialog (Golf Pro Q4).",
  N1: "The fourth step: the chip says \"Play over\" where STATUS_META says \"Live\" (2d). Only the switcher's note and the home's job say it today.",
  N2: "Live, a round owes its draw (a cut-fed round robin, a league week): today the button is Complete. Machine: the draw is the next action (2e).",
} as const;
type Id = keyof typeof DISAGREEMENTS;

function setupFactsOf(f: TournamentFacts): SetupFacts {
  return {
    confirmed: f.confirmed,
    rounds: f.rounds.map((r) => ({
      label: r.label,
      drawsPairings: r.drawsPairings,
      scheduled: r.scheduled,
      scorable: r.scorable,
      cutFed: r.cutFed,
      matches: r.matches,
      ...(r.teeSheetSaved === null ? {} : { teeSheetSaved: r.teeSheetSaved }),
    })),
    groups: f.groups,
    named: f.named,
    dated: f.dated,
    venued: f.venued,
    playingRounds: f.rounds.filter((r) => r.playing).length,
    missingCards: f.missingCards,
    straightKnockout: isStraightKnockout(f.rounds),
    moneyAnswered: f.moneyAnswered,
    launched: isLaunched(f.status),
    teams: f.teams,
    ...(f.cup ? { cup: f.cup } : {}),
  };
}

/** Every reader, today and machine, on one tournament. */
function compare(f: TournamentFacts): Array<{ reader: Reader; today: unknown; machine: unknown }> {
  const st = tournamentStatus(f);
  const casual = f.shape === "match";
  const launchedNow = isLaunched(f.status);
  const flow = casual ? null : setupFlow(setupFactsOf(f), (h) => screenName(h));
  const stages = f.rounds.map((r) => ({ id: r.id, type: r.type, position: r.position, closedAt: r.closed ? new Date(0) : null }));
  const playOver = playOverOf(stages);
  const anyResult = f.rounds.some((r) => r.hasResult);
  const todayResultsIn = resultsIn({ matches: [], cards: f.rounds.filter((r) => r.hasResult && !isKnockoutRound(r.type)) });

  const out: Array<{ reader: Reader; today: unknown; machine: unknown }> = [];
  const add = (reader: Reader, today: unknown, machine: unknown) => out.push({ reader, today, machine });

  add("step", isFinished(f.status) ? "completed" : launchedNow ? (playOver ? "play-over" : "live") : "setting-up", st.step);
  add("chip", STATUS_META[f.status]?.label ?? f.status, st.chip.replace(" · Suspended", ""));
  add("journey", tournamentPhase({ status: f.status, scored: todayResultsIn > 0, setupComplete: !!flow?.complete }), st.journey);
  add("underWay", lifecycleMismatch({ status: f.status, resultsIn: todayResultsIn, playersEntered: f.confirmed }) !== null, st.underWayUnlaunched);
  if (!launchedNow) {
    add("setupCurrent", flow ? (flow.current?.key ?? null) : "no flow", casual ? "no flow" : (st.setup.current?.key ?? null));
    add("launchRefusal", flow?.launch.refusal ?? null, st.refusals.launch);
  }
  const action = nextLifecycleAction({ status: f.status, resultsIn: todayResultsIn });
  add("nextAction", action ? (action.kind === "launch" ? "launch" : action.to === "completed" ? "complete" : "reopen") : "none", st.nextAction?.kind ?? "none");
  add("playRefusal", playRefusal({ status: f.status, anyResult }), st.refusals.play);
  if (launchedNow && !isFinished(f.status)) {
    const completing = completingCheckFor(stages, new Set(f.rounds.filter((r) => r.hasResult).map((r) => r.id)));
    add(
      "completeRefusal",
      finishRefusal({ pendingConfirmations: f.review.pendingConfirmations, disputed: f.review.disputed }) ??
        (completing && "refuse" in completing ? completing.refuse : null),
      st.refusals.complete,
    );
    add("homeSaysComplete", isLaunched(f.status) && playOver, st.step === "play-over" && !!st.nextAction?.enabled);
  }
  const blanket = configurationLocked(f);
  const flighted = tournamentFamily(f) === "flightedKnockout";
  const bracketWon = f.rounds.some((r) => isKnockoutRound(r.type) && r.hasResult);
  const todayLock: Record<(typeof LOCK_SCOPES)[number], boolean> = {
    details: blanket,
    rounds: blanket,
    field: blanket,
    flights: blanket || f.flightsConfirmed,
    draw: flighted ? isFinished(f.status) || bracketWon : blanket,
    sides: blanket,
    cup: blanket,
    money: false,
    teeSheet: false,
  };
  for (const scope of LOCK_SCOPES) add(`lock:${scope}`, todayLock[scope], st.locks[scope].locked);
  return out;
}

interface Shape {
  name: string;
  facts: TournamentFacts;
  /** Readers that disagree on this tournament, and the listed disagreement that explains each. */
  differs?: Partial<Record<Reader, Id>>;
}

const F = FAMILY_FIXTURES;

/** One tournament per family at every step — then every disagreement's own shape. */
const SHAPES: Shape[] = [
  ...FAMILIES.filter((fam) => fam !== "casual").flatMap((fam): Shape[] => {
    const knock = fam === "knockout" || fam === "flightedKnockout";
    const ready = F[fam]();
    const live = launched({ ...ready, rounds: ready.rounds.map((r, i) => ({ ...r, hasResult: i === 0 })) });
    return [
      { name: `${fam}: ready to launch`, facts: ready },
      { name: `${fam}: live, under way`, facts: live },
      {
        name: `${fam}: play over`,
        facts: playedOut(ready),
        differs: knock ? { step: "D3k", chip: "N1", homeSaysComplete: "D3k" } : { chip: "N1" },
      },
      { name: `${fam}: completed`, facts: completed(ready) },
    ];
  }),
  { name: "casual: live", facts: F.casual(), differs: { nextAction: "D6" } },

  { name: "D1a: a medal with no flights", facts: facts({ groups: 0 }), differs: { setupCurrent: "D1a", journey: "D1a" } },
  {
    name: "D1b: two rounds, the second undated",
    facts: facts({
      rounds: [
        round({ id: "r1", position: 0, type: "Round Robin", drawsPairings: true, matches: 6, teeSheetSaved: null }),
        round({ id: "r2", position: 1, type: "Single Match Stage", scheduled: false, matches: 1, teeSheetSaved: null }),
      ],
    }),
    differs: { setupCurrent: "D1b", journey: "D1b" },
  },
  { name: "D1c: a single match with no flights", facts: { ...F.match(), groups: 0 }, differs: { setupCurrent: "D1c", journey: "D1c" } },
  {
    name: "D2: a knockout played before launch",
    facts: { ...F.knockout(), rounds: [{ ...F.knockout().rounds[0], hasResult: true }] },
    differs: { underWay: "D2", journey: "D2", chip: "D5" },
  },
  {
    name: "D3: every round closed, one card awaiting sign-off",
    facts: { ...playedOut(facts({ rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1, type: "Single Match Stage", matches: 1, teeSheetSaved: null })] })), review: { pendingConfirmations: 1, disputed: 0 } },
    differs: { homeSaysComplete: "D3", chip: "N1" },
  },
  {
    name: "D3: every round closed with nothing scored",
    facts: { ...launched(facts()), rounds: [round({ id: "r1", position: 0, closed: true })] },
    differs: { homeSaysComplete: "D3", chip: "N1" },
  },
  {
    name: "D3k: a knockout with its Final decided, live",
    facts: playedOut(F.knockout()),
    differs: { step: "D3k", chip: "N1", homeSaysComplete: "D3k" },
  },
  { name: "D4a: named, a venue, no dates", facts: facts({ dated: false, venued: true }), differs: { setupCurrent: "D4a", journey: "D4a" } },
  { name: "D4b: a round with no course card", facts: facts({ missingCards: [{ label: "Round 1", course: "Invented Links" }] }), differs: { setupCurrent: "D4b", journey: "D4b" } },
  { name: "D5: a medal in draft with cards in", facts: facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] }), differs: { chip: "D5" } },
  { name: "P1: a team round with one player on no side", facts: { ...F.stroke(), teams: { needed: true, sides: 3, unsided: 1 } }, differs: { launchRefusal: "P1" } },
  { name: "P2: a knockout of one", facts: { ...F.knockout(), confirmed: 1 }, differs: { launchRefusal: "P2", setupCurrent: "P2", journey: "P2" } },
  {
    name: "P2: a single match with no match made",
    facts: { ...F.match(), rounds: [{ ...F.match().rounds[0], matches: 0 }] },
    differs: { launchRefusal: "P2", setupCurrent: "P2", journey: "P2" },
  },
  { name: "P3: a round robin with a player in no flight", facts: { ...F.roundRobinFlights(), unplacedInFlights: 1 }, differs: { launchRefusal: "P3", setupCurrent: "P3", journey: "P3" } },
  { name: "P4: a cup with a player on neither team", facts: { ...F.teamCup(), cup: { flights: 2, unplaced: 1 } }, differs: { launchRefusal: "P4" } },
  { name: "P5: a league whose first week is undated", facts: { ...F.league(), rounds: F.league().rounds.map((r, i) => ({ ...r, scheduled: i !== 0 })) }, differs: { launchRefusal: "P5" } },
  {
    name: "J08: a league whose next week is dated, its later weeks not",
    facts: { ...F.league(), rounds: F.league().rounds.map((r, i) => ({ ...r, scheduled: i === 0 })) },
    differs: { setupCurrent: "J08", journey: "J08" },
  },
  {
    name: "N2: live, a cut-fed round robin owes its draw",
    facts: launched(
      facts({
        rounds: [
          round({ id: "r1", position: 0, type: "Round Robin", drawsPairings: true, matches: 12, hasResult: true, closed: true, teeSheetSaved: null }),
          round({ id: "r2", position: 1, type: "Round Robin", drawsPairings: true, cutFed: true, matches: 0, teeSheetSaved: null }),
        ],
      }),
    ),
    differs: { nextAction: "N2" },
  },
  {
    name: "a flighted knockout, live, with a result: the division is fixed",
    facts: launched({ ...F.flightedKnockout(), rounds: [{ ...F.flightedKnockout().rounds[0], hasResult: true }] }),
  },
  { name: "a confirmed draw before launch", facts: { ...F.stroke(), flightsConfirmed: true } },
  { name: "live and unlocked by the organizer", facts: { ...launched(F.stroke()), configUnlocked: true } },
  { name: "a legacy 'registration' row", facts: { ...F.stroke(), status: "registration" } },
  { name: "a legacy 'ready' row", facts: { ...F.stroke(), status: "ready" } },
  { name: "live and suspended", facts: { ...launched(F.stroke()), playSuspended: true } },
];

describe("the shadow: today's readers beside the machine", () => {
  it("covers every family", () => {
    const seen = new Set(SHAPES.map((x) => tournamentFamily(x.facts)));
    for (const fam of FAMILIES) expect(seen, `no shadow fixture for ${fam}`).toContain(fam);
  });

  it("covers every disagreement it lists, except the two that live on #994", () => {
    const used = new Set(SHAPES.flatMap((x) => Object.values(x.differs ?? {})));
    for (const id of Object.keys(DISAGREEMENTS) as Id[]) {
      if (id === "D7" || id === "D8") continue;
      expect(used, `${id} is listed and no shape shows it`).toContain(id);
    }
  });

  for (const shape of SHAPES) {
    it(shape.name, () => {
      const rows = compare(shape.facts);
      const seen = new Set<Reader>();
      for (const { reader, today, machine } of rows) {
        seen.add(reader);
        const id = shape.differs?.[reader];
        if (id) {
          expect(machine, `${reader} was listed as ${id} — "${DISAGREEMENTS[id]}" — and agrees with today (${JSON.stringify(today)}); delete the entry`).not.toEqual(today);
        } else {
          expect(machine, `${reader}: today says ${JSON.stringify(today)}, the machine ${JSON.stringify(machine)}, and no disagreement is listed for it`).toEqual(today);
        }
      }
      for (const reader of Object.keys(shape.differs ?? {}) as Reader[]) {
        expect(seen, `${reader} is listed for this shape and never compared`).toContain(reader);
      }
    });
  }
});
