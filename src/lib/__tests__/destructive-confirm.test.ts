import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * NOTHING IRREVERSIBLE HAPPENS ON ONE TAP.
 *
 * The money ledger's Remove asked twice and nothing else did, so the same
 * fault was sitting on ten screens at once: an unlabelled trash or ×, often a
 * thumb's width from a harmless control, wired straight to an action that
 * destroys a record with no undo.
 *
 * THIS FILE'S FIRST VERSION MISSED FOUR OF THEM, both ways it could:
 *
 *   - It carried a HAND LIST of destructive actions. The app exports 24 and
 *     the list named 14, so `removeSkinsPot` — a pot people have paid into —
 *     was never looked for. The list is now read from `src/app/actions`, so a
 *     new `deleteWhatever` is covered the day it is written.
 *   - It only matched an action called INSIDE the `onClick`. `TeeEditor` calls
 *     `deleteTee` from a local `remove()` helper and the sweep walked straight
 *     past it, as it did for the honours board and for staff access. One level
 *     of local indirection is resolved now.
 *
 * That is the failure mode worth naming: a guard that reports green over four
 * live instances is worse than no guard, because it is evidence.
 *
 * WHAT THIS CANNOT DO is prove the confirmation is any good. It proves the
 * action is not reachable from a bare `onClick`. The two-tap behaviour itself
 * is pinned end-to-end, where a click can actually happen.
 */

const COMPONENTS = "src/components";
const ACTIONS = "src/app/actions";

/** The verbs that mean a row stops existing. */
const DESTRUCTIVE_VERB = /^(?:delete|remove|purge|wipe|discard|clear)[A-Z]/;

/**
 * Every destroying action the app exports, read from the actions directory.
 *
 * Derived rather than listed, because a list is a thing to remember and this
 * one was already forgotten once — see the note above. A new destructive
 * action joins the rule by existing.
 */
function destructiveActions(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"))) {
    const src = readSource(ACTIONS, file);
    for (const m of src.matchAll(/export async function (\w+)/g)) {
      if (DESTRUCTIVE_VERB.test(m[1])) names.add(m[1]);
    }
  }
  return names;
}

/**
 * Call sites that are RIGHT to fire without a second press.
 *
 * This list is why the sweep is safe to have. A guard that refuses a
 * legitimate case gets weakened or deleted and takes the real cases with it,
 * so every entry names WHY, and a new one should have to argue in review.
 *
 * Judged by opening each, not by the verb in its name: "remove" covers both
 * `removeFundLine`, which is a money line gone for good, and
 * `removeTeamMember`, which is re-added in a tap.
 */
const EXEMPT: Record<string, string> = {
  StagesClient: "removeStage IS the confirm on an expanded cost warning naming what goes with it",
  EventSwitcher: "deleteEvent is the armed half of an existing two-tap row",
  RosterClient: "deleteMember is disabled for anyone with entries; the rest is a plain re-add",
  RegistrationClient: "bulk Remove asks in a dialog about withdrawals; the other site is Decline, beside Accept",
  TeamsClient: "removeTeamMember is re-added in a tap — a confirmation there would be noise",
  ClearScores: "the whole component IS the confirmation, with the cards named",
  ScoreEntryClient: "clearMatch sits behind its own explicit are-you-sure step",
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
 * Local helpers that call one of these actions, so `onClick={() => remove(id)}`
 * counts as reaching it.
 *
 * A brace-depth walk rather than a parser: it only has to find
 * `const name = (…) => { … destructiveCall() … }`, which is how every one of
 * these is written. Over-reporting is the safe direction here — the cost is an
 * EXEMPT entry with a reason, not a destroyed row.
 */
function localHelpersReaching(src: string, actions: string[]): Set<string> {
  const found = new Set<string>();
  let current: string | null = null;
  let depth = 0;
  for (const line of src.split("\n")) {
    const decl = line.match(/^\s*const (\w+) = (?:\(|async \()/);
    if (decl && current === null) {
      current = decl[1];
      depth = 0;
    }
    if (current === null) continue;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (actions.some((a) => new RegExp(`\\b${a}\\s*\\(`).test(line))) found.add(current);
    if (depth <= 0 && /\};?\s*$/.test(line)) current = null;
  }
  return found;
}

/** `file:line action` for every onClick that reaches a destroying action. */
function unguardedSites(file: string, destructive: Set<string>): string[] {
  const src = readSource(COMPONENTS, file);
  const imported = importedActions(src);
  const direct = [...destructive].filter((a) => imported.has(a));
  if (direct.length === 0) return [];

  const reachable = [...direct, ...localHelpersReaching(src, direct)];
  const lines = src.split("\n");
  const hits: string[] = [];
  lines.forEach((line, i) => {
    // An onClick can open on an earlier line than the call it wraps.
    const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (!/onClick\s*=/.test(window)) return;
    for (const a of reachable) {
      if (new RegExp(`\\b${a}\\s*\\(`).test(line)) hits.push(`${file}:${i + 1} ${a}`);
    }
  });
  return hits;
}

describe("a destructive control never fires on one tap", () => {
  it("reads its list of destroying actions from the actions themselves", () => {
    // The hand list missed ten of these, so the derivation is the fix and is
    // worth pinning: an empty or tiny set would make the sweep below vacuous.
    const actions = destructiveActions();
    expect(actions.size).toBeGreaterThan(15);
    // Named because each was missed by the hand list and is genuinely destructive.
    expect(actions.has("removeSkinsPot")).toBe(true);
    expect(actions.has("deleteTee")).toBe(true);
    expect(actions.has("removeAccount")).toBe(true);
    expect(actions.has("removeFromHonours")).toBe(true);
  });

  it("routes every destroying action through a confirmation", () => {
    const destructive = destructiveActions();
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      if (EXEMPT[file.replace(/\.tsx$/, "")]) continue;
      offenders.push(...unguardedSites(file, destructive));
    }

    expect(
      offenders,
      `these destroy a record straight from an onClick, with no undo:\n  ${offenders.join(
        "\n  ",
      )}\nUse <ConfirmButton>, or add the component to EXEMPT with a reason.`,
    ).toEqual([]);
  });

  it("has an exemption list that still describes real components", () => {
    // An exemption for a component that no longer exists is a hole nobody can
    // see: rename the file and the rule silently stops applying to it.
    const files = new Set(componentFiles().map((f) => f.replace(/\.tsx$/, "")));
    for (const name of Object.keys(EXEMPT)) {
      expect(files.has(name), `EXEMPT names ${name}, which is not a component`).toBe(true);
    }
  });

  it("sees through one level of local indirection", () => {
    /**
     * The miss that mattered. `TeeEditor` reaches `deleteTee` through a local
     * `remove()`, and the first version of this sweep — which only matched a
     * call inside the onClick itself — reported green over it, over the
     * honours board and over staff access.
     */
    const src = [
      'import { deleteTee } from "@/app/actions/courses";',
      "  const remove = (id: string) => {",
      "    startTransition(async () => {",
      "      const res = await deleteTee(id);",
      "    });",
      "  };",
      "  <button onClick={() => remove(t.id)} />",
    ].join("\n");

    const helpers = localHelpersReaching(src, ["deleteTee"]);
    expect(helpers.has("remove"), "a helper wrapping a destroying action was not recognised").toBe(true);
  });
});
