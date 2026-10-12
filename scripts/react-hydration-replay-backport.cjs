/**
 * A BACKPORT OF ONE REACT FIX INTO THE REACT THAT NEXT 15.5 CARRIES.
 *
 * What it fixes, in a member's words: on a slow connection the page appears,
 * and a moment later the whole of it is thrown away and drawn again. In ours:
 * React error #418 on a page whose server HTML and client render are identical,
 * about one load in seven when the page arrives slowly, on every screen.
 *
 * WHY. A page's data follows its HTML down the same connection, in pieces. When
 * React is wiring the page up and reaches an element whose children are in a
 * piece that has not arrived, it stops and comes back to that element later.
 * It has by then already taken the element's place in the document and moved
 * its marker on to the element's first child — and on coming back it did not
 * put the marker back. So it compared the element with its own first child,
 * called that a mismatch, discarded the server's page and rendered everything
 * again in the browser.
 *
 * React fixed this in facebook/react#35494 ("[Fiber] Correctly handle replaying
 * when hydrating", merged 2026-01-13, released in React 19.3.0). It was not
 * taken back to 19.2, and Next 15.5 bundles a 19.2 canary from August 2025 —
 * so the fix reaches this app only by moving to Next 16.3 or later. Until that
 * upgrade is made, this puts the same change into the bundled copy as the
 * browser bundle is built. Nothing in `node_modules` is edited.
 *
 * THE CHANGE IS UPSTREAM'S, not an approximation of it: the function
 * `popHydrationStateOnInterruptedWork` as merged, and the one call to it in
 * `replayBeginWork`'s host-component case. (`supportsHydration` is always true
 * in react-dom, so that first check has nothing to say here.)
 *
 * IT CANNOT QUIETLY STOP APPLYING. Each of the two places it touches must be
 * found EXACTLY once, or the build stops with the reason. When Next is moved
 * to a React that already has the function, it stops too, saying so: delete
 * this file and its rule in `next.config.mjs` then.
 * `react-hydration-replay-backport.test.ts` runs it over every copy of React
 * the installed Next ships, so the day an upgrade changes their shape is the
 * day a unit test says it — and `e2e/slow-page.spec.ts` delivers real pages
 * slowly and counts.
 *
 * `__thqHydrationReplayBackport` is set once on the page, so a browser test
 * can tell that the React running is the one built with this in it: a build
 * cache that handed back the old bundle would otherwise pass by luck six times
 * in seven.
 */

const FUNCTION_ANCHOR = "function popToNextHostParent(fiber) {";
const CALL_ANCHOR = /(case 5:\s*resetHooksOnUnwind\((\w+)\);)(\s*default:)/g;
const NAME = "popHydrationStateOnInterruptedWork";
const MARK = "__thqHydrationReplayBackport";

const FUNCTION = [
  "function " + NAME + "(fiber) {",
  "  if (fiber !== hydrationParentFiber) return;",
  "  if (!isHydrating) {",
  "    popToNextHostParent(fiber);",
  "    isHydrating = !0;",
  "    return;",
  "  }",
  "  popToNextHostParent(fiber);",
  "  5 === fiber.tag && null != fiber.stateNode && (nextHydratableInstance = fiber.stateNode);",
  "}",
  'if ("undefined" !== typeof window) window.' + MARK + " = 1;",
  "",
].join("\n");

/** The source with the fix in it, or an Error saying exactly why it could not be put there. */
function backport(source, where) {
  const file = where || "react-dom-client";
  if (source.includes(NAME)) {
    throw new Error(
      `${file} already has ${NAME}: this React carries the hydration replay fix itself. ` +
        "Delete scripts/react-hydration-replay-backport.cjs and its rule in next.config.mjs.",
    );
  }
  const functions = source.split(FUNCTION_ANCHOR).length - 1;
  const calls = Array.from(source.matchAll(CALL_ANCHOR));
  if (functions !== 1 || calls.length !== 1) {
    throw new Error(
      `${file} is not the shape the hydration replay backport was written for ` +
        `(found popToNextHostParent ${functions} time(s) and the host-component replay ${calls.length} time(s); each must be exactly 1). ` +
        "The React bundled with Next has changed: read facebook/react#35494 against it before building again.",
    );
  }
  for (const name of ["hydrationParentFiber", "nextHydratableInstance", "isHydrating"]) {
    if (!source.includes(name + " = ")) throw new Error(`${file} has no ${name}: the backport would refer to a variable that is not there.`);
  }
  return source
    .replace(FUNCTION_ANCHOR, () => FUNCTION + FUNCTION_ANCHOR)
    .replace(CALL_ANCHOR, (_all, head, fiber, tail) => `${head} ${NAME}(${fiber});${tail}`);
}

/** As a webpack loader: only ever handed the React DOM client that Next compiled (see the rule's `test`). */
module.exports = function reactHydrationReplayBackport(source) {
  return backport(source, this && this.resourcePath);
};
module.exports.backport = backport;
module.exports.NAME = NAME;
module.exports.MARK = MARK;
/** Which files the rule applies to: Next's own compiled React DOM client, stable and experimental, every build of it. */
module.exports.TEST = /[\\/]next[\\/]dist[\\/]compiled[\\/]react-dom(-experimental)?[\\/]cjs[\\/]react-dom-client\.[a-z]+\.js$/;
