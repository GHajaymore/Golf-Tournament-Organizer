import { describe, it, expect } from "vitest";
import { tournamentStatus, tournamentFamily, LOCK_SCOPES, type TournamentFacts, type RoundFacts } from "../tournament-status";
import { isLaunched } from "../lifecycle-state";
import { FAMILY_FIXTURES, FAMILIES, round } from "./tournament-facts-fixtures";

/**
 * THE MACHINE AGREES WITH ITSELF, on any tournament (proposal 5a, with the
 * panel's changes 4 and 5).
 *
 * Random facts in every family, and the invariants that tie the answers
 * together — the ones whose breaking is exactly D1, D2, D3 and D4:
 *
 *   the button is enabled exactly when its own refusal is null, and a refused
 *   button carries its reason and a way out (QA, 8.4);
 *   before launch, setup is finished exactly when launch is allowed (D1, D4);
 *   play over offers Complete and nothing else (D3);
 *   results before launch read under way and Play (D2);
 *   a lock always says why and how out; only launch and the draw are correctable.
 *
 * THE SEED IS PRINTED ON EVERY FAILURE. Replay one with
 *   STATUS_SEED=<seed> npx vitest run src/lib/domain/__tests__/tournament-status-agrees.test.ts
 */

const SEED = Number(process.env.STATUS_SEED ?? Date.now() % 2_147_483_647);
const RUNS = 400;

/** mulberry32 — small, seedable, good enough to shake facts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFacts(next: () => number): TournamentFacts {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const bool = (p = 0.5) => next() < p;
  const n = (max: number) => Math.floor(next() * (max + 1));
  const family = pick(FAMILIES);
  const base = FAMILY_FIXTURES[family]();
  const status = family === "casual" ? pick(["live", "live", "completed"]) : pick(["draft", "draft", "draft", "live", "completed"]);
  const rounds: RoundFacts[] = base.rounds.map((r) => ({
    ...r,
    scorable: bool(0.9),
    scheduled: bool(0.7),
    cutFed: r.drawsPairings && bool(0.2),
    matches: r.drawsPairings || r.type === "Single Match Stage" ? pick([0, r.matches, r.matches]) : 0,
    hasResult: bool(0.4),
    closed: bool(0.4),
  }));
  for (const r of rounds) r.matchesOver = Math.min(r.matches, n(r.matches));
  if (bool(0.2)) rounds.push(round({ id: `x${rounds.length}`, position: rounds.length, scheduled: bool(), hasResult: bool(0.3), closed: bool(0.3) }));
  const groups = pick([0, 0, 1, 2, 4]);
  return {
    ...base,
    status,
    // The kind (PR 3): a league stays one; anything else is sometimes CALLED one.
    league: base.league || bool(0.1),
    configUnlocked: bool(0.2),
    named: bool(0.85),
    dated: bool(0.85),
    venued: bool(0.7),
    moneyAnswered: bool(0.7),
    flightsConfirmed: bool(0.2),
    playSuspended: bool(0.1),
    confirmed: pick([0, 1, 2, 3, 8, 28]),
    groups,
    unplacedInFlights: groups > 0 ? pick([0, 0, 1, 3]) : 0,
    teams: bool(0.3) ? { needed: true, sides: pick([0, 2, 4]), unsided: pick([0, 0, 1]) } : base.teams,
    cup: base.cup ? { flights: pick([0, 2, 2, 3]), unplaced: pick([0, 0, 1]) } : null,
    rounds,
    missingCards: bool(0.15) ? [{ stageId: rounds[0]?.id ?? "r1", label: rounds[0]?.label ?? "Round 1", course: "Invented Links" }] : [],
    knockout: base.knockout
      ? {
          draws: base.knockout.draws.map((d) => ({ ...d, entrants: pick([1, 2, 5, 8]), finalDecided: bool(0.5) })),
          thirdPlace: { on: bool(0.3), decided: bool(0.5) },
        }
      : null,
    cupDecided: base.cup ? pick([null, false, true]) : null,
    review: { pendingConfirmations: pick([0, 0, 1, 3]), disputed: pick([0, 0, 0, 1]) },
    correction: bool(0.1) ? { scope: pick(LOCK_SCOPES), by: "A. Organizer", reason: "An invented correction", until: "2026-11-03" } : null,
  };
}

describe(`the machine agrees with itself (seed ${SEED})`, () => {
  const next = rng(SEED);
  const cases = Array.from({ length: RUNS }, () => randomFacts(next));

  it(`holds every invariant on ${RUNS} random tournaments`, () => {
    cases.forEach((f, i) => {
      const at = `seed ${SEED}, case ${i} — replay with STATUS_SEED=${SEED}`;
      const st = tournamentStatus(f);
      const launched = isLaunched(f.status);

      // One button, and only a casual round has none.
      expect(st.nextAction === null, at).toBe(tournamentFamily(f) === "casual");
      const a = st.nextAction;
      if (a) {
        const own = a.kind === "launch" || a.kind === "complete" || a.kind === "reopen" ? st.refusals[a.kind] : null;
        expect(a.enabled, `${at}: enabled must equal its refusal being null`).toBe(own === null);
        expect(a.disabledBecause, at).toBe(a.enabled ? null : own);
        if (!a.enabled) {
          expect(a.disabledBecause?.length ?? 0, at).toBeGreaterThan(0);
          expect(a.wayOut?.href ?? "", `${at}: a refused ${a.kind} carries a way out`).toMatch(/^\//);
          expect(a.wayOut?.says ?? "", at).not.toBe("");
        }
      }

      // Setting up exactly when not launched; then setup is done exactly when launch is allowed (D1, D4).
      expect(st.step === "setting-up", at).toBe(!launched);
      if (!launched && tournamentFamily(f) !== "casual") {
        expect(st.setup.current === null, `${at}: setup.current ${st.setup.current?.key} vs launch refusal ${st.refusals.launch}`).toBe(
          st.refusals.launch === null,
        );
        for (const step of st.setup.steps) if (step.holds) expect(step.done, at).toBe(false);
      }

      // Play over offers Complete (D3).
      if (st.step === "play-over") expect(a?.kind, at).toBe("complete");

      // Results before launch: under way, and the journey is Play (D2).
      if (!launched && f.rounds.some((r) => r.hasResult)) {
        expect(st.underWayUnlaunched, at).toBe(true);
        expect(st.journey, at).toBe("play");
      }

      // A lock says why and how out; only launch and the draw are correctable.
      for (const scope of LOCK_SCOPES) {
        const l = st.locks[scope];
        if (!l.locked) continue;
        expect(l.because, at).toMatch(/^Locked because /);
        expect(l.wayOut.says, at).not.toBe("");
        expect(l.wayOut.href, at).toMatch(/^\//);
        expect(l.correctable, at).toBe(l.by === "launch" || l.by === "draw");
      }

      // The chip leads with the step's word.
      const word = { "setting-up": "Setting up", live: "Live", "play-over": "Play over", completed: "Completed" }[st.step];
      expect(st.chip.startsWith(word), at).toBe(true);
    });
  });

  it("is a function of the facts: the same facts give the same answer", () => {
    for (const f of cases.slice(0, 50)) expect(tournamentStatus(structuredClone(f)), `seed ${SEED}`).toEqual(tournamentStatus(f));
  });
});
