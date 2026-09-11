import { describe, it, expect } from "vitest";
import { entryNeedsEmail, usesAccessCodes, usesEmailSignIn, DEFAULT_SETTINGS } from "../tournament-settings";
import { readSource } from "./source";
import { TOURNAMENT_TEMPLATES } from "../tournament-templates";

/**
 * A SOCIETY COULD NOT ENTER ITS OWN MEMBERS.
 *
 * Every organizer path into a field refused a blank address, with the reason
 * "it's how this player signs in". `/event` says of the access code, two
 * screens away, that it "exists because a society roster is often names and
 * nothing else, and chasing sixty people for an email before anyone can score
 * is not a workable ask" — and the society, league, member-guest and charity
 * templates all ship Round Codes for that reason.
 *
 * So the app told a society it did not need addresses and then demanded one
 * from every entrant. Walked 2026-09-11 on a fresh society sign-up.
 *
 * The identity was never the address: `createPlaySession` signs
 * `stageId:playerId:expiry:code`, and the draw, the handicaps, the leaderboard
 * and the money all key on `Player.id` / `Member.id`. Email is a CREDENTIAL,
 * and it is required exactly when it is the only way in.
 */

const withAccess = (playerAccess: string) => ({ ...DEFAULT_SETTINGS, playerAccess } as const);

describe("when an entry needs an email", () => {
  it("asks for one only when it is the only way in", () => {
    expect(entryNeedsEmail(withAccess("email"))).toBe(true);
    expect(entryNeedsEmail(withAccess("code"))).toBe(false);
    expect(entryNeedsEmail(withAccess("both"))).toBe(false);
  });

  it("is the exact complement of code access, never a second opinion", () => {
    /**
     * The two must not be able to disagree: a tournament that asks for an
     * address because codes are off, while codes are in fact on, would refuse
     * entries it has a sign-in for. Asserted over every value rather than the
     * three above, so a fourth `playerAccess` added later is covered.
     */
    for (const access of ["email", "code", "both"]) {
      const s = withAccess(access);
      expect(entryNeedsEmail(s), access).toBe(!usesAccessCodes(s));
    }
  });

  it("still asks the email-only tournament, which is the case it is right about", () => {
    // The control. A tournament with no codes has nothing else to sign anybody
    // in with, so an entry without an address really is unreachable — that was
    // always true and is not what changed.
    const emailOnly = withAccess("email");
    expect(usesEmailSignIn(emailOnly)).toBe(true);
    expect(usesAccessCodes(emailOnly)).toBe(false);
    expect(entryNeedsEmail(emailOnly)).toBe(true);
  });
});

describe("the templates this was blocking", () => {
  it("frees the society, league and charity days, and leaves the club medal asking", () => {
    /**
     * Read off the shipped templates rather than asserted in the abstract:
     * these are the tournaments real organizers create from the picker, and
     * they are the reason this was a bug rather than a preference.
     *
     * `club-championship` is named as the control on purpose. If a change to
     * the templates ever made every one of them code-based, the "frees" half
     * of this test would still pass while meaning nothing.
     */
    const freed: string[] = [];
    const asking: string[] = [];
    for (const t of TOURNAMENT_TEMPLATES) {
      if (t.blank || !t.settings?.playerAccess) continue;
      const s = { ...DEFAULT_SETTINGS, playerAccess: t.settings.playerAccess };
      (entryNeedsEmail(s) ? asking : freed).push(t.key);
    }
    expect(freed).toContain("league-round");
    expect(freed).toContain("charity-day");
    expect(asking).toContain("club-championship");
    // Both sides non-empty, so neither list can be passing by being everything.
    expect(freed.length).toBeGreaterThan(0);
    expect(asking.length).toBeGreaterThan(0);
  });
});

describe("the paths that ask", () => {
  /**
   * Read from source, because the rule is only worth anything where it is
   * actually consulted — and three of these four call sites cannot be reached
   * by a unit test without a database.
   */
  it("has all three organizer entry paths ask the tournament", () => {
    const actions = readSource("src", "app", "actions", "tournament.ts");
    const roster = readSource("src", "app", "actions", "roster.ts");
    // The by-hand add, and the entry CSV import.
    expect(actions.match(/entryNeedsEmail\(/g) ?? []).toHaveLength(2);
    // Adding from the club roster.
    expect(roster).toMatch(/needsEmail = entryNeedsEmail\(/);
    expect(roster).toMatch(/missingEmail = needsEmail &&/);
  });

  it("leaves open registration asking every stranger", () => {
    /**
     * DELIBERATELY NOT RELAXED, and the difference is not about identity.
     *
     * The public form rate-limits on the address
     * (`checkRateLimit("register-email", …)`), has nothing else to
     * de-duplicate a stranger on, and emails them a confirmation. An organizer
     * typing a name in is none of those: they are authenticated and holding
     * the list.
     *
     * Absence, which is the comment-proof direction — the prose above names
     * `entryNeedsEmail` and would satisfy a positive match happily.
     */
    expect(readSource("src", "app", "actions", "register.ts")).not.toMatch(/entryNeedsEmail/);
    expect(readSource("src", "lib", "domain", "registration-intake.ts")).toMatch(
      /if \(!email\) return \{ ok: false/,
    );
  });

  it("does not let the form contradict the rule", () => {
    // The screen marked the field "required, grants sign-in" and disabled its
    // Add button without one, on every tournament — so even with the server
    // relaxed, a society still could not type anybody in.
    const client = readSource("src", "components", "RegistrationClient.tsx");
    expect(client).toMatch(/needsEmail \? "· required, grants sign-in"/);
    expect(client).toMatch(/\(needsEmail && !email\.trim\(\)\)/);
    const page = readSource("src", "app", "(app)", "registration", "page.tsx");
    expect(page).toMatch(/needsEmail=\{entryNeedsEmail\(settingsOf\(state\.event\)\)\}/);
  });
});

describe("the empty-address hazard", () => {
  it("refuses to resolve a player from a blank address", () => {
    /**
     * `where: { email: { equals: "" } }` does not mean "no rows" — it means
     * every entry without an address. That set was empty until this change, so
     * the query could not misfire; the consequence if it ever did is not a
     * blank screen but one signed-in player being handed every email-less
     * player's card, score entry and money.
     *
     * Pinned from source rather than called, because `myPlayerIds` needs a
     * database — and what is being guarded is that the refusal comes FIRST,
     * before the query, which a return value could not show.
     */
    const me = readSource("src", "lib", "services", "me.ts");
    const fn = me.slice(me.indexOf("export async function myPlayerIds"));
    const guard = fn.indexOf('if (!email.trim()) return new Set();');
    const query = fn.indexOf("prisma.player.findMany");
    expect(guard).toBeGreaterThan(-1);
    expect(guard, "the guard must come before the query").toBeLessThan(query);
  });
});
