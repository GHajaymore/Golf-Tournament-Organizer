import { describe, it, expect } from "vitest";
import {
  entryNeedsEmail,
  usesAccessCodes,
  usesEmailSignIn,
  DEFAULT_SETTINGS,
  type TournamentSettings,
} from "../tournament-settings";
import { readSource } from "./source";
import { TOURNAMENT_TEMPLATES } from "../tournament-templates";
import { contactGap } from "../domain/registration-intake";

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

/**
 * Typed as the union rather than `string`, so the loops below cannot quietly
 * assert about a `playerAccess` the app does not have.
 */
const ACCESS_VALUES = ["email", "code", "both"] as const;
type Access = (typeof ACCESS_VALUES)[number];
const withAccess = (playerAccess: Access): TournamentSettings => ({ ...DEFAULT_SETTINGS, playerAccess });

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
    for (const access of ACCESS_VALUES) {
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
      const s: TournamentSettings = { ...DEFAULT_SETTINGS, playerAccess: t.settings.playerAccess };
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
   * SINCE 2026-11-07 NO ORGANIZER DOOR REFUSES AN ENTRY FOR WANT OF AN EMAIL.
   *
   * Ajay's ruling on the no-email player identity: members may enter without
   * one, guests need none. What this block used to pin — "an email-only
   * tournament refuses a blank address" — was the right answer to the old
   * rule and is now the defect. The guarantee is the other half of the same
   * idea it always protected (nobody is entered with no way to their card):
   * an entry without an email on an email-only tournament turns Round Codes on
   * beside email sign-in, in ONE place, `codesOnForAnEntryWithoutEmail`, and
   * all three organizer doors go through it.
   *
   * Read from source because three of the four call sites cannot be reached by
   * a unit test without a database.
   */
  it("has all three organizer entry paths turn codes on rather than refuse", () => {
    const actions = readSource("src", "app", "actions", "tournament.ts");
    const roster = readSource("src", "app", "actions", "roster.ts");
    // The by-hand add, and the entry CSV import.
    expect(actions.match(/codesOnForAnEntryWithoutEmail\(/g) ?? []).toHaveLength(2);
    // Adding from the club roster.
    expect(roster.match(/codesOnForAnEntryWithoutEmail\(/g) ?? []).toHaveLength(1);
    // And the sink really asks the tournament before switching anything: a
    // tournament already on codes is left alone.
    const service = readSource("src", "lib", "services", "round-codes.ts");
    const sink = service.slice(service.indexOf("export async function codesOnForAnEntryWithoutEmail"));
    const body = sink.slice(0, sink.indexOf("\n}"));
    expect(body).toMatch(/usesAccessCodes\(cleanSettings\(event\)\)\) return false/);
    expect(body).toMatch(/playerAccess: "both"/);
    expect(body).toMatch(/ensureRoundCodes\(eventId\)/);
    // The roster's contact needs no longer carry an email at all.
    const rosterService = readSource("src", "lib", "services", "roster.ts");
    const needs = rosterService.slice(rosterService.indexOf("export async function entryContactNeeds"));
    expect(needs.slice(0, needs.indexOf("\n}"))).not.toMatch(/email/);
  });

  it("refuses a roster member for a missing mobile only, never a missing email", () => {
    // Behaviour, not spelling: the rule the roster path and the picker share.
    const blank = { email: "", phone: "" };
    expect(contactGap(blank, { phone: false })).toBeNull();
    expect(contactGap(blank, { phone: true })).toBe("mobile");
    // CONTROL: a member with a real mobile and no email passes where a mobile is asked.
    expect(contactGap({ phone: "07700 900123" }, { phone: true })).toBeNull();
  });

  it("leaves open registration asking every stranger", () => {
    /**
     * DELIBERATELY NOT RELAXED, and the difference is not about identity.
     *
     * The public form rate-limits on the address
     * (`checkRateLimit("register-email", …)`), has nothing else to
     * de-duplicate a stranger on, and emails them a confirmation. An organizer
     * typing a name in is none of those: they are authenticated and holding
     * the list. (Guests entering themselves on the link is a later change of
     * the no-email design, behind the organizer's own switch.)
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
    // The Add form says email is optional, and its button does not wait for one.
    const client = readSource("src", "components", "RegistrationClient.tsx");
    expect(client).toMatch(/· optional, lets them sign in/);
    expect(client).not.toMatch(/needsEmail && !email\.trim\(\)/);
    expect(client).not.toMatch(/required=\{needsEmail\}/);
    // The page still tells the screen how the tournament signs players in, for the contact-gap line.
    const page = readSource("src", "app", "(app)", "registration", "page.tsx");
    expect(page).toMatch(/needsEmail=\{entryNeedsEmail\(settingsOf\(state\.event\)\)\}/);
  });

  it("keeps no copy of the refusal anywhere", () => {
    /**
     * The refusal was written twice once — in the action and in `submitAdd` —
     * and the client copy outlived the server's relaxing (walked 2026-09-11).
     * Now it is written nowhere, and this is the sweep that keeps it that way.
     */
    for (const parts of [
      ["src", "app", "actions", "tournament.ts"],
      ["src", "components", "RegistrationClient.tsx"],
      ["src", "app", "actions", "roster.ts"],
      ["src", "components", "RosterPicker.tsx"],
      ["src", "lib", "plans.ts"],
      ["src", "lib", "services", "player-access.ts"],
    ] as const) {
      expect(readSource(...parts), parts.join("/")).not.toMatch(/"Email is required/);
    }
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
