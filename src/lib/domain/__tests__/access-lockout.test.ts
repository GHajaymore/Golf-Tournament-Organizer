import { describe, it, expect } from "vitest";
import { lockoutRefusal } from "../access-lockout";
import { readSource } from "../../__tests__/source";

/**
 * ONE DROPDOWN THAT COULD SIGN A FIELD OUT MID-ROUND.
 *
 * Entries may be made with no email address on a tournament that signs players
 * in by Round Code, and the society and charity templates ship exactly that
 * setting. Switching `playerAccess` away from codes revokes every code, and
 * email sign-in cannot let those players back in because they have no address.
 *
 * The tests that matter are the ones asserting it does NOT fire. A refusal on
 * a change that is perfectly safe is the thing that teaches an organizer to
 * stop reading them.
 */

const input = (over: Partial<Parameters<typeof lockoutRefusal>[0]> = {}) => ({
  wasUsingCodes: true,
  nowUsingCodes: false,
  strandedCount: 3,
  ...over,
});

describe("turning Round Codes off", () => {
  it("refuses while anybody would be stranded", () => {
    const r = lockoutRefusal(input());
    expect(r).toContain("3 players");
    // Says what happens, not just that it is refused — "would withdraw every
    // code" is the part that makes the refusal believable.
    expect(r).toMatch(/lock them out/i);
  });

  it("counts in English for one player", () => {
    /**
     * "1 players have no email address" is the shape that makes somebody stop
     * trusting the sentence, and a one-player case is not a corner: a single
     * unaddressed guest in a field of forty is the commonest way this fires.
     */
    const r = lockoutRefusal(input({ strandedCount: 1 }))!;
    expect(r).toContain("1 player in this tournament has");
    expect(r).not.toContain("players");
    expect(r).not.toContain("have no email");
  });

  it("names where to fix it", () => {
    // A refusal that does not say what to do next makes the app the obstacle.
    // Both ways out, because either is legitimate.
    const r = lockoutRefusal(input())!;
    expect(r).toContain("Registration & field");
    expect(r).toMatch(/leave access codes on/i);
  });

  it("says that people already out on the course are included", () => {
    /**
     * The consequence an organizer cannot see from the settings screen, and
     * the reason this is a refusal rather than a warning: the damage lands on
     * other people, mid-round, and the organizer has no way to look at who.
     */
    expect(lockoutRefusal(input())).toMatch(/out on the course/i);
  });
});

describe("when it stays out of the way", () => {
  it("never fires when nobody would be stranded", () => {
    /**
     * THE ORDINARY CASE, and the one this must not touch: a club growing out
     * of Round Codes whose entrants all have addresses switches freely.
     */
    expect(lockoutRefusal(input({ strandedCount: 0 }))).toBeNull();
  });

  it("never fires when codes were not in use to begin with", () => {
    // Nothing to revoke, so nothing to lose.
    expect(lockoutRefusal(input({ wasUsingCodes: false }))).toBeNull();
  });

  it("never fires when codes stay on", () => {
    /**
     * Every OTHER setting on that screen goes through the same action — the
     * scoring basis, the tee policy, whether the leaderboard is public. A rule
     * that fired on any save would block all of them for a society that
     * entered its field by name, which is the society this exists to protect.
     */
    expect(lockoutRefusal(input({ nowUsingCodes: true }))).toBeNull();
    expect(lockoutRefusal(input({ wasUsingCodes: true, nowUsingCodes: true }))).toBeNull();
  });

  it("never fires on a negative or nonsense count", () => {
    expect(lockoutRefusal(input({ strandedCount: -1 }))).toBeNull();
  });
});

describe("where it is enforced", () => {
  it("runs inside the action, before anything is written", () => {
    /**
     * ORDER IS THE ASSERTION. Refusing after `event.update` would leave the
     * settings saved and the codes revoked — the exact damage — while telling
     * the organizer it had not happened, which is worse than not refusing at
     * all.
     */
    const src = readSource("src", "app", "actions", "settings.ts");
    const fn = src.slice(src.indexOf("export async function saveTournamentSettings"));
    const refusal = fn.indexOf("lockoutRefusal(");
    const write = fn.indexOf("prisma.event.update(");
    const revoke = fn.indexOf("revokeRoundCodes(eventId)");
    expect(refusal, "saveTournamentSettings no longer calls lockoutRefusal").toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(write);
    expect(refusal).toBeLessThan(revoke);
  });

  it("counts the stranded entrants from the rows, not from the caller", () => {
    // A `"use server"` export is a public HTTP endpoint. A count arriving in
    // the payload would be a number the caller chose.
    const src = readSource("src", "app", "actions", "settings.ts");
    expect(src).toMatch(/prisma\.player\.count\(/);
    expect(src).toMatch(/status: \{ not: "withdrawn" \}/);
  });
});
