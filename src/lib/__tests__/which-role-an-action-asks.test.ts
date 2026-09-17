import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * WHICH ROLE A SERVER ACTION ASKS ABOUT, PINNED WHILE THE QUESTION IS OPEN.
 *
 * A session carries two:
 *
 *   role      the account's real standing in this tournament
 *   viewRole  that, unless an admin has switched the dashboard's
 *             "Viewing as — Organizer / Assistant / Player" toggle, in which
 *             case it is whatever they are previewing as
 *
 * So an organizer previewing as a player has `role: "admin"` and
 * `viewRole: "player"`, and the two checks give OPPOSITE answers for them.
 *
 * The actions disagree about which to ask. Measured 2026-09-12: fifteen checks
 * across twelve files ask `role`, four across four files ask `viewRole` — and
 * `card-photo.ts` asks both, in three sibling actions that all read a
 * photograph with the model:
 *
 *   readScorecardPhoto    viewRole, admin or assistant
 *   readGroupCardPhoto    viewRole, admin or assistant
 *   readCourseCardPhoto   role,     admin ONLY
 *
 * NEITHER IS A HOLE. The person is an admin either way and can switch the
 * toggle back in one click, so this is an inconsistency in behaviour rather
 * than a way in. But it is a real one: the same organizer, mid-preview, is
 * refused by four actions and allowed by fifteen, and nothing on screen
 * explains why.
 *
 * This file does NOT decide it — see `docs/deferred-register.md`, which sets
 * out what each answer would cost. It pins the split so it cannot drift
 * further while the question is open, and so that whoever settles it has a
 * list rather than a search.
 */

const ACTIONS = join("src", "app", "actions");

/** Files whose authorization reads `viewRole` — the preview-aware check. */
const ASKS_VIEW_ROLE = ["card-photo.ts", "contests.ts", "draft-message.ts", "setup-suggest.ts"];

/** Files whose authorization reads `role` — the account's real standing. */
const ASKS_REAL_ROLE = [
  "attendance.ts",
  "card-photo.ts",
  "commentary.ts",
  "courses.ts",
  // Nominating a week's pairs is a captain's list entered by staff, and it reads
  // the account's real standing exactly as teams.ts does — the two screens do
  // the same kind of work to the same rows.
  "league.ts",
  "money-setup.ts",
  "roster.ts",
  "round-expiry.ts",
  "series.ts",
  "settings.ts",
  "teams.ts",
  "tee-sheet.ts",
  "tournament.ts",
];

const actionFiles = () =>
  readdirSync(join(process.cwd(), ACTIONS))
    .filter((f) => f.endsWith(".ts"))
    .sort();

const asks = (file: string, which: "role" | "viewRole") =>
  new RegExp(`session(\\?)?\\.${which} !== "`).test(readSource(join(ACTIONS, file)));

describe("which role an action asks about", () => {
  it("is exactly the split recorded above — no more, no fewer", () => {
    /**
     * Both directions, so the list cannot rot in either: a file that starts
     * asking `viewRole` appears here, and a file that stops shows up as a
     * stale entry. Whoever settles the question deletes this test; until then
     * it keeps the count honest.
     */
    const view = actionFiles().filter((f) => asks(f, "viewRole"));
    const real = actionFiles().filter((f) => asks(f, "role"));
    expect(view, "an action changed which role it asks about — update the register entry").toEqual(
      [...ASKS_VIEW_ROLE].sort(),
    );
    expect(real, "an action changed which role it asks about — update the register entry").toEqual(
      [...ASKS_REAL_ROLE].sort(),
    );
  });

  it("still has one file asking both, which is the clearest symptom", () => {
    // If this ever goes green because `card-photo.ts` settled on one, the
    // question has been answered for at least one file and the register entry
    // should say so.
    expect(asks("card-photo.ts", "role") && asks("card-photo.ts", "viewRole")).toBe(true);
  });

  /**
   * A THIRD CELL WAS WRITTEN HERE AND REMOVED, because measuring it showed the
   * premise was wrong. It asserted that every `"use server"` file reads one
   * role or the other, and five did not: `handicap-policy.ts` asks
   * `requireClub`, `organization.ts` asks `organizationAccess` about
   * owner/admin/member — an entirely different axis from a tournament role —
   * `side-games.ts` and `skins.ts` ask `requirePotAccess` about a group's own
   * money, and `match-setup.ts` creates a person's own casual round, where no
   * tournament role exists yet.
   *
   * So "every action reads a role" is not true and should not be. Whether an
   * action is authorized AT ALL is `audit-idor.test.ts`'s job and it already
   * covers these. Keeping the cell would have meant five exemptions explaining
   * that the rule does not apply — which is a rule that does not apply.
   */
});
