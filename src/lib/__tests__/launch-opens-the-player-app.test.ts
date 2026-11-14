import { describe, it, expect } from "vitest";
import { playerAppShut } from "../domain/lifecycle-state";

/**
 * LAUNCHING A TOURNAMENT OPENS IT TO ITS PLAYERS — and until 2026-09-23 it
 * did not.
 *
 * Launch moved `status` and locked setup. `isLaunched` was read in exactly two
 * places, both about locking SETUP, and in none about access — so a player
 * could open the board and their own card in a tournament that was never
 * launched, and a share link worked before the club considered it open.
 *
 * THE HARD PART IS THE OLD DATA, which is why this is a column and not a
 * behaviour change. Tournaments are being PLAYED IN DRAFT today, the seeded
 * Demo Cup among them. Ajay's call was to gate NEW tournaments only:
 * `accessGated` defaults true, and the migration backfilled false for every
 * tournament that already existed.
 *
 * ONE SETTING-UP STEP (Ajay, 2026-10-31, gap G1). Draft, registration and ready
 * now read as one, so the status cannot say "the club has opened this to its
 * players" any more — nobody presses "Start taking entries". The published
 * sign-up link says it: once entries are taken a player has something true to
 * be told (in, waiting, not entered — what `verify-player-states.mjs` protects),
 * and before that nobody should be in here.
 *
 * ONE STORED WORD (state machine PR 8, J14). Migration A045 moved every row
 * still holding one of the old ladder's two later words to `draft` and kept the
 * word in `legacyStatus`; a row that kept one stays open, as it was.
 */

const PRE = ["draft"];
const gated = (status: string, registrationOpen = false, legacyStatus = "") => ({ status, accessGated: true, registrationOpen, legacyStatus });
const legacy = (status: string) => ({ status, accessGated: false, registrationOpen: false, legacyStatus: "" });

describe("launching opens the player app", () => {
  it("shuts a new tournament while it is being set up and nobody can sign up", () => {
    expect(playerAppShut(gated("draft"), false)).toBe(true);
  });

  it("OPENS once entries are taken, which is when a player most wants it", () => {
    for (const s of PRE) expect(playerAppShut(gated(s, true), false), s).toBe(false);
  });

  it("keeps a row A045 moved open with no link: nothing members saw disappears (QA, 2026-10-31)", () => {
    // The old word is kept verbatim; either one was open to members. Nothing writes it any more.
    expect(playerAppShut(gated("draft", false, "registration"), false)).toBe(false);
    expect(playerAppShut(gated("draft", false, "ready"), false)).toBe(false);
  });

  it("reads a row from a client generated before A045 (no such field) as no old word — shut, never open", () => {
    const before = { status: "draft", accessGated: true, registrationOpen: false } as unknown as Parameters<typeof playerAppShut>[0];
    expect(playerAppShut(before, false)).toBe(true);
  });

  it("stays open once launched, and after it is over", () => {
    expect(playerAppShut(gated("live"), false)).toBe(false);
    expect(playerAppShut(gated("completed"), false)).toBe(false);
  });

  it("never shuts a tournament that predates the gate, whatever its status", () => {
    /**
     * THE CELL THE WHOLE DESIGN EXISTS FOR. Every tournament stored before
     * 2026-09-23 was backfilled to `accessGated: false`, because some of them
     * are being played in draft right now. If this ever goes red, somebody has
     * made the gate unconditional and a club is locked out of its own round.
     */
    for (const status of [...PRE, "live", "completed"]) {
      expect(playerAppShut(legacy(status), false), `${status} was shut`).toBe(false);
    }
  });

  it("never shuts STAFF, because that is when an organizer looks", () => {
    expect(playerAppShut(gated("draft"), true)).toBe(false);
    expect(playerAppShut(gated("draft", false, "ready"), true)).toBe(false);
  });
});
