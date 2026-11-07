import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { readSource } from "./source";

/**
 * NO READER DECIDES A HALVED MATCH ON THE TOURNAMENT'S CARD (J26, 2026-11-06).
 *
 * A halved match's "toughest N holes" countback, and the standings tiebreaker
 * that compares records on the hardest holes, rank holes by a stroke index —
 * and the index belongs to the course the match was PLAYED on. Three readers
 * (the standings in `loadEventState`, the week view, the head-to-head record),
 * and a fourth found doing it (the cut out of a match-play round, `regroup.ts`),
 * each handed every match the TOURNAMENT's stroke index, so an away match in a
 * league or interclub was decided on the home club's holes.
 *
 * One function answers it now: `matchCountbackIndex`, through
 * `countbackCardsFor` (services/course-resolution.ts), which takes the venue as
 * a required argument. This sweep reads every call of a function that decides a
 * match or ranks on the toughest holes, anywhere in `src` outside the domain
 * that defines them, and requires the card it is handed to BE that answer:
 * followed through locals (and through a tiebreak object's `strokeIndex`,
 * spreads included) to the expression it is bound to, which must be a call of
 * `countbackCardsFor(…)` or the state's `.countbackCardFor` — or a parameter of
 * a decider, whose own callers are swept. Anything else is refused, whatever it
 * is called: a tournament-level index (`resolveCourse(event).strokeIndex`,
 * `course.strokeIndex`, a round's `holeDifficulty`) in a local named
 * `countbackCard` is refused too (the review of #1045: the first version of
 * this sweep matched the NAME). Ban the shape, not the spelling.
 *
 * The CONTROL below feeds the checker the shapes the three readers had before
 * J26, the renamed one and the spread one, and requires it to flag each, so a
 * checker that sees nothing cannot pass.
 */

/** The functions that decide a match or rank on its toughest holes, and where each takes its card. */
const DECIDERS: Record<string, Array<{ arg: number; key?: "strokeIndex" }>> = {
  // (players, matches, scoring, carried, CARD, sequence)
  computeStandings: [{ arg: 4 }],
  // (rrStages, matches, players, scoring, CARD, sequence)
  chainRoundStandings: [{ arg: 4 }],
  // (players, stats, scoring, matches, CARD, { strokeIndex: CARD })
  rankPlayers: [{ arg: 4 }, { arg: 5, key: "strokeIndex" }],
  // (players, matches, scoring, carried, { strokeIndex: CARD })
  aggregateStats: [{ arg: 4, key: "strokeIndex" }],
  // (match, { strokeIndex: CARD })
  decidedOutcome: [{ arg: 1, key: "strokeIndex" }],
  // (holes, CARD, sequence)
  breakMatchTie: [{ arg: 1 }],
};

/** Where the deciders are defined and pass the card among themselves. */
const DEFINED_IN = new Set(["src/lib/domain/standings.ts", "src/lib/domain/match-tiebreak.ts"]);

/**
 * Exempt, each with the reason, and each re-read below so an exemption that no
 * longer calls a decider is noticed.
 */
const EXEMPT: Record<string, string> = {
  "src/lib/domain/match-entry.ts":
    "decides ONE match from the context its caller builds for that match (`MatchScoringContext.strokeIndex`); it has no production caller today",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

export interface CardCall {
  fn: string;
  line: number;
  card: string;
  ok: boolean;
}

/** Every decider call in `code`, with the expression it is handed as the card. */
export function cardCalls(code: string, fileName = "x.ts"): CardCall[] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Local `const x = …` initialisers, so a tiebreak object or a card held in a
  // local is followed to what it actually holds.
  const locals = new Map<string, ts.Expression>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) locals.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const follow = (e: ts.Expression, depth = 0): ts.Expression => {
    if (depth < 4 && ts.isIdentifier(e) && locals.has(e.text)) return follow(locals.get(e.text)!, depth + 1);
    return e;
  };
  /**
   * The expression that ends up as `obj[key]`, as JavaScript decides it: the
   * LAST of an explicit `key:` and any spread. A spread of a literal is read
   * through; a spread of anything else may carry its own `strokeIndex`, so the
   * spread itself becomes the card and is judged (and refused). Null only when
   * nothing in the object can set the key at all.
   */
  const propertyOf = (obj: ts.Expression, key: string, depth = 0): ts.Expression | null => {
    const o = follow(obj);
    if (!ts.isObjectLiteralExpression(o)) return o; // not a literal: judged whole
    let current: ts.Expression | null = null;
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === key) current = p.initializer;
      else if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) current = p.name;
      else if (ts.isSpreadAssignment(p)) {
        const spread = follow(p.expression);
        if (ts.isObjectLiteralExpression(spread) && depth < 4) {
          const inner = propertyOf(spread, key, depth + 1);
          if (inner) current = inner;
        } else {
          current = p.expression;
        }
      }
    }
    return current; // null: no card in the object, nothing to rank on
  };

  /**
   * An identifier the file never binds locally is acceptable only as a
   * PARAMETER of a function that is itself a decider (`chainRoundStandings`
   * passing its own `countbackCard` on): that function's callers are swept,
   * so the card is judged where it is made.
   */
  const isDeciderParameter = (id: ts.Identifier): boolean => {
    for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n) && n.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === id.text)) {
        const fnName = "name" in n && n.name && ts.isIdentifier(n.name as ts.Node) ? (n.name as ts.Identifier).text : "";
        return Object.hasOwn(DECIDERS, fnName);
      }
    }
    return false;
  };

  /**
   * THE SHAPE, NOT THE NAME. The card is followed to the expression it is
   * bound to, and that expression must BE the answer: a call of
   * `countbackCardsFor(…)`, or the state's `.countbackCardFor` (which
   * tournament.ts binds to that call — pinned below). A local merely NAMED
   * `countbackCard` holding the tournament's index is refused.
   */
  const isTheAnswer = (card: ts.Expression): boolean => {
    const x = follow(card);
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "countbackCardsFor") return true;
    if (ts.isPropertyAccessExpression(x) && x.name.text === "countbackCardFor") return true;
    if (ts.isIdentifier(x) && !locals.has(x.text)) return isDeciderParameter(x);
    return false;
  };

  const out: CardCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      for (const slot of Object.hasOwn(DECIDERS, name) ? DECIDERS[name] : []) {
        const arg = node.arguments[slot.arg];
        if (!arg) continue; // no card handed over at all: nothing ranked on one
        const card = slot.key ? propertyOf(arg, slot.key) : arg;
        if (!card) continue;
        const resolved = follow(card);
        const text = resolved.getText(sf);
        out.push({
          fn: name,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          card: text,
          ok: isTheAnswer(card),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("the card a halved match is decided on is the match's venue", () => {
  const SRC = join(process.cwd(), "src");
  const rel = (f: string) => relative(process.cwd(), f).replace(/\\/g, "/");
  const files = sourceFiles(SRC).filter((f) => !DEFINED_IN.has(rel(f)));
  const calls = files.flatMap((f) => cardCalls(readSource(rel(f)), f).map((c) => ({ ...c, file: rel(f) })));

  it("every reader hands a decider the match's own card (`countbackCardsFor`), never the tournament's", () => {
    const offending = calls
      .filter((c) => !c.ok && !(c.file in EXEMPT))
      .map((c) => `${c.file}:${c.line} ${c.fn}(… ${c.card} …)`);
    expect(
      offending,
      `these decide a halved match (or rank on the toughest holes) on a card that is not the match's venue — ` +
        `use countbackCardsFor / state.countbackCardFor:\n  ${offending.join("\n  ")}`,
    ).toEqual([]);
  });

  it("REACH: the sweep sees the four readers it exists for", () => {
    const readers = new Set(calls.filter((c) => c.ok).map((c) => c.file));
    for (const f of [
      "src/lib/services/tournament.ts",
      "src/lib/services/week-view.ts",
      "src/lib/services/head-to-head.ts",
      "src/lib/services/regroup.ts",
    ]) {
      expect(readers.has(f), `${f} hands a decider a card, and the sweep did not see it`).toBe(true);
    }
  });

  it("every exemption still calls a decider, for its stated reason", () => {
    for (const file of Object.keys(EXEMPT)) {
      expect(cardCalls(readSource(file), file).length, `${file} is exempt but no longer decides a match`).toBeGreaterThan(0);
    }
  });

  it("ONE function answers it: matchCountbackIndex is defined once, and countbackCardsFor calls it", () => {
    const defining = files.filter((f) => /export function matchCountbackIndex\(/.test(readSource(rel(f)))).map(rel);
    expect(defining).toEqual(["src/lib/services/course-resolution.ts"]);
    const resolution = readSource("src/lib/services/course-resolution.ts");
    const builder = resolution.slice(resolution.indexOf("export function countbackCardsFor("));
    expect(builder).toMatch(/matchCountbackIndex\(/);
    // …and it is the only place that builds the per-match card from venues.
    const others = files.filter((f) => rel(f) !== "src/lib/services/course-resolution.ts" && /matchCountbackIndex\(/.test(readSource(rel(f))));
    expect(others.map(rel)).toEqual([]);
  });

  it("CONTROL: the checker flags each shape the readers had before J26, and passes the right one", () => {
    // The head-to-head record, before.
    const h2h = `
      const tiebreak = { sequence: parse(x), strokeIndex: resolveCourse(state.event).strokeIndex };
      const outcome = decidedOutcome(m, tiebreak);`;
    // The standings in loadEventState, before.
    const standings = `
      const course = resolveCourse(event);
      const holeDifficulty = course.strokeIndex;
      overall = computeStandings(players, stageMatches, scoring, carryIn, holeDifficulty, matchTiebreakers);`;
    // The week view, before.
    const week = `chainRoundStandings(state.rrStages, state.matches, ps, sc, opts.holeDifficulty, seq);`;
    // A round's card is not a match's card either.
    const round = `computeStandings(p, m, s, {}, state.strokeCourseFor(id).holeDifficulty, seq);`;
    // THE RENAMED SHAPE (the review of #1045): the tournament's index under the right NAME.
    const renamed = `
      const countbackCard = resolveCourse(event).strokeIndex;
      chainRoundStandings(r, m, p, s, countbackCard, seq);`;
    const renamedInTiebreak = `
      const countbackCardFor = resolveCourse(state.event).strokeIndex;
      decidedOutcome(m, { sequence: s, strokeIndex: countbackCardFor });`;
    // A tiebreak object that SPREADS IN its own strokeIndex — with no key of its own…
    const spread = `
      const own = { strokeIndex: resolveCourse(state.event).strokeIndex };
      decidedOutcome(m, { sequence: s, ...own });`;
    // …over the right key (the spread comes last, so it wins)…
    const spreadOver = `
      const own = { strokeIndex: resolveCourse(state.event).strokeIndex };
      decidedOutcome(m, { sequence: s, strokeIndex: state.countbackCardFor, ...own });`;
    // …or of an object the checker cannot read, which may carry anything.
    const spreadUnknown = `decidedOutcome(m, { sequence: s, ...settingsOf(event) });`;
    // A bare parameter is only the answer inside a decider, whose callers are swept.
    const strayParam = `function rankAgain(p, m, countbackCard) { return computeStandings(p, m, s, {}, countbackCard, seq); }`;
    for (const [what, code] of Object.entries({ h2h, standings, week, round, renamed, renamedInTiebreak, spread, spreadOver, spreadUnknown, strayParam })) {
      const found = cardCalls(code);
      expect(found.length, `${what}: the checker did not see the call`).toBe(1);
      expect(found[0].ok, `${what}: the checker passed ${found[0].card}`).toBe(false);
    }
    const right = `
      const tiebreak = { sequence: s, strokeIndex: state.countbackCardFor };
      decidedOutcome(m, tiebreak);
      const countbackCard = countbackCardsFor(event, stages, matches, venueOf);
      chainRoundStandings(r, m, p, s, countbackCard, seq);
      decidedOutcome(m, { ...{ sequence: s }, strokeIndex: state.countbackCardFor });
      decidedOutcome(m, { strokeIndex: resolveCourse(e).strokeIndex, ...{ strokeIndex: state.countbackCardFor } });`;
    expect(cardCalls(right).map((c) => c.ok)).toEqual([true, true, true, true]);
    // A decider handing its OWN parameter on (chainRoundStandings in tournament.ts).
    const passedOn = `function chainRoundStandings(rr, ms, ps, sc, countbackCard, seq) { return computeStandings(ps, ms, sc, {}, countbackCard, seq); }`;
    expect(cardCalls(passedOn).map((c) => c.ok)).toEqual([true]);
  });

  it("the state's countbackCardFor is bound to countbackCardsFor, so reading it off the state IS the answer", () => {
    const state = readSource("src/lib/services/tournament.ts");
    expect(state).toMatch(/const countbackCardFor = countbackCardsFor\(/);
    // Returned on the state under that name (shorthand), not some other value;
    // the one `countbackCardFor:` is the EventState field's type.
    expect(state).toMatch(/^\s*countbackCardFor,\s*$/m);
    expect(state.match(/countbackCardFor:[^\r\n]*/g)).toEqual(["countbackCardFor: (m: { id: string }) => number[];"]);
  });
});
