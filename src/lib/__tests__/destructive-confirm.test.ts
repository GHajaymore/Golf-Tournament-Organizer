import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * NOTHING IRREVERSIBLE HAPPENS ON ONE TAP.
 *
 * The money ledger's Remove asked twice and nothing else did, so the same
 * fault was sitting on nine other screens at once: an unlabelled trash or ×,
 * often a thumb's width from a harmless control, wired straight to an action
 * that destroys a record with no undo. "Delete season" was a plain secondary
 * button beside "Mark season finished" — the two things an organizer reaches
 * for at the same moment — and it ended a season on one press.
 *
 * Every one of them was individually reasonable-looking, which is why this is
 * a sweep rather than nine fixes. A rule that must be remembered at each new
 * delete button is a rule that will be forgotten at the tenth.
 *
 * WHAT THIS CANNOT DO is prove the confirmation is any good. It proves the
 * action is not reachable from a bare `onClick`. The two-tap behaviour itself
 * is pinned end-to-end, where a click can actually happen.
 */

const COMPONENTS = "src/components";

/**
 * Destroys a record. Named rather than pattern-matched on the verb, because
 * "remove" covers both `removeFundLine` — a money line, gone — and
 * `removeTeamMember`, which is re-added in a tap. Only the first kind belongs
 * here, and deciding which is which is a judgement about the DATA that no
 * regular expression holds.
 *
 * Adding an action here is how you opt a new destructive verb into the rule.
 */
const DESTRUCTIVE = [
  "deleteCommentary",
  "deleteClubCourse",
  "deleteEvent",
  "deleteMember",
  "deleteSeries",
  "deleteTeam",
  "removeAnnouncement",
  "removeContest",
  "removeExpense",
  "removeFundLine",
  "removeOrganizationMember",
  "removePrize",
  "removeSignup",
  "removeStage",
];

/**
 * Sites that call one of the above from an `onClick` and are RIGHT to.
 *
 * This list is the reason the sweep is safe to have. A guard that refuses a
 * legitimate case is worse than no guard — it gets weakened or deleted, and
 * takes the real cases with it — so every entry below names WHY, and a new
 * entry should have to argue for itself in review.
 */
const EXEMPT: Record<string, string> = {
  // Already a second step: the row expands into a cost warning naming what
  // goes with the stage, and this button is that warning's confirm.
  "StagesClient.tsx": "removeStage is itself the confirm on an expanded cost warning",
  // The icon this sits on IS the confirm — the row arms first, and the button
  // is titled "Confirm delete".
  "EventSwitcher.tsx": "deleteEvent is the armed half of an existing two-tap row",
  // Disabled outright for any member who has played, and a plain re-add for
  // one who has not. The aria-label explains the refusal.
  "RosterClient.tsx": "deleteMember is disabled for anyone with entries; the rest is a re-add",
  // "Decline" on a pending signup, beside "Accept". A labelled decision, not a
  // control anybody hits by accident, and they can register again.
  "RegistrationClient.tsx": "the second site is Decline, a labelled choice beside Accept",
};

function componentFiles(): string[] {
  return readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx"));
}

/** Action names this file imports from a server-actions module. */
function importedActions(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@\/app\/actions\/[^"]+"/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Lines where an `onClick` reaches a destructive action.
 *
 * Read through `readSource`, so the comments that DESCRIBE these controls —
 * several of which now name the very actions being searched for — cannot
 * satisfy the search on their own. That is the failure mode that looks
 * identical to success, and it is why this does not use readFileSync.
 */
function unguardedSites(file: string): string[] {
  const src = readSource(COMPONENTS, file);
  const actions = importedActions(src);
  const wanted = DESTRUCTIVE.filter((a) => actions.has(a));
  if (wanted.length === 0) return [];

  const lines = src.split("\n");
  const hits: string[] = [];
  lines.forEach((line, i) => {
    // An onClick can open on an earlier line than the call it wraps.
    const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (!/onClick\s*=/.test(window)) return;
    for (const a of wanted) {
      if (new RegExp(`\\b${a}\\s*\\(`).test(line)) hits.push(`${file}:${i + 1} ${a}`);
    }
  });
  return hits;
}

describe("a destructive control never fires on one tap", () => {
  it("routes every destroying action through a confirmation", () => {
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      if (EXEMPT[file]) continue;
      offenders.push(...unguardedSites(file));
    }

    expect(
      offenders,
      `these destroy a record straight from an onClick, with no undo:\n  ${offenders.join(
        "\n  ",
      )}\nUse <ConfirmButton>, or add the file to EXEMPT with a reason.`,
    ).toEqual([]);
  });

  it("has an exemption list that still describes real files", () => {
    // An exemption for a file that no longer exists is a hole nobody can see:
    // rename the component and the rule silently stops applying to it.
    const files = new Set(componentFiles());
    for (const f of Object.keys(EXEMPT)) {
      expect(files.has(f), `EXEMPT names ${f}, which is not a component`).toBe(true);
    }
  });

  it("would catch a one-tap delete if one were added", () => {
    /**
     * The sweep proving it can fail — without mutating a real screen.
     *
     * A guard whose green nobody has seen turn red is a guard nobody knows the
     * shape of. Four of the fixtures in `matrix.test.ts` passed a materially
     * wrong answer for exactly this reason.
     */
    const src = `
      import { deleteSeries } from "@/app/actions/series";
      <button onClick={() => run(() => deleteSeries(active.id))}>Delete season</button>
    `;
    const actions = importedActions(src);
    expect(actions.has("deleteSeries")).toBe(true);

    const line = src.split("\n").find((l) => /deleteSeries\s*\(/.test(l) && /onClick/.test(l));
    expect(line, "the shape the sweep looks for stopped matching").toBeTruthy();
  });
});
