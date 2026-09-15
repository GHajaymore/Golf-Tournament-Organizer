import { describe, it, expect } from "vitest";
import {
  lifecycleMismatch,
  nextLifecycleAction,
  resultsIn,
  tournamentPhase,
  isLaunched,
  isFinished,
  configurationLocked,
  PRE_LAUNCH_STATUSES,
  LAUNCH_DOES,
  VISIBILITY_IS_ELSEWHERE,
} from "@/lib/domain/lifecycle-state";
import { readSource } from "@/lib/__tests__/source";

const facts = (over: Partial<Parameters<typeof lifecycleMismatch>[0]> = {}) => ({
  status: "draft",
  resultsIn: 0,
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
    const w = lifecycleMismatch(facts({ resultsIn: 40 }));
    expect(w?.title).toMatch(/40 results are in/);
    // That launching is what to offer here is `nextLifecycleAction`'s answer
    // now, and is asserted against it below rather than against a boolean this
    // function set to true and nothing read.
    expect(nextLifecycleAction({ status: "draft", resultsIn: 40 })?.kind).toBe("launch");
  });

  it("flags it from any of the pre-launch statuses, not just draft", () => {
    // Not because launch gates anything — it does not, see below — but
    // because "registration" and "ready" are just as far from saying "this
    // tournament is live" as "draft" is, and results have arrived in all three.
    for (const status of ["draft", "registration", "ready"]) {
      expect(lifecycleMismatch(facts({ status, resultsIn: 1 })), status).not.toBeNull();
    }
  });

  it("says nothing once the tournament is live or finished", () => {
    for (const status of ["live", "completed"]) {
      expect(lifecycleMismatch(facts({ status, resultsIn: 40 })), status).toBeNull();
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
    const w = lifecycleMismatch(facts({ resultsIn: 40 }));
    expect(w?.detail).toMatch(/already open the board and their card/);
    expect(w?.detail).toMatch(/32 in the field/);
    // And that nothing is broken meanwhile — scoring works either way.
    expect(w?.detail).toMatch(/Scoring works either way/);
    // And that it cannot quietly re-acquire the claim it just lost.
    expect(w?.detail).not.toMatch(/can’t see/);
  });

  it("reads properly for a single result", () => {
    expect(lifecycleMismatch(facts({ resultsIn: 1 }))?.title).toMatch(/1 result is in/);
  });

  it("gives the chip something truer than the stored status", () => {
    /**
     * "TOURNAMENT STATUS: Draft" sat an inch above this warning's own title
     * saying 47 results were in. The chip is what a reader takes away, and it
     * was the one part of the card still claiming nothing had happened.
     */
    expect(lifecycleMismatch(facts({ resultsIn: 47 }))?.chip).toBe("Being played");
  });

  it("copes with results but no field, without claiming a player count", () => {
    // Possible with placeholder entries removed after scoring. Saying "the 0
    // in the field have no way to follow it" would be nonsense.
    const w = lifecycleMismatch(facts({ resultsIn: 3, playersEntered: 0 }));
    expect(w?.detail).toMatch(/anyone in the field can/);
    expect(w?.detail).not.toMatch(/\b0 in the field\b/);
  });
});

/**
 * WHAT COUNTS AS "SOMEBODY HAS PLAYED".
 *
 * The lifecycle warning was fed `matchProgress`, which counts the ACTIVE
 * STAGE's matches. Both halves of that were wrong for this question, and the
 * first is the one that made the warning fail silently rather than merely read
 * oddly.
 */
describe("how much golf has been played", () => {
  it("counts scorecards, so a stroke tournament is not invisible", () => {
    /**
     * THE BUG THIS CLOSES. A medal has no matches at all, so the old count was
     * 0 however many cards were in — and a stroke-play tournament played from
     * start to finish in `draft` was never warned once.
     *
     * Asserted through `lifecycleMismatch` as well as the count, because the
     * count being right is only interesting if the warning then fires.
     */
    const n = resultsIn({ matches: [], cards: [{}, {}, {}, {}, {}, {}, {}] });
    expect(n).toBe(7);
    expect(lifecycleMismatch(facts({ resultsIn: n }))).not.toBeNull();
  });

  it("counts both sources together", () => {
    // The demo tournament's real shape on 2026-09-14: 47 played matches on
    // round 1 and 7 cards on round 2, which is 54 results and not 47.
    expect(
      resultsIn({
        matches: Array.from({ length: 48 }, (_, i) => ({ played: i < 47 })),
        cards: Array.from({ length: 7 }, () => ({})),
      }),
    ).toBe(54);
  });

  it("does not count a match nobody has started", () => {
    // A generated but unplayed round robin is scheduled up front, so every
    // match exists from the moment the draw is made. Counting those would
    // report a tournament as under way the day it is created.
    expect(resultsIn({ matches: [{ played: false }, { played: false }], cards: [] })).toBe(0);
    expect(lifecycleMismatch(facts({ resultsIn: 0 }))).toBeNull();
  });
});

/**
 * ONE ANSWER TO "WHERE IS THIS TOURNAMENT", for the card and the chip.
 *
 * `TournamentJourney` computed this inline and `/dashboard` answered it
 * separately, and on the demo tournament they disagreed — the card said Play
 * and the chip said Draft.
 */
describe("which phase the tournament is in", () => {
  /**
   * TAKES THE STATUS NOW, not `launched` and `finished` as separate flags.
   *
   * Those were computed in `/event/page.tsx` and forwarded untouched through
   * `EventSetupClient`, so the rule about what "launched" means lived in a
   * page. It is derived here from `PRE_LAUNCH_STATUSES` — which also closes a
   * latent disagreement, since the hand-written pair was the INVERSE of that
   * list rather than the same rule, and a sixth status would have split them.
   */
  const p = (over: Partial<Parameters<typeof tournamentPhase>[0]> = {}) =>
    tournamentPhase({ status: "draft", scored: false, setupComplete: true, ...over });

  it("only calls it finished when somebody said so", () => {
    /**
     * The PR #361 fix, kept here now the rule has moved. One returned card
     * used to report a never-launched tournament as finished, so the card
     * ticked Launch and Play as done and told the organizer to settle the
     * money — on a tournament whose second round was in progress.
     */
    expect(p({ scored: true })).toBe("play");
    expect(p({ status: "live", scored: true })).toBe("play");
    expect(p({ status: "completed" })).toBe("results");
  });

  it("lets a result move it forward to play, and no further", () => {
    // The evidence route: a card that has come in means somebody is out there
    // whatever the status says.
    expect(p({ scored: true, status: "draft" })).toBe("play");
  });

  it("reads every pre-launch status as pre-launch, not just draft", () => {
    /**
     * The half the boolean could not express. `launched` arrived as one value
     * and this function could not tell "draft" from "registration" from
     * "ready" — they are all before the launch, and all three now reach here
     * intact. Worth asserting because the old hand-written pair tested for
     * live-or-completed, so anything NOT in that pair was pre-launch by
     * accident rather than by the list.
     */
    for (const status of PRE_LAUNCH_STATUSES) {
      expect(p({ status }), status).toBe("launch");
      expect(p({ status, setupComplete: false }), status).toBe("setup");
    }
  });

  it("waits for setup before offering launch", () => {
    expect(p({ setupComplete: false })).toBe("setup");
    expect(p({ setupComplete: true })).toBe("launch");
  });
});

/**
 * THE ONE NEXT STEP, so that three buttons stop competing.
 */
describe("what to do next", () => {
  it("offers launching, not entries, to a draft that is being played", () => {
    /**
     * The sharpest of the three defects. A tournament 47 results into being
     * played was offered "Start taking entries", because the ladder only asked
     * what the status was.
     */
    expect(nextLifecycleAction({ status: "draft", resultsIn: 47 })).toEqual({
      label: "Launch tournament",
      kind: "launch",
    });
  });

  it("still walks an unplayed tournament through its phases", () => {
    // The regression half — the branch above must not swallow the ordinary
    // path, which is what the lifecycle is for.
    expect(nextLifecycleAction({ status: "draft", resultsIn: 0 })?.label).toBe("Start taking entries");
    expect(nextLifecycleAction({ status: "registration", resultsIn: 0 })?.label).toBe("Mark ready");
    expect(nextLifecycleAction({ status: "ready", resultsIn: 0 })?.kind).toBe("launch");
    expect(nextLifecycleAction({ status: "live", resultsIn: 99 })?.label).toBe("Complete tournament");
  });

  it("has nothing left to offer a finished tournament", () => {
    expect(nextLifecycleAction({ status: "completed", resultsIn: 99 })).toBeNull();
  });

  it("only ever offers one thing", () => {
    // The shape of the fix, rather than any one branch of it: whatever the
    // state, this returns a single action or none. The dashboard reads it to
    // decide whether its own header still deserves a primary button, which
    // only works because there is exactly one answer.
    for (const status of ["draft", "registration", "ready", "live", "completed"]) {
      for (const n of [0, 1, 47]) {
        const a = nextLifecycleAction({ status, resultsIn: n });
        if (a) expect(typeof a.label, `${status}/${n}`).toBe("string");
      }
    }
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
    /**
     * THE WHOLE FUNCTION, not a fixed number of characters.
     *
     * This sliced 700 characters, which held the write until the launch gate
     * was added in front of it — and then the test failed because the code it
     * asserts about had moved, not because it had changed. A window measured
     * in characters is a window that closes on its own.
     */
    const action = src("src/app/actions/tournament.ts");
    const from = action.indexOf("export async function launchTournament");
    const after = action.indexOf("export async function", from + 1);
    const launch = action.slice(from, after === -1 ? undefined : after);
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

  /**
   * THE LIST GREW, because listing the known offenders is what let the third
   * one survive.
   *
   * This swept two files — the two that had been caught by hand in September.
   * `LifecycleBar`'s launch DIALOG was never in it, and so went on telling
   * organizers that "registered participants receive Player access and can
   * view their schedule, matches, scorecards, leaderboard and tournament
   * information" for as long as the other two were being corrected. It is the
   * worst place of the three to be wrong: it is the sentence somebody reads
   * while deciding whether to press the button.
   *
   * CLAUDE.md's rule, applied to this file: sweep the class, not the instance.
   */
  const LAUNCH_COPY = [
    "src/components/SetupFlowRail.tsx",
    "src/components/LifecycleBar.tsx",
    "src/lib/domain/lifecycle-state.ts",
  ];

  it("is one string, read by every screen that describes launching", () => {
    /**
     * The two sentences drifted for as long as both existed, which is what
     * `PRE_LAUNCH_STATUSES` above already exists to prevent for the status
     * list. Same fix, same reason.
     */
    for (const p of LAUNCH_COPY) {
      expect(src(p), `${p} does not read the shared sentence`).toMatch(/LAUNCH_DOES/);
    }
  });

  it("has no reader left claiming launch gates the field", () => {
    // Absence, which is the safe direction and comment-proof under readSource.
    for (const p of LAUNCH_COPY) {
      expect(src(p)).not.toMatch(/Nobody in the field can see/);
      expect(src(p)).not.toMatch(/can’t see their matches/);
      // The dialog's own wording of the same claim, pinned by the half that
      // was false. The Player ROLE is really granted — `launchTournament` runs
      // an `account.updateMany` — so it is the "and can view" that must stay
      // gone, not the mention of Player.
      expect(src(p), `${p} claims launch is what lets the field look`).not.toMatch(
        /Player access and can view/,
      );
    }
  });
});

/**
 * ONE DEFINITION OF "LAUNCHED", AND ONE OF "LOCKED".
 *
 * Seven places in `src` spelled `status === "live" || status === "completed"`
 * by hand, and four of those went on to `&& !configUnlocked` — which is
 * `isSetupLocked`, written out a fifth time in four other files. `page-helpers`
 * is `server-only`, so `LifecycleBar` could not have called the existing one
 * even if somebody had thought to; that is the mechanism, not carelessness.
 */
describe("what launched means, asked once", () => {
  it("is anything not on the pre-launch list", () => {
    for (const status of PRE_LAUNCH_STATUSES) expect(isLaunched(status), status).toBe(false);
    expect(isLaunched("live")).toBe(true);
    expect(isLaunched("completed")).toBe(true);
  });

  it("agrees with the pair it replaced, on every status that exists today", () => {
    /**
     * The control on the change. `isLaunched` is derived from the LIST and the
     * old code tested for the PAIR, so this asserts the two answer alike for
     * everything currently in play — a refactor that quietly moved a status
     * from one side to the other would show up here rather than on a screen.
     */
    for (const status of [...PRE_LAUNCH_STATUSES, "live", "completed"]) {
      const theOldWay = status === "live" || status === "completed";
      expect(isLaunched(status), status).toBe(theOldWay);
    }
  });

  it("and DIVERGES on a status nobody has added yet, which is the point", () => {
    /**
     * The reason this is a function rather than a tidier copy of the pair.
     * They are not the same rule: one is "not on the list", the other is "one
     * of these two". Add a sixth status — a paused or abandoned tournament —
     * and the list-based answer calls it launched while the pair calls it
     * pre-launch, silently, on whichever screens happened to use which.
     *
     * Asserting the divergence rather than the agreement, because the
     * agreement is the thing that made five copies survive this long.
     */
    // Typed as a plain string: narrowed to its literal, TypeScript refuses the
    // comparison below as provably false — which is true of the TYPE and is
    // exactly the runtime divergence being demonstrated.
    const invented: string = "abandoned";
    expect(PRE_LAUNCH_STATUSES).not.toContain(invented);
    expect(isLaunched(invented), "the list says launched").toBe(true);
    expect(invented === "live" || invented === "completed", "the old pair said not").toBe(false);
  });

  it("only calls it finished when the organizer said so", () => {
    expect(isFinished("completed")).toBe(true);
    for (const status of [...PRE_LAUNCH_STATUSES, "live"]) {
      expect(isFinished(status), status).toBe(false);
    }
  });
});

describe("what locked means, asked once", () => {
  it("is launched and not deliberately unlocked", () => {
    expect(configurationLocked({ status: "live", configUnlocked: false })).toBe(true);
    expect(configurationLocked({ status: "completed", configUnlocked: false })).toBe(true);
  });

  it("an organizer who unlocked it is not locked", () => {
    // The escape hatch, and the half a `status` check alone would lose.
    expect(configurationLocked({ status: "live", configUnlocked: true })).toBe(false);
  });

  it("a tournament that has not launched is never locked", () => {
    for (const status of PRE_LAUNCH_STATUSES) {
      expect(configurationLocked({ status, configUnlocked: false }), status).toBe(false);
    }
  });
});
