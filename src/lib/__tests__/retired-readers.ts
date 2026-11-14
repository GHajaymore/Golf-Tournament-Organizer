import ts from "typescript";

/**
 * THE STATE MACHINE'S RETIRED READERS — ONE LIST, read by every sweep that keeps them out
 * (state machine PR 9a, 14 Nov). Until 9a the names lived in three files
 * (`the-tournament-is-asked-one-way`, `the-actions-ask-the-machine`,
 * `the-timeline-reads-the-machine`), each its own copy: a sweep with three copies of its own
 * rule is the fault it exists to catch. Add a name HERE, in the class that says what it is.
 */

/**
 * CLASS A — GONE. Deleted, and the name may appear NOWHERE as an identifier: not imported,
 * not declared, not destructured out of an `await import`, not called — in `src` (tests
 * included), `e2e` or `scripts`. A comment or a string naming one is not an identifier, so
 * the history that explains a deletion stays readable.
 *
 * Joining in the second half of 9a, when the file their deletion edits is no longer held by
 * another open pull request: `playOverOf` (`tournament-switcher.test.ts`, #1149) and
 * `setupFactsFor` (`tournament-facts.ts`, #1144). In 9b: `configurationLocked`,
 * `setConfigUnlocked`, `configUnlocked`.
 */
export const GONE = [
  // PR 3 (4 Nov)
  "setupFlowFor",
  "isUnstarted",
  // PR 4 (6 Nov)
  "playRefusalFor",
  // PR 5b (7 Nov)
  "isSetupLocked",
  "assertUnlocked",
  "lockedRefusal",
  // PR 5c (7 Nov)
  "roundNeeds",
  // PR 9a (14 Nov): the dead twins, with their types
  "nextLifecycleAction",
  "LifecycleAction",
  "tournamentPhase",
  "TournamentPhase",
  "lifecycleMismatch",
  "LifecycleFacts",
  "LifecycleWarning",
  "datesPassedUnlaunched",
  "launchCheckFor",
] as const;

/**
 * CLASS B — MACHINE ONLY. Live, but asked only by the machine (`domain/tournament-status.ts`)
 * and by the old modules among themselves: the proposal's "the old modules keep only what the
 * state machine itself calls". Anybody else asks `tournamentStatus(facts)`. Their unit tests
 * are not swept for this class — they pin each rule to the Rules of Golf.
 */
export const MACHINE_ONLY = [
  "setupFlow",
  "launchCheck",
  "launchRefusal",
  "launchFactsFrom",
  "finishRefusal",
  "completingCheckFor",
  "completingRoundsCheck",
  "playRefusal",
  "statusMove",
  "EVENT_STATUSES",
  "PRE_LAUNCH_STATUSES",
] as const;

/** Who may import or call a class-B name: the machine and the old modules. */
export const MACHINE_OWNERS: readonly string[] = [
  "src/lib/domain/tournament-status.ts",
  "src/lib/domain/lifecycle-state.ts",
  "src/lib/domain/phase-gate.ts",
  "src/lib/domain/setup-flow.ts",
  "src/lib/domain/launch-check.ts",
];

/**
 * Exact exceptions to class B, each with its reason. A fourth file is a decision for the
 * tournament director, not an edit; an exception that no longer holds fails with "delete it".
 */
export const MACHINE_ONLY_EXCEPTIONS: Readonly<Record<string, { names: readonly string[]; reason: string }>> = {
  "src/lib/domain/tournament-name.ts": {
    names: ["PRE_LAUNCH_STATUSES"],
    reason: "builds 'which statuses hold a name' from the list — a second use of the list, not a second reading of the step",
  },
};

/** "Where is this tournament", as the readers before the machine answered it. */
export const WHERE_IT_IS_READERS = [
  "nextLifecycleAction",
  "tournamentPhase",
  "lifecycleMismatch",
  "datesPassedUnlaunched",
  "playOverOf",
  "setupChecklist",
  "isUnstarted",
] as const;

/** The readers PR 4 retired from the action files (`the-actions-ask-the-machine.test.ts`). */
export const RETIRED_BY_PR4 = ["launchCheckFor", "statusMove", "finishRefusal", "completingCheckFor", "playRefusalFor", "playRefusal"] as const;

/**
 * Every old reader a SCREEN or component may not import (`the-tournament-is-asked-one-way.test.ts`
 * since PR 3): the ones above, the lock readers, and the stored-status lists.
 */
export const OLD_READERS = [
  ...WHERE_IT_IS_READERS,
  "setupFlowFor",
  "launchCheckFor",
  "finishRefusal",
  "completingCheckFor",
  "statusMove",
  "playRefusal",
  "playRefusalFor",
  "configurationLocked",
  "isSetupLocked",
  "assertUnlocked",
  "lockedRefusal",
  "PRE_LAUNCH_STATUSES",
  "EVENT_STATUSES",
] as const;

/** `const { a, b: c } = await import("…")` — the pattern a module is taken apart with at run time. */
function fromAwaitImport(pattern: ts.ObjectBindingPattern): boolean {
  const decl = pattern.parent;
  if (!ts.isVariableDeclaration(decl) || !decl.initializer) return false;
  const init = decl.initializer;
  return ts.isAwaitExpression(init) && ts.isCallExpression(init.expression) && init.expression.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.(m|c)?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Every identifier in a file whose name is one of `names`, by the TypeScript parser — so a
 * comment, a string, a template or a regular expression naming one is not counted, and a
 * declaration, a destructured `await import` and a renamed import are. Files that do not
 * contain a name at all are not parsed.
 */
export function identifiersIn(path: string, text: string, names: readonly string[]): string[] {
  const wanted = names.filter((n) => text.includes(n));
  if (wanted.length === 0) return [];
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, scriptKind(path));
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && wanted.includes(node.text)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

/**
 * The class-B names a file ASKS: imports one (static, renamed, or destructured from an
 * `await import`) or calls one by name. A property of that name on something else
 * (`flow.launchCheck`) is not asking the rule.
 */
export function asksOf(path: string, text: string, names: readonly string[]): string[] {
  const wanted = names.filter((n) => text.includes(n));
  if (wanted.length === 0) return [];
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const found = new Set<string>();
  const want = (n: string | undefined) => {
    if (n && wanted.includes(n)) found.add(n);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportSpecifier(node)) want((node.propertyName ?? node.name).text);
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && fromAwaitImport(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key)) want(key.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) want(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}
