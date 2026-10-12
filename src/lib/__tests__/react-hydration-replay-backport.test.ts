import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Script } from "node:vm";

/**
 * THE REACT FIX THIS APP CARRIES IN ITS BUILD STILL FITS THE REACT IT IS PUT INTO.
 *
 * `scripts/react-hydration-replay-backport.cjs` puts one upstream React fix
 * (facebook/react#35494, React 19.3.0) into the React that Next bundles, as the
 * browser bundle is built — the file says why. A change made to somebody
 * else's compiled code has one way of going wrong that nothing else would
 * notice: the code underneath changes, the change stops applying, and the
 * build is green without it.
 *
 * So this runs the backport over EVERY copy of the React DOM client the
 * installed Next ships and holds it to what it must do there. The day a Next
 * upgrade changes the shape of that file — or brings a React that already has
 * the fix — this turns red on the upgrade's own pull request, with the reason,
 * instead of the fault coming back on a golf course.
 *
 * What it cannot show is that the fix WORKS: that is a page delivered slowly to
 * a real browser, `e2e/slow-page.spec.ts`.
 */

const require = createRequire(import.meta.url);
const loader = require(resolve(process.cwd(), "scripts/react-hydration-replay-backport.cjs")) as {
  (this: { resourcePath: string }, source: string): string;
  backport: (source: string, where?: string) => string;
  NAME: string;
  MARK: string;
  TEST: RegExp;
};

const COMPILED = resolve(process.cwd(), "node_modules/next/dist/compiled");
const copies = ["react-dom", "react-dom-experimental"].flatMap((pkg) => {
  const dir = join(COMPILED, pkg, "cjs");
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.startsWith("react-dom-client.") && f.endsWith(".js")).map((f) => join(dir, f))
    : [];
});
const short = (p: string) => p.slice(COMPILED.length + 1).replace(/\\/g, "/");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("the hydration replay fix, against the React that Next ships", () => {
  it("CONTROL: there are copies to look at — the stable and experimental clients, production and development", () => {
    expect(copies.map(short).sort()).toEqual(
      expect.arrayContaining(["react-dom/cjs/react-dom-client.development.js", "react-dom/cjs/react-dom-client.production.js"]),
    );
    expect(copies.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of copies) {
    it(`fits ${short(file)}: one function added, one call in the host-element replay, and it still parses`, () => {
      const before = readFileSync(file, "utf8");
      expect(before, "this React already carries the fix: delete the backport").not.toContain(loader.NAME);
      const after = loader.backport(before, file);

      expect(count(after, `function ${loader.NAME}(fiber) {`), "the function").toBe(1);
      expect(count(after, `${loader.NAME}(`), "the function and its one call").toBe(2);
      // The call is where upstream put it: in the replay of a host element (tag 5), after its hooks
      // are reset and before the element is begun again — and nowhere else.
      const replay = after.slice(after.indexOf("function replaySuspendedUnitOfWork("), after.indexOf("function throwAndUnwindWorkLoop("));
      expect(replay, "the replay function was not found whole").toContain("resetWorkInProgress(");
      expect(replay.replace(/\s+/g, " ")).toMatch(new RegExp(`case 5: resetHooksOnUnwind\\((\\w+)\\); ${loader.NAME}\\(\\1\\); default:`));
      // It restores the two things the claim moved, in upstream's order.
      const body = after.slice(after.indexOf(`function ${loader.NAME}(fiber) {`), after.indexOf("function popToNextHostParent(fiber) {"));
      expect(body).toContain("if (fiber !== hydrationParentFiber) return;");
      expect(body).toContain("nextHydratableInstance = fiber.stateNode");
      expect(count(body, "popToNextHostParent(fiber);"), "pops to the host parent on both branches").toBe(2);
      // The page can be asked whether the React running is the one built with this in it.
      expect(body).toContain(`window.${loader.MARK} = 1`);
      // Nothing else moved: the file is itself plus exactly what was added.
      expect(after.length - before.length).toBeLessThan(600);
      expect(() => new Script(after, { filename: short(file) }), "the result is not JavaScript").not.toThrow();
      // And the rule in next.config.mjs is aimed at this very file.
      expect(loader.TEST.test(file), "the build rule does not match this copy").toBe(true);
    });
  }

  it("stops the build, with the reason, on a React of another shape — it never quietly does nothing", () => {
    const real = readFileSync(copies[0], "utf8");
    // Gone from where it was: the replay no longer reads the way the fix expects.
    const reshaped = real.replace(/case 5:(\s*)resetHooksOnUnwind\(/, "case 5:$1resetTheHooksOnUnwind(");
    expect(reshaped).not.toBe(real);
    expect(() => loader.backport(reshaped, "a reshaped React")).toThrow(/not the shape the hydration replay backport was written for/);
    // A React that has the fix already: say so, and say what to delete.
    const fixed = loader.backport(real, "first");
    expect(() => loader.backport(fixed, "a React with the fix")).toThrow(/already has popHydrationStateOnInterruptedWork[\s\S]*Delete scripts\/react-hydration-replay-backport\.cjs/);
    // Something that is not React at all.
    expect(() => loader.backport("export const nothing = 1;", "not React")).toThrow(/not the shape/);
  });

  it("is in the build: next.config.mjs sends exactly these files through it, before anything else reads them", async () => {
    const config = (await import(/* @vite-ignore */ `file://${resolve(process.cwd(), "next.config.mjs").replace(/\\/g, "/")}`)).default as {
      webpack: (c: { module: { rules: unknown[] } }) => { module: { rules: Array<{ test: RegExp; enforce?: string; use: Array<{ loader: string }> }> } };
    };
    const built = config.webpack({ module: { rules: [] } });
    const rule = built.module.rules.find((r) => r.use?.some((u) => u.loader.replace(/\\/g, "/").endsWith("scripts/react-hydration-replay-backport.cjs")));
    expect(rule, "no rule in next.config.mjs uses the backport").toBeTruthy();
    expect(rule!.enforce).toBe("pre");
    for (const file of copies) expect(rule!.test.test(file), short(file)).toBe(true);
    // and at nothing else: not the server renderer beside it, not React itself, not the app
    for (const other of [
      join(COMPILED, "react-dom", "cjs", "react-dom-server.node.production.js"),
      join(COMPILED, "react", "cjs", "react.production.js"),
      resolve(process.cwd(), "src/components/TournamentSwitcher.tsx"),
      resolve(process.cwd(), "node_modules/react-dom/cjs/react-dom-client.production.js"),
    ]) {
      expect(rule!.test.test(other), `the rule would rewrite ${other}`).toBe(false);
    }
  });
});
