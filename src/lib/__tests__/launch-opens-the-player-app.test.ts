import { describe, it, expect } from "vitest";
import { playerAppShut, isLaunched } from "../domain/lifecycle-state";

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
 * Demo Cup among them. A rule that simply read `!isLaunched(status)` would
 * have shut live players out of rounds they were halfway through. Ajay's call
 * was to gate NEW tournaments only: `accessGated` defaults true, and the
 * migration backfills false for every tournament that already existed.
 *
 * So the three cells that matter are the three states a real club is in:
 * a tournament created today and not yet launched (shut), the same one after
 * launch (open), and one that predates the gate (open whatever its status).
 */

const gated = (status: string) => ({ status, accessGated: true });
const legacy = (status: string) => ({ status, accessGated: false });

describe("launching opens the player app", () => {
  it("shuts a new tournament only while the club is still building it", () => {
    expect(playerAppShut(gated("draft"), false)).toBe(true);
  });

  it("OPENS during registration, which is when a player most wants it", () => {
    /**
     * THE CELL THAT CORRECTED THE DESIGN. The first attempt read
     * `!isLaunched(status)` — and pre-launch is THREE statuses, so it shut a
     * player out during registration, exactly when they want to see they are
     * in, or on the waiting list, or not entered.
     *
     * `verify-player-states.mjs` caught it: those three sentences are a rule
     * it exists to protect, and the gate was deleting them. Ajay narrowed the
     * gate to draft on 2026-09-23 rather than weaken that script.
     */
    expect(playerAppShut(gated("registration"), false)).toBe(false);
    expect(playerAppShut(gated("ready"), false)).toBe(false);
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
    for (const status of ["draft", "registration", "ready", "live", "completed"]) {
      expect(playerAppShut(legacy(status), false), `${status} was shut`).toBe(false);
    }
  });

  it("never shuts STAFF, because that is when an organizer looks", () => {
    // Checking the player app before launching is precisely the moment an
    // organizer opens it, so this is the point rather than an exception.
    expect(playerAppShut(gated("draft"), true)).toBe(false);
    expect(playerAppShut(gated("ready"), true)).toBe(false);
  });

  it("is NARROWER than not-launched, and that is the whole design", () => {
    /**
     * Pinned as a difference rather than as an agreement, because the obvious
     * refactor — "surely this is just `!isLaunched`" — is the bug that was
     * caught and backed out. Two of the three pre-launch statuses are open to
     * players; only `draft` is not.
     */
    const shutStatuses = ["draft", "registration", "ready", "live", "completed"].filter((s) =>
      playerAppShut(gated(s), false),
    );
    const unlaunched = ["draft", "registration", "ready", "live", "completed"].filter(
      (s) => !isLaunched(s),
    );
    expect(shutStatuses).toEqual(["draft"]);
    expect(unlaunched, "pre-launch really is three statuses").toEqual([
      "draft",
      "registration",
      "ready",
    ]);
    expect(shutStatuses).not.toEqual(unlaunched);
  });
});
