import { describe, it, expect } from "vitest";
import {
  resultsIn,
  isLaunched,
  isFinished,
  PRE_LAUNCH_STATUSES,
  LAUNCH_DOES,
  VISIBILITY_IS_ELSEWHERE,
} from "@/lib/domain/lifecycle-state";
import { readSource } from "@/lib/__tests__/source";
import { setupLockedByLaunch, type Family } from "@/lib/domain/tournament-status";

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
     * start to finish in `draft` was never warned once. (The warning itself is
     * the machine's `underWayUnlaunched` now, pinned on a medal in draft with
     * cards in by `tournament-status.test.ts`, D5.)
     */
    const n = resultsIn({ matches: [], cards: [{}, {}, {}, {}, {}, {}, {}] });
    expect(n).toBe(7);
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
     * `status: "live"` and `launchedAt`. The lock is real — the machine's
     * `setupLockedByLaunch` reads the status — so it is the half worth
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
    expect(launch).toMatch(/launchedAt: new Date\(\)/);
    // The lock is the machine's (`setupLockedByLaunch`), not a flag launch writes (state machine PR 9b).
    expect(launch).not.toMatch(/configUnlocked/);
    // If a visibility flag is ever written here, this test should fail and the
    // sentence should be rewritten to match it.
    expect(launch).not.toMatch(/leaderboardVisibility/);
    expect(LAUNCH_DOES).toMatch(/locks the configuration/);
    // The refusal in `playRefusal` is the fact behind this sentence: no card is saved before launch.
    expect(LAUNCH_DOES).toContain("Players can score only once it is launched; each round is closed on its own.");
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

/**
 * WHAT LOCKED MEANS, ASKED ONCE — since state machine PR 9b the machine's
 * `setupLockedByLaunch(status, family)`: launched, and not a casual round
 * (proposal 8.2, "Casual: locks none"). It was `configurationLocked` here,
 * launched and not unlocked by the retired blanket flag. The whole table, family
 * by family and scope by scope, is `scoped-locks.test.ts` (B2).
 */
describe("what locked means, asked once", () => {
  const SETUP_FAMILIES: Family[] = ["stroke", "stableford", "match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup", "league"];

  it("is launched, for every family but a casual round", () => {
    for (const family of SETUP_FAMILIES) {
      expect(setupLockedByLaunch("live", family), family).toBe(true);
      expect(setupLockedByLaunch("completed", family), family).toBe(true);
    }
  });

  it("a casual round is never locked by launch — the half a status check alone would lose", () => {
    expect(setupLockedByLaunch("live", "casual")).toBe(false);
    expect(setupLockedByLaunch("completed", "casual")).toBe(false);
  });

  it("a tournament that has not launched is never locked", () => {
    for (const status of PRE_LAUNCH_STATUSES) {
      for (const family of [...SETUP_FAMILIES, "casual" as const]) expect(setupLockedByLaunch(status, family), `${status} ${family}`).toBe(false);
    }
  });
});
