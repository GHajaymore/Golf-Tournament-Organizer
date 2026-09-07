import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config.mjs";

/**
 * THE ICON FONT SHIPS ONE FORMAT, NOT FOUR.
 *
 * `@phosphor-icons/web` declares each weight with four `src` entries — woff2,
 * woff, truetype and an SVG font — and webpack copies every URL it resolves in
 * a stylesheet. For the two weights this app imports, that put 7.3 MB into
 * every build that no browser ever requests. Measured:
 *
 *     Phosphor.svg        2926.1 KB     Phosphor.woff2       143.9 KB
 *     Phosphor-Fill.svg   2702.1 KB     Phosphor-Fill.woff2  128.7 KB
 *     Phosphor.woff        477.3 KB
 *     Phosphor.ttf         477.2 KB     ← 272.6 KB is all anything fetches
 *     Phosphor-Fill.woff   438.8 KB
 *     Phosphor-Fill.ttf    438.7 KB
 *
 * `static/media` was 7.9 MB before the rule in `next.config.mjs` and 612 KB
 * after. `src` is a priority list, woff2 is first, and every engine this app
 * supports takes it — so the rule keeps the URL and skips writing the file,
 * which makes this a build-output change rather than a behaviour one.
 *
 * WHY THIS EXERCISES THE RULE RATHER THAN READING THE FILE. The first version
 * scraped the `test:` regex out of the source with another regex and rebuilt
 * it — which is a test of how the pattern is spelled, not of what it matches,
 * and it broke on its own escaping before it ever ran. Calling `webpack()` and
 * matching real paths against the real `RegExp` is both simpler and the only
 * version that can actually catch the failure below.
 */

/** The rule `next.config.mjs` adds, pulled out by running the hook. */
function phosphorRule(): { test: RegExp; generator?: { emit?: boolean } } {
  const hook = (nextConfig as { webpack?: (c: unknown) => { module: { rules: unknown[] } } }).webpack;
  expect(hook, "next.config.mjs no longer customises webpack at all").toBeTypeOf("function");

  const config = { module: { rules: [] as Array<{ test?: RegExp; generator?: { emit?: boolean } }> } };
  hook!(config);

  const rule = config.module.rules.find((r) => r.test instanceof RegExp && /phosphor/i.test(String(r.test)));
  expect(rule, "no phosphor asset rule; the build is back to 7.9 MB of media").toBeTruthy();
  return rule as { test: RegExp; generator?: { emit?: boolean } };
}

describe("the icon font emits only the format a browser uses", () => {
  it("declares the rule, and it suppresses the file rather than the URL", () => {
    const rule = phosphorRule();
    // `emit: false` is the whole mechanism. Without it the rule is a no-op
    // that still matches every path below, so every other assertion here would
    // keep passing while the 7.3 MB came back.
    expect(rule.generator?.emit, "the rule no longer suppresses the emit").toBe(false);
  });

  it("drops the three formats nothing asks for", () => {
    const { test } = phosphorRule();
    for (const path of [
      "node_modules/@phosphor-icons/web/src/regular/Phosphor.woff",
      "node_modules/@phosphor-icons/web/src/regular/Phosphor.ttf",
      "node_modules/@phosphor-icons/web/src/regular/Phosphor.svg",
      "node_modules\\@phosphor-icons\\web\\src\\fill\\Phosphor-Fill.ttf",
    ]) {
      expect(test.test(path), `${path} would still be emitted`).toBe(true);
    }
  });

  /**
   * THE ONE THAT MATTERS.
   *
   * `\.woff$` does not match `.woff2` — but a later tidy-up to `woff2?`, or
   * dropping the `$`, would stop emitting the only font the app can use, and
   * every icon in the product would disappear. Nothing else in the suite would
   * notice: the build would still succeed, every page would still render, and
   * the assertions above would be MORE satisfied than before.
   */
  it("never drops woff2, whatever else it drops", () => {
    const { test } = phosphorRule();
    for (const path of [
      "node_modules/@phosphor-icons/web/src/regular/Phosphor.woff2",
      "node_modules\\@phosphor-icons\\web\\src\\fill\\Phosphor-Fill.woff2",
    ]) {
      expect(
        test.test(path),
        `${path} would be dropped from the build — the app would render no icons at all`,
      ).toBe(false);
    }
  });

  it("touches nothing outside the icon package", () => {
    const { test } = phosphorRule();
    // next/font emits the Geist and Fraunces faces through the same pipeline;
    // catching those would take the app's body text down with the icons.
    for (const path of [
      "node_modules/next/font/google/target.css?fraunces.woff",
      "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
      "src/app/fonts/Display.svg",
    ]) {
      expect(test.test(path), `${path} is not an icon font and must still be emitted`).toBe(false);
    }
  });
});
