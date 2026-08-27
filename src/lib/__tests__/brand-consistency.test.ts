import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * One mark, one wordmark, one set of sizes.
 *
 * The landing page had grown its own hand-drawn copy of the logo — same idea,
 * a slightly larger cup, a thinner flagstick, the ball half a unit lower — so
 * the mark above the sign-in button was not the mark inside the app. And the
 * logo was being called at 17, 19, 22 and 23 across five files, four sizes
 * chosen one at a time.
 *
 * Neither is the sort of thing anyone reports. They are the sort of thing that
 * makes a product feel assembled rather than made, so they get a test.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every .tsx under src, so a new file cannot quietly reintroduce either. */
function allTsx(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) allTsx(rel, out);
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

describe("the brand mark is drawn once", () => {
  const files = allTsx("src");

  it("has exactly one copy of the flagstick geometry in the app", () => {
    // The pole is the mark's signature. A second file containing it means
// somebody drew the logo again instead of importing it.
const drawing = files.filter((f) => read(f).includes('d="M7.2 4.2 V27.8"'));
    expect(drawing, `logo geometry duplicated in: ${drawing.join(", ")}`).toEqual([
      "src/components/Logo.tsx",
    ]);
  });

  it("keeps the icon generator's copy in step with the component", () => {
    // This test used to walk .tsx only, so scripts/gen-icons.mjs — which
    // carries its own copy of the mark for the PWA tiles and the favicon —
    // escaped it entirely, and did not receive the centring fix.
    //
    // The duplicate is legitimate: those files are built by sharp at a
    // different scale, outside React, and cannot import a component.
    //
    // What has to agree is now the ABSENCE of a correction. The pin monogram
    // is drawn centred in its own box, so neither file nudges it — and a
    // translate reappearing in one of them means the two have diverged.
    const gen = readFileSync(join(root, "scripts/gen-icons.mjs"), "utf8");
    const logo = read("src/components/Logo.tsx");
    expect(logo, "the component nudges the mark").toContain('viewBox="0 0 32 32"');
    expect(gen, "the generator nudges the mark").not.toMatch(/translate\(0,\s*\d/);
    // And the generator's grid is the component's, x16.
    expect(gen).toContain('M115.2 67.2 V444.8');
    expect(logo).toContain('M7.2 4.2 V27.8');
  });

  it("lets a different palette re-skin the one drawing", () => {
    // Why the duplicate existed: the landing page has its own colours. The
    // variables are what make one component serve both, so they have to stay.
    const logo = read("src/components/Logo.tsx");
    expect(logo).toContain("--logo-flag");
    expect(logo).toContain("--logo-stick");
    // No --logo-rim or --logo-cup: the pin monogram has no cup, and a
    // variable for a shape that does not exist is a promise the drawing
    // cannot keep.
    // Matched as a READ of the variable, not a mention of it: the comment
    // above explains why the cup is gone, and prose must not fail a test.
    expect(logo, "the drawing still reads a variable for a shape it removed").not.toContain(
      "var(--logo-cup",
    );
    expect(read("src/app/page.tsx")).toContain('"--logo-flag": "var(--brand-amber)"');
  });
});

describe("the mark is drawn at a chosen size", () => {
  const files = allTsx("src");

  it("never hard-codes a logo size", () => {
    // Sizes come from LOGO_SIZE. A bare number here is a fifth size nobody
    // decided on.
    const offenders = files.filter((f) => /<Logo\s+size=\{\d/.test(read(f)));
    expect(offenders, `hard-coded logo size in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps the wordmark's typography in one place", () => {
    // It used to be pasted inline at each call site, so half of them carried
    // the heading font and half rendered the wordmark in the body face.
    const offenders = files
      .filter((f) => f !== "src/components/BrandMark.tsx")
      .filter((f) => /<BrandMark[^/>]*fontFamily/.test(read(f)));
    expect(offenders, `wordmark styled inline in: ${offenders.join(", ")}`).toEqual([]);
    expect(read("src/components/BrandMark.tsx")).toContain("var(--font-heading)");
  });
});

describe("the wordmark is written once too", () => {
  const files = allTsx("src");

  it("has exactly one copy of the TourneyHQ lockup", () => {
    // The landing page carried its own: "Tourney" in the sans face with an
    // italic "HQ", against the app's Fraunces "Tourney" in gradient foil beside
    // a solid "HQ" badge chip. Not a near-miss — two different marks, one above
    // the sign-in button and one inside the product a click later.
    //
    // The geometry test above caught the same thing for the flagstick. This is
    // the wordmark half of it: the lockup's letters may be assembled in
    // BrandMark and nowhere else.
    const offenders = files.filter((f) => /Tourney<span/.test(read(f)));
    expect(offenders, `wordmark rebuilt by hand in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("lets a different palette re-skin the one lockup", () => {
    // Why the duplicate existed: the landing page has its own ground and does
    // not define --color-*. Mapping those tokens is what makes one component
    // serve both, exactly as --logo-flag does for the mark.
    const landing = read("src/app/page.tsx");
    expect(landing).toContain("<BrandMark");
    expect(landing, "landing must map the tokens BrandMark reads").toContain('"--color-accent": "var(--brand-amber)"');
  });
});

describe("colour comes from the theme, not from the component", () => {
  const files = allTsx("src");

  /**
   * A club's palette is only as themeable as its least disciplined component.
   *
   * `--color-danger` went undeclared for a long time while nineteen components
   * wrote `var(--color-danger, #e0665a)`. The fallback is what actually
   * rendered, so error red was the one colour a club could never change — and
   * once the token WAS declared the fallbacks became twenty-five copies of a
   * value nobody would think to update.
   *
   * The rule is not "no hex anywhere": a few places legitimately hold one.
   * They are listed, so each is a decision rather than a habit.
   */
  const ALLOWED = [
    // The mark itself is artwork, drawn once, re-skinned by variables.
    "src/components/Logo.tsx",
    // The colour picker: a placeholder and a sample the club types over.
    "src/components/ThemePicker.tsx",
    // The landing page owns a separate identity on purpose — its palette must
    // not leak into the console, nor the console's into it.
    "src/app/page.tsx",
    // The status-bar colour. A <meta name="theme-color"> cannot reference a
    // CSS variable, so these two values are unavoidably literal — and are
    // checked against the grounds they mirror in the test below.
    "src/app/layout.tsx",
    // The styleguide's whole job is to show the palette.
    "src/app/styleguide/page.tsx",
    // Test fixtures, not shipped UI.
    "src/lib/__tests__/render.test.tsx",
  ];

  it("has no hard-coded hex colours outside the places that own one", () => {
    const offenders = files
      .filter((f) => !ALLOWED.includes(f))
      .filter((f) => /#[0-9a-fA-F]{6}\b/.test(read(f)));
    expect(
      offenders,
      `hard-coded colour in: ${offenders.join(", ")} — use a --color-* token`,
    ).toEqual([]);
  });

  it("never re-adds a fallback to the danger token", () => {
    // The specific shape that hid the missing token for so long. A fallback
    // reads as caution and behaves as a second source of truth.
    const offenders = files.filter((f) => /var\(--color-danger,/.test(read(f)));
    expect(offenders, `--color-danger given a fallback in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("the status bar matches the app behind it", () => {
  it("keeps themeColor in step with the two grounds", async () => {
    /**
     * `<meta name="theme-color">` cannot reference a CSS variable, so the two
     * values in layout.tsx are a hand-copy of DARK_GROUND.bg and
     * LIGHT_GROUND.bg. Unavoidable duplication — but duplication that drifts
     * silently gives you a dark bar above a light app, which is the tell that
     * a web view has been wrapped rather than an app built.
     *
     * Checked rather than trusted, so changing a ground fails here instead of
     * on somebody's phone.
     */
    const { DARK_GROUND, LIGHT_GROUND } = await import("../themes");
    const layout = read("src/app/layout.tsx");
    expect(layout, `light themeColor should be ${LIGHT_GROUND.bg}`).toContain(LIGHT_GROUND.bg);
    expect(layout, `dark themeColor should be ${DARK_GROUND.bg}`).toContain(DARK_GROUND.bg);
  });
});

describe("nothing is set smaller than it can be read", () => {
  const files = allTsx("src");

  it("has no text below 10px anywhere in the app", () => {
    /**
     * This app is read on a phone, held at arm's length, outdoors, by a
     * membership that skews older than most software's. `.tag` is designed at
     * 11px and two call sites had shrunk it to 9 and 9.5 — a size that is
     * marginal on a desk and gone entirely in sunlight.
     *
     * A floor rather than a scale: the codebase has 877 inline font sizes
     * across twenty distinct values and genuinely needs a type scale, but
     * that is a migration to make in daylight with someone looking at the
     * screens. This only stops the bottom falling out in the meantime.
     */
    const SKIP = [
      // Its own type system, expressed in a CSS string rather than as React
      // style numbers.
      "src/app/page.tsx",
      // Paper, not a screen: 9pt on a printed tee sheet is read at desk
      // distance and is entirely normal.
      "src/components/TeeSheetPrint.tsx",
      // Demonstrating sizes is the page's whole purpose.
      "src/app/styleguide/page.tsx",
    ];

    const offenders: string[] = [];
    for (const f of files) {
      if (SKIP.includes(f)) continue;
      const src = read(f);
      for (const m of src.matchAll(/fontSize: (\d+(?:\.\d+)?)/g)) {
        if (Number(m[1]) >= 10) continue;
        // An icon font's `fontSize` is the glyph's diameter, not a reading
        // size — the live-status dot is drawn as a 6px filled circle and is
        // not text at all. Judged by what the size is applied TO.
        const context = src.slice(Math.max(0, m.index - 140), m.index);
        if (/<i\b[^>]*$/.test(context)) continue;
        offenders.push(`${f} (${m[1]}px)`);
      }
    }
    expect(offenders, `text below 10px in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("the mark is the same colour in both renderings", () => {
  /**
   * The geometry test above proves the component and the icon generator draw
   * the same SHAPES. Nothing proved they filled them the same way, and they
   * did not: the generator drew an orange ball while the component drew it in
   * `currentColor` — near-white wherever it actually sat. The icon on a home
   * screen did not match the app it opened, and the flag and ball were the
   * reverse of the intended mark in both.
   *
   * Orange flag, green ball. Asserted against the palette rather than against
   * literal hex, so changing the club ramp cannot leave the icons behind.
   */
  const logo = read("src/components/Logo.tsx");
  const gen = readFileSync(join(root, "scripts/gen-icons.mjs"), "utf8");

  it("draws the flag from the accent (orange) in the component", () => {
    // The PENNANT falls back to --color-accent. The stick no longer does: the
// T is lettering and takes --color-text, so the mark and the wordmark
// beside it read as one lockup rather than two accents competing.
    expect(logo).toContain("var(--logo-flag, var(--color-accent, currentColor))");
  });

  it("draws the ball from accent-2 (green), and as a variable at all", () => {
    // `currentColor` is not a colour decision, it is the absence of one.
    expect(logo).toContain("var(--logo-ball, var(--color-accent-2, currentColor))");
    expect(logo, "the ball must not be currentColor again").not.toMatch(
      /<circle[^>]*fill="currentColor"/,
    );
  });

  it("uses the same two colours in the generated icons", async () => {
    // The rasterizer cannot read custom properties, so these are written out —
    // which is exactly why they drifted. FLAG must be the accent orange and
    // BALL the secondary green, matching the component's fallbacks above.
    const { THEME_PRESETS, themeScale, SECONDARY_PRESETS, themeFor } = await import("../themes");
    void THEME_PRESETS;
    void SECONDARY_PRESETS;
    const orange = themeScale(themeFor("sunset"))[500].toLowerCase();

    const flag = /const FLAG = "(#[0-9a-fA-F]{6})"/.exec(gen)?.[1]?.toLowerCase();
    const ball = /const BALL = "(#[0-9a-fA-F]{6})"/.exec(gen)?.[1]?.toLowerCase();

    expect(flag, "FLAG should be the accent orange").toBe(orange);
    // The ball is lifted one step off the in-app green, which goes muddy at
    // 48px — so it is checked as "a green", not as an exact token.
    expect(ball, "BALL should be a green, not the orange").not.toBe(orange);
    expect(ball).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(ball!.slice(i, i + 2), 16));
    expect(g, `BALL ${ball} should be green-dominant`).toBeGreaterThan(r);
    expect(g, `BALL ${ball} should be green-dominant`).toBeGreaterThan(b);
  });

  it("keeps the landing page's mapping honest", () => {
    // This page has its own palette, and its mapping said "pennant orange"
    // while pointing at --flag, which is its green.
    const landing = read("src/app/page.tsx");
    expect(landing).toContain('"--logo-flag": "var(--brand-amber)"');
    expect(landing).toContain('"--logo-ball": "var(--brand-green)"');
  });

  /**
   * THE MARK DOES NOT FOLLOW THE PAGE.
   *
   * This is the rule those three assertions were reaching for and did not
   * state. They pinned the literal token NAMES the mapping happened to use at
   * the time — `var(--brass)` and `var(--flag)` — which are the landing page's
   * ACCENT and its GREEN. Both are design variables: retuning the palette
   * moved them, and the logo silently recoloured with it. A brand changed
   * because a background did, and the suite held green throughout, because
   * the name it asserted had not changed.
   *
   * So assert the property instead of the spelling: whatever the mark is
   * wired to must not be a token the page's design is free to retune.
   */
  it("never wires the mark to a colour the page is free to retune", () => {
    const landing = read("src/app/page.tsx");

    // The four mappings that colour the mark, as `"--token": "value"` pairs.
    const marks = ["--logo-flag", "--logo-ball", "--color-accent", "--color-accent-600"];
    // The page's own design variables. Every one of these is retuned whenever
    // the landing palette is redesigned.
    const palette = ["--brass", "--brass-hi", "--flag", "--flag-soft", "--under", "--incised"];

    for (const mark of marks) {
      const line = landing.match(new RegExp(`"${mark}":\\s*"([^"]+)"`));
      expect(line, `${mark} is no longer mapped on the landing page`).not.toBeNull();
      const value = line![1];
      for (const p of palette) {
        expect(
          value,
          `${mark} is wired to ${p}, which the page palette retunes — the logo would change colour with the design`,
        ).not.toContain(`var(${p})`);
      }
    }
  });

  it("draws the mark in the brand's own colours, on both grounds", () => {
    // And those tokens hold the colours the mark has always been: the orange
    // pennant and the green ball, per ground. If a redesign wants a different
    // logo it has to say so HERE, which is a decision rather than a side
    // effect.
    const landing = read("src/app/page.tsx");
    const declared = (token: string) =>
      [...landing.matchAll(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`, "g"))].map((m) => m[1].toUpperCase());

    // Dark ground first, then the daylight pair.
    expect(declared("--brand-amber")).toEqual(["#E8A33D", "#A8701A"]);
    expect(declared("--brand-green")).toEqual(["#4FA97C", "#1F7A50"]);
  });
});
