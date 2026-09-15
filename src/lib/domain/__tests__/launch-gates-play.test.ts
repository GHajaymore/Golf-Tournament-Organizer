import { describe, it, expect } from "vitest";
import { playRefusal } from "../phase-gate";
import { PRE_LAUNCH_STATUSES } from "../lifecycle-state";

/**
 * LAUNCH IS A GATE NOW, AND IT WAS NOT ONE.
 *
 * "Set up → launch → play → finish", and the file those phases are declared in
 * says the rule plainly: guide within a phase, gate between them. Launch was
 * the one transition with no gate at all — it set a status, locked the
 * configuration and promoted accounts to `player`, and then a tournament left
 * in draft played a full round with nothing but a dashboard banner to say its
 * status was out of date.
 *
 * THE EXEMPTION IS THE WHOLE REASON THIS COULD SHIP. The deferred register has
 * carried this as "blocked on old data" since it was written, because turning
 * the gate on retroactively would lock live players out of rounds they are in
 * the middle of — and a player on the 14th green cannot launch anything, so
 * the remedy would not be theirs. A tournament already under way keeps going.
 */

describe("a tournament that has not started refuses a score", () => {
  it("refuses on every pre-launch status", () => {
    // Swept from the list rather than naming "draft", so a fourth pre-launch
    // status added later is gated the day it is added.
    for (const status of PRE_LAUNCH_STATUSES) {
      expect(playRefusal({ status, anyResult: false }), status).toBeTruthy();
    }
    expect(PRE_LAUNCH_STATUSES.length, "the sweep has nothing to sweep").toBeGreaterThan(1);
  });

  it("names the remedy and who can apply it", () => {
    /**
     * Every refusal names its remedy — the rule at the top of `phase-gate.ts`.
     * This one has to name the PERSON too: the player who hits it cannot
     * launch a tournament, and a refusal that does not say so reads as the app
     * being broken.
     */
    const refusal = playRefusal({ status: "draft", anyResult: false })!;
    expect(refusal).toMatch(/launch/i);
    expect(refusal, "does not say who can fix it").toMatch(/organi[sz]er/i);
  });
});

describe("a tournament already under way is not stopped halfway", () => {
  it("allows a score once anything has been played", () => {
    for (const status of PRE_LAUNCH_STATUSES) {
      expect(
        playRefusal({ status, anyResult: true }),
        `${status} with results in was locked retroactively`,
      ).toBeNull();
    }
  });

  it("which is the difference the register was blocked on", () => {
    // The two cases side by side, because the pair IS the decision: you cannot
    // START play without launching, and starting is the only thing gated.
    expect(playRefusal({ status: "draft", anyResult: false })).toBeTruthy();
    expect(playRefusal({ status: "draft", anyResult: true })).toBeNull();
  });
});

describe("a launched tournament is never gated", () => {
  it("lets play through whatever else is true", () => {
    for (const anyResult of [true, false]) {
      expect(playRefusal({ status: "live", anyResult })).toBeNull();
      expect(playRefusal({ status: "completed", anyResult })).toBeNull();
    }
  });

  it("the control: these statuses are genuinely not pre-launch", () => {
    /**
     * Without this the block above passes on a typo. If "live" were ever
     * listed as pre-launch, every assertion here would still read as proof
     * that a launched tournament is ungated.
     */
    expect(PRE_LAUNCH_STATUSES).not.toContain("live");
    expect(PRE_LAUNCH_STATUSES).not.toContain("completed");
  });
});
