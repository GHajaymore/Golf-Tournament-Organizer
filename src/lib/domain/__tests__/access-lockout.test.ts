import { describe, it, expect } from "vitest";
import { lockoutRefusal, lockoutNotice } from "../access-lockout";
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
    /**
     * A `"use server"` export is a public HTTP endpoint. A count arriving in
     * the payload would be a number the caller chose.
     *
     * The query MOVED to `services/round-codes.ts` when the settings screen
     * started showing the same warning before the change rather than after it.
     * The intent is unchanged and is asserted in both halves: the action asks
     * the server for the number, and the server gets it from the rows.
     */
    const action = readSource("src", "app", "actions", "settings.ts");
    expect(action, "the action no longer asks the server for the count").toMatch(
      /await strandedEntrantCount\(eventId\)/,
    );
    expect(action, "a count from the request payload would be the caller's number").not.toMatch(
      /strandedCount:\s*input\./,
    );

    const service = readSource("src", "lib", "services", "round-codes.ts");
    expect(service).toMatch(/prisma\.player\.count\(/);
    expect(service).toMatch(/status: \{ not: "withdrawn" \}/);
  });

  it("the screen and the refusal read ONE count", () => {
    /**
     * The whole reason the query is a function rather than two copies. The
     * settings screen warns before the change and the action refuses it after
     * — and a screen naming a different number from the refusal is worse than
     * either alone, because the organizer cannot tell which is true.
     *
     * This file's own history is the argument: a duplicated
     * `wasUsingCodes && !nowUsingCodes` in the caller once shadowed the real
     * rule and left a mutation green.
     */
    const page = readSource("src", "app", "(app)", "event", "page.tsx");
    expect(page, "the screen counts for itself instead of asking").toMatch(
      /strandedEntrantCount\(session\.eventId\)/,
    );
    expect(page).toMatch(/strandedCount=\{strandedCount\}/);
  });

  it("and ONE wording", () => {
    // `lockoutNotice` defers to `lockoutRefusal` rather than phrasing its own
    // sentence, so a screen cannot promise something the action refuses.
    const src = readSource("src", "lib", "domain", "access-lockout.ts");
    expect(src).toMatch(/export function lockoutNotice/);
    expect(src, "the notice writes its own sentence").toMatch(/return lockoutRefusal\(/);
  });
});

/**
 * THE WARNING THAT ARRIVES BEFORE THE CHOICE.
 *
 * `lockoutRefusal` is correct and late: an organizer picks "Email", saves, and
 * only then learns that forty entrants have no address and each needs one. The
 * count is on the server the whole time, so the cost can be stated while Round
 * Codes are still on and the choice is still open.
 */
describe("what the screen says before the dropdown is touched", () => {
  it("says nothing when every entrant has an address", () => {
    // The ordinary case, and the one a club growing out of Round Codes is in.
    expect(lockoutNotice({ usingCodes: true, strandedCount: 0 })).toBeNull();
  });

  it("says nothing when codes are already off", () => {
    // Nothing to withdraw, so nothing to warn about — and a warning here would
    // sit permanently on every email-sign-in tournament that ever used codes.
    expect(lockoutNotice({ usingCodes: false, strandedCount: 12 })).toBeNull();
  });

  it("names the number and the remedy while codes are still on", () => {
    const notice = lockoutNotice({ usingCodes: true, strandedCount: 12 })!;
    expect(notice).toContain("12 players");
    expect(notice, "does not say what to do about it").toMatch(/Registration & field/);
  });

  it("is the SAME sentence the refusal gives", () => {
    /**
     * Not a second wording for the same rule. A screen phrased separately from
     * the action it describes is how a warning comes to promise something the
     * refusal does not do — and this file exists because one rule with two
     * readers had already gone wrong here once.
     */
    for (const n of [1, 2, 12, 40]) {
      expect(lockoutNotice({ usingCodes: true, strandedCount: n })).toBe(
        lockoutRefusal({ wasUsingCodes: true, nowUsingCodes: false, strandedCount: n }),
      );
    }
  });

  it("gets the singular right, because a club of one reads it too", () => {
    const one = lockoutNotice({ usingCodes: true, strandedCount: 1 })!;
    expect(one).toContain("1 player in this tournament has");
    expect(one).not.toContain("players have");
  });
});
