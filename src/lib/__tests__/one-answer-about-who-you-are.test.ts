import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A SERVER ACTION AUTHORIZES ON WHO YOU ARE, NEVER ON WHAT YOU ARE PREVIEWING.
 *
 * A session carries two roles: `role` is the account's real standing, and
 * `viewRole` is the same unless an admin has flipped the dashboard's
 * "Viewing as" toggle. They give OPPOSITE answers for an organizer previewing
 * as a player.
 *
 * Measured on 2026-09-12: fifteen checks across twelve files asked `role` and
 * four across four files asked `viewRole` — all four the newer AI features
 * (card reading, contests, drafting, setup suggestion). `card-photo.ts` asked
 * both, in sibling actions that do the same kind of work. So the same
 * organizer, mid-preview, was refused by four actions and allowed by fifteen,
 * with nothing on screen explaining why.
 *
 * Standardised on `role` on 2026-09-23. `messaging.ts` had already written the
 * rule the rest now follow: "Preview is a display setting; who you are in a
 * conversation is not." Neither reading was a security hole, which is why this
 * was a recorded inconsistency rather than a bug — the fix removes a surprise
 * rather than adding a restriction.
 *
 * SWEPT FROM THE FILESYSTEM rather than from a list, because the four that
 * drifted were the four written most recently. A hand-maintained list of
 * actions to check is a list that the next new action is not on — the same
 * reasoning `e2e/layout.spec.ts` gives for walking routes from disk.
 *
 * REPLACES `which-role-an-action-asks.test.ts`, which pinned the split by name
 * while the question was open and said so: "Whoever settles the question
 * deletes this test." It held two hand-maintained lists of filenames, which
 * were the right instrument for keeping an open question from drifting and the
 * wrong one for a settled rule — a new action is on neither list.
 *
 * ONE THING IT PINNED IS DELIBERATELY NOT CARRIED OVER. `card-photo.ts` reads
 * a course card under `role !== "admin"`, admin ONLY, where its two sibling
 * actions allow assistants. That is a question about WHICH STAFF may do a
 * thing, not about whether a preview toggle decides it, and it was left alone
 * rather than swept up in a change about something else. If it is ever
 * settled, it is settled on its own terms.
 */

const ACTIONS_DIR = join(process.cwd(), "src", "app", "actions");

function actionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });
}

describe("a server action authorizes on who you are", () => {
  it("no action decides what a person MAY DO from the preview toggle", () => {
    const offenders: string[] = [];

    for (const file of actionFiles(ACTIONS_DIR)) {
      const src = readFileSync(file, "utf8");
      // Only the authorization shape: comparing viewRole against a staff role.
      // Reading it to decide what to SHOW is legitimate and untouched.
      const guards = src.match(/session\.viewRole\s*[!=]==\s*"(admin|assistant|player)"/g);
      if (guards) offenders.push(`${file.replace(process.cwd(), "")}: ${guards.join(", ")}`);
    }

    expect(
      offenders,
      `these authorize on the preview toggle rather than on the account:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("and the actions really are reached by this sweep", () => {
    /**
     * THE CONTROL, and the reason it is here: a sweep that finds nothing
     * because it is looking in the wrong place reports exactly the same clean
     * result as one that finds nothing because nothing is wrong. Asserting a
     * known positive in the same run is the cheap way to tell those apart.
     */
    const files = actionFiles(ACTIONS_DIR);
    expect(files.length, "no action files found — the sweep is looking in the wrong place").
      toBeGreaterThan(10);

    const joined = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(joined, "the sweep cannot see the staff checks it is about").toMatch(
      /session\.role\s*!==\s*"admin"/,
    );
  });
});
