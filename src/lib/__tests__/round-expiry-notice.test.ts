import { describe, it, expect } from "vitest";
import { expiryNotice, hoursLeft, isExpired, QUICK_ROUND_TTL_HOURS } from "@/lib/domain/round-expiry";
import { readSource } from "./source";

/**
 * The people whose scores are about to go, and what they are told.
 *
 * A casual round deletes itself about a day after it is set up, and the whole
 * justification for that being acceptable is that the people it belongs to are
 * told BEFORE it happens. Two things were wrong with that:
 *
 * The warning rendered only on /dashboard, and `landingScreenFor` sends every
 * player to /me. So in an Ada-versus-Bo round the person who set it up was
 * warned and their opponent was not, and the other three of a fourball lost
 * the card with no notice at all.
 *
 * And the sentence names a button. `keepRound` is staff-only and refuses
 * everybody else by name, so "Keep it to hold on to the scores" was an
 * instruction a player could not follow, about scores they were about to lose.
 */
describe("what a casual round tells the people in it", () => {
  it("names the button for whoever can press it", () => {
    expect(expiryNotice(6, true)).toContain("Keep it to hold on to the scores");
  });

  it("names the remedy a player actually has", () => {
    const s = expiryNotice(6, false);
    expect(s).toContain("Ask whoever set it up");
    // Not the button. `keepRound` refuses them, so this would be an
    // instruction that fails when followed.
    expect(s).not.toContain("Keep it to hold on to");
  });

  it("still warns the player, which is the half that must never be hidden", () => {
    // The button is the part they cannot use; the sentence is the part they
    // need. An empty string here is scheduled data loss nobody consented to.
    expect(expiryNotice(6, false)).toContain("deleted");
    expect(expiryNotice(0, false)).toContain("deleted");
  });

  it("says nothing at all about a tournament, to either of them", () => {
    // `hoursLeft` is null for every tournament that has ever existed, and an
    // empty notice is what stops the banner mounting.
    expect(expiryNotice(null, true)).toBe("");
    expect(expiryNotice(null, false)).toBe("");
  });

  it("keeps the no-countdown rule for both readers", () => {
    /**
     * The sweep runs once a day, so a round that expires at 07:00 is not
     * actually removed until the next pass. "Deleted in about 7 hours" would
     * be a promise the app cannot keep, and the person who believes the
     * precise version is the person who waits.
     */
    for (const canKeep of [true, false]) {
      expect(expiryNotice(7, canKeep)).not.toMatch(/\b7\b/);
      expect(expiryNotice(7, canKeep)).toContain("about a day");
    }
  });

  it("changes its first half, not its second, once the day has gone", () => {
    expect(expiryNotice(0, false)).toContain("passed its day");
    expect(expiryNotice(0, false)).toContain("Ask whoever set it up");
  });
});

/**
 * And the banner has to be ON the screen a player lands on.
 *
 * A pure test of the wording cannot see that — it passed for the whole time
 * the warning was rendering on a screen no player ever reaches.
 */
describe("where the warning renders", () => {
  it("is on the player's own screen, worded for a player", () => {
    const me = readSource("src/app/(player)/me/page.tsx");
    expect(me).toMatch(/<RoundExpiryBanner/);
    expect(me).toMatch(/expiryNotice\(hoursLeft\(state\.event\), false\)/);
    expect(me).toMatch(/canKeep=\{false\}/);
  });

  it("is still on the console, worded for whoever can keep it", () => {
    const dash = readSource("src/app/(app)/dashboard/page.tsx");
    expect(dash).toMatch(/expiryNotice\(hoursLeft\(event\), isStaff\)/);
  });
});

/** The rules underneath it, unchanged — the control on everything above. */
describe("the expiry rule itself", () => {
  it("is a stored column and never inferred", () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
    expect(isExpired({})).toBe(false);
    expect(hoursLeft({ expiresAt: null })).toBeNull();
  });

  it("never promises time that has already gone", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    // Fifty minutes left rounds DOWN to nought, not up to one hour.
    expect(hoursLeft({ expiresAt: new Date("2026-06-01T12:50:00Z") }, now)).toBe(0);
    expect(hoursLeft({ expiresAt: new Date("2026-06-01T11:00:00Z") }, now)).toBe(0);
    expect(hoursLeft({ expiresAt: new Date("2026-06-02T12:00:00Z") }, now)).toBe(QUICK_ROUND_TTL_HOURS);
  });
});
