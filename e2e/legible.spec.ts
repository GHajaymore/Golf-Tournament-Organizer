import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { standaloneScreens, consoleScreens, playerScreens, entryUrl } from "./routes";

/**
 * EVERY WORD CLEARS ITS CONTRAST FLOOR, ON BOTH GROUNDS.
 *
 * "Outdoor legibility is a product requirement, not a nicety" — CLAUDE.md,
 * and it is the truest sentence in the file: scores are read on a phone in
 * direct sun. The app's own answer to a club that fails the bar is to switch
 * to the LIGHT ground, and `sunlightVerdict` tells them so.
 *
 * NOTHING HAD EVER RENDERED THE LIGHT GROUND. `themes.test.ts` proves the
 * RAMPS clear their floor, which is arithmetic over the tokens, and no spec in
 * the suite emulated `prefers-color-scheme: light` or loaded a single screen
 * on it. A sound ramp says nothing about a screen USING it correctly — a muted
 * token on a tinted card, a colour picked against the dark ground and left, a
 * state colour only ever looked at one way round. The remedy the app
 * recommends was the one nobody had looked at.
 *
 * So this renders and measures: every leaf of text, its computed colour
 * against the first opaque background above it, against the WCAG floor for its
 * size — 4.5, or 3 where the type is large enough to earn it.
 *
 * ONE PROJECT ONLY, and deliberately. Contrast is a property of the tokens and
 * the markup, not of how wide the window is; running this at three viewports
 * would cost three times as long to produce the same answer three times.
 * `layout.spec` and `touch.spec` are the ones that genuinely differ per width.
 */

// Destructured and renamed rather than omitted: Playwright rejects a hook
// whose first argument is not an object pattern, and the lint rule takes the
// underscore as "deliberately ignored". Nothing here needs a fixture.
test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "contrast does not vary with viewport width");
});

interface Illegible {
  text: string;
  ratio: number;
  floor: number;
  color: string;
  size: number;
  where: string;
}

async function illegibleText(page: Page): Promise<Illegible[]> {
  return page.evaluate(() => {
    type RGB = { r: number; g: number; b: number; a: number };

    /**
     * Let the BROWSER decode the colour, rather than a regex.
     *
     * The first version of this file scraped the numbers out of the computed
     * value with `/[\d.]+/g`, which is correct for `rgb(233, 233, 237)` and
     * catastrophic for `color(srgb 0.913725 0.913725 0.929412 / 0.72)` —
     * Chrome's serialisation whenever a colour comes through `color-mix()`,
     * and the form most of this app's muted text arrives in. Those components
     * are 0–1, so reading them as 0–255 turns near-white into near-black, and
     * the sweep reported 261 illegible strings on a dashboard that is fine.
     *
     * It reported them CALMLY, with plausible ratios and real text, which is
     * the failure this file's control exists to catch and did catch: the dark
     * control went red on its own first line.
     *
     * A 1x1 canvas cannot make that mistake. Whatever syntax Chrome accepts —
     * `rgb`, `color()`, `oklch`, a keyword — it rasterises to the same four
     * bytes the screen gets, which is the thing being asked about anyway.
     */
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const parse = (c: string): RGB | null => {
      if (!ctx) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };

    /** `fg` painted over `bg`, which is what the eye is given to read. */
    const over = (fg: RGB, bg: RGB): RGB => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });

    const lum = ({ r, g, b }: RGB) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    const ratio = (a: RGB, b: RGB) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    /**
     * The background you would actually SEE behind this text.
     *
     * Walking up rather than reading the element's own, because almost nothing
     * in this app paints its own background: a word sits in a span, in a card,
     * on the ground. Read the element's own and you get `rgba(0, 0, 0, 0)`
     * every time, whose luminance is that of BLACK — so on the dark ground
     * every word scores perfectly and on the light ground every word fails.
     * Either way the answer is about the measurement, not the app.
     *
     * Translucent layers are COMPOSITED rather than skipped. A tinted card at
     * `a: 0.06` over the ground is most of this design system, and treating it
     * as absent measures against a surface nobody is looking at.
     */
    const bgOf = (el: Element): RGB => {
      const stack: RGB[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (!c || c.a === 0) continue;
        stack.push(c);
        if (c.a >= 0.999) break;
      }
      // Nothing opaque above it: the canvas the browser paints on is white.
      let out: RGB = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
      return out;
    };

    const out: Illegible[] = [];
    for (const el of document.querySelectorAll("body *")) {
      // Leaves only. A wrapper's `textContent` is its children's, so counting
      // it measures the same words again against the wrapper's own styles.
      if (el.children.length) continue;

      const text = (el.textContent ?? "").trim();
      if (text.length < 2) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // Deliberately faded things — a placeholder, a toast on its way out —
      // are not a legibility fault, and flagging them is how a sweep becomes
      // something somebody switches off.
      if (Number(cs.opacity) < 0.5) continue;
      /**
       * INACTIVE CONTROLS ARE EXEMPT, and that is WCAG 1.4.3 rather than a
       * convenience: "text that is part of an inactive user interface
       * component ... has no contrast requirement".
       *
       * It matters here because Chrome's own UA stylesheet paints a disabled
       * button `rgba(16, 16, 16, 0.3)` on a light ground and
       * `rgba(255, 255, 255, 0.3)` on a dark one. The availability calendar
       * disables the days either side of the month, so every one of them
       * reported ~2:1 in a colour no stylesheet in this repository sets —
       * which reads as a finding and is the browser doing what it is told.
       *
       * Checked up the tree because the attribute sits on the button and the
       * text is in a span inside it.
       */
      if (el.closest("[disabled], [aria-disabled='true'], :disabled")) continue;

      const box = el.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;

      const fg = parse(cs.color);
      if (!fg || fg.a === 0) continue;

      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      // WCAG 1.4.3: large text is 24px, or 18.66px when bold.
      const floor = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;

      // The foreground is COMPOSITED over its background before the ratio is
      // taken. Most of this app's muted text is a full-strength colour at
      // `a: 0.72`, and comparing the unblended value credits it with contrast
      // the eye is never given.
      const bg = bgOf(el);
      const cr = ratio(over(fg, bg), bg);
      if (cr < floor) {
        // Where it lives, not just what it says. A ratio and a word send you
        // grepping for a string that is often generated; the ancestor chain
        // names the component.
        const where: string[] = [];
        for (let n: Element | null = el; n && where.length < 4; n = n.parentElement) {
          where.push(n.tagName.toLowerCase() + (n.className ? `.${String(n.className).split(" ")[0]}` : ""));
        }
        out.push({
          text: text.slice(0, 30),
          ratio: Math.round(cr * 100) / 100,
          floor,
          color: cs.color,
          size: Math.round(size),
          where: where.join(" < "),
        });
      }
    }
    return out;
  });
}

/**
 * Two controls, one in each direction, because this measurement has now failed
 * in both and only one of them announced itself.
 *
 * FALSE NEGATIVE — a sweep that walks to the wrong background, or cannot parse
 * a colour, reports a flawless app and reports it calmly. `#cfcfcf` on
 * `#ffffff` is 1.6:1; if that comes back clean, every zero here is worthless.
 *
 * FALSE POSITIVE — and this is the one that actually happened. Reading
 * `color(srgb 0.91 0.91 0.93 / 0.72)` with a regex built for `rgb()` turned
 * near-white into near-black and produced 261 findings against a dashboard
 * with nothing wrong with it. So the second probe is comfortably legible and
 * written in that exact syntax: it must NOT be reported.
 *
 * Returned together rather than asserted here, so a failure names which way
 * round the instrument is broken.
 */
async function controlResult(page: Page): Promise<{ caught: number; falsePositives: string[] }> {
  await page.evaluate(() => {
    const host = document.querySelector("main") ?? document.body;

    const bad = document.createElement("p");
    bad.textContent = "zz-control illegible grey on white";
    bad.setAttribute("style", "color:#cfcfcf;background:#ffffff;font-size:14px;padding:6px");
    host.appendChild(bad);

    const good = document.createElement("p");
    good.textContent = "zz-control legible in color-function syntax";
    good.setAttribute(
      "style",
      "color:color(srgb 0.07 0.07 0.09);background:color(srgb 1 1 1);font-size:14px;padding:6px",
    );
    host.appendChild(good);
  });

  const found = await illegibleText(page);
  return {
    caught: found.filter((f) => f.text.startsWith("zz-control illegible")).length,
    falsePositives: found.filter((f) => f.text.startsWith("zz-control legible")).map((f) => f.text),
  };
}

const CONSOLE = [...consoleScreens(), ...standaloneScreens()].sort();
const PLAYER = playerScreens();

for (const scheme of ["light", "dark"] as const) {
  test.describe(`the ${scheme} ground`, () => {
    test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

    test(`the measurement can see text that fails (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");

      expect(await illegibleText(page), "/dashboard is not clean to begin with").toEqual([]);

      const control = await controlResult(page);
      expect(control.caught, "the sweep cannot see grey on white").toBe(1);
      expect(control.falsePositives, "the sweep misreads color() syntax").toEqual([]);
    });

    for (const path of CONSOLE) {
      test(`${path} is legible (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        const res = await page.goto(entryUrl(path));
        expect(res?.status(), `${path} did not render`).toBeLessThan(500);
        await page.waitForLoadState("networkidle");

        const bad = await illegibleText(page);
        expect(bad, `${path} on ${scheme}: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
      });
    }
  });

  test.describe(`the ${scheme} ground, as a player`, () => {
    test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

    for (const path of PLAYER) {
      test(`${path} is legible (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        // A redirect to sign-in renders a page with almost no text on it,
        // which passes this sweep perfectly. CLAUDE.md: assert the status
        // before asserting anything about the body.
        expect(new URL(page.url()).pathname, "not signed in as a player").toBe(path);

        const bad = await illegibleText(page);
        expect(bad, `${path} on ${scheme}: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
      });
    }
  });
}
