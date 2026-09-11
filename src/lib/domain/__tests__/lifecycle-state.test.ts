import { describe, it, expect } from "vitest";
import { lifecycleMismatch, LAUNCH_DOES, VISIBILITY_IS_ELSEWHERE } from "@/lib/domain/lifecycle-state";
import { readSource } from "@/lib/__tests__/source";

const facts = (over: Partial<Parameters<typeof lifecycleMismatch>[0]> = {}) => ({
  status: "draft",
  matchesScored: 0,
  playersEntered: 32,
  ...over,
});

describe("when the status disagrees with the tournament", () => {
  it("says nothing about a draft that has not started", () => {
    // The ordinary case, and the reason this checks results rather than
    // status alone: a draft with no scores is exactly what a draft is.
    expect(lifecycleMismatch(facts())).toBeNull();
  });

  it("flags results recorded before the tournament was launched", () => {
    const w = lifecycleMismatch(facts({ matchesScored: 40 }));
    expect(w?.title).toMatch(/40 results are in/);
    expect(w?.offerLaunch).toBe(true);
  });

  it("flags it from any of the pre-launch statuses, not just draft", () => {
    // Launch is the gate on player access, so "registration" and "ready" leave
    // the field just as locked out as "draft" does.
    for (const status of ["draft", "registration", "ready"]) {
      expect(lifecycleMismatch(facts({ status, matchesScored: 1 })), status).not.toBeNull();
    }
  });

  it("says nothing once the tournament is live or finished", () => {
    for (const status of ["live", "completed"]) {
      expect(lifecycleMismatch(facts({ status, matchesScored: 40 })), status).toBeNull();
    }
  });

  it("explains the consequence rather than just naming the mismatch", () => {
    /**
     * The point of the warning. "Status is draft" is a fact about a database
     * column; what it costs is the thing an organizer needs to know.
     *
     * REWORDED, NOT RELAXED. This used to pin "can’t see their matches", and
     * that sentence was false — measured on 2026-09-11, signed in as a player
     * on a `draft` tournament, where `/me/board` rendered the standings and
     * `/me/card` offered to certify. The assertion follows the corrected rule:
     * the cost is a tournament calling itself a draft in front of people who
     * can already read it.
     */
    const w = lifecycleMismatch(facts({ matchesScored: 40 }));
    expect(w?.detail).toMatch(/already open the board and their card/);
    expect(w?.detail).toMatch(/32 in the field/);
    // And that nothing is broken meanwhile — scoring works either way.
    expect(w?.detail).toMatch(/Scoring works either way/);
    // And that it cannot quietly re-acquire the claim it just lost.
    expect(w?.detail).not.toMatch(/can’t see/);
  });

  it("reads properly for a single result", () => {
    expect(lifecycleMismatch(facts({ matchesScored: 1 }))?.title).toMatch(/1 result is in/);
  });

  it("copes with results but no field, without claiming a player count", () => {
    // Possible with placeholder entries removed after scoring. Saying "the 0
    // in the field have no way to follow it" would be nonsense.
    const w = lifecycleMismatch(facts({ matchesScored: 3, playersEntered: 0 }));
    expect(w?.detail).toMatch(/anyone in the field can/);
    expect(w?.detail).not.toMatch(/\b0 in the field\b/);
  });
});

/**
 * AND THE CLAIM IS TIED TO WHAT LAUNCHING ACTUALLY WRITES.
 *
 * Two screens told the organizer the field was locked out until launch:
 *
 *   lifecycle-state  "Players can't see their matches, their card or the
 *                     leaderboard until it is"
 *   SetupFlowRail    "Nobody in the field can see any of it yet … that is what
 *                     opens their schedule, their card and the leaderboard"
 *
 * Measured on 2026-09-11, signed in as a player on a tournament whose status
 * was `draft`: `/me` rendered, `/me/board` rendered the standings, `/me/card`
 * rendered a full scorecard offering "Certify my card".
 *
 * It matters more than a wrong sentence usually would, because an organizer
 * who believes it will leave a half-built tournament open on the reasoning
 * that nobody can see it. They can.
 *
 * These assert the claim against the CODE rather than against itself, so the
 * sentence cannot drift back to describing a gate that does not exist.
 */
describe("what the app says launching does", () => {
  const src = (p: string) => readSource(p);

  it("claims only the two things launchTournament writes", () => {
    /**
     * `status: "live"`, `launchedAt`, `configUnlocked: false`. The lock is
     * real — `isSetupLocked` reads exactly that — so it is the half worth
     * saying, and the only half.
     */
    const action = src("src/app/actions/tournament.ts");
    const launch = action.slice(
      action.indexOf("export async function launchTournament"),
      action.indexOf("export async function launchTournament") + 700,
    );
    expect(launch).toMatch(/status: "live"/);
    expect(launch).toMatch(/configUnlocked: false/);
    // If a visibility flag is ever written here, this test should fail and the
    // sentence should be rewritten to match it.
    expect(launch).not.toMatch(/leaderboardVisibility/);
    expect(LAUNCH_DOES).toMatch(/locks the configuration/);
  });

  it("points at the setting that really decides what the field sees", () => {
    // `canSeeLeaderboard` reads `leaderboardVisibility` and nothing else.
    const settings = src("src/lib/tournament-settings.ts");
    const fn = settings.slice(
      settings.indexOf("export function canSeeLeaderboard"),
      settings.indexOf("export function isLeaderboardPublic"),
    );
    expect(fn).toMatch(/leaderboardVisibility/);
    expect(fn).not.toMatch(/status/);
    expect(VISIBILITY_IS_ELSEWHERE).toMatch(/Who can see the leaderboard/);
  });

  it("is one string, read by both screens", () => {
    /**
     * The two sentences drifted for as long as both existed, which is what
     * `PRE_LAUNCH_STATUSES` above already exists to prevent for the status
     * list. Same fix, same reason.
     */
    for (const p of ["src/components/SetupFlowRail.tsx", "src/lib/domain/lifecycle-state.ts"]) {
      expect(src(p), `${p} does not read the shared sentence`).toMatch(/LAUNCH_DOES/);
    }
  });

  it("has no reader left claiming launch gates the field", () => {
    // Absence, which is the safe direction and comment-proof under readSource.
    for (const p of ["src/components/SetupFlowRail.tsx", "src/lib/domain/lifecycle-state.ts"]) {
      expect(src(p)).not.toMatch(/Nobody in the field can see/);
      expect(src(p)).not.toMatch(/can’t see their matches/);
    }
  });
});
