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
    // The flagstick path is the mark's signature. A second file containing it
    // means somebody drew the logo again instead of importing it.
    const drawing = files.filter((f) => read(f).includes('d="M20 4 V18"'));
    expect(drawing, `logo geometry duplicated in: ${drawing.join(", ")}`).toEqual([
      "src/components/Logo.tsx",
    ]);
  });

  it("keeps the icon generator's copy in step with the component", () => {
    // This test used to walk .tsx only, so scripts/gen-icons.mjs — which
    // carries its own copy of the mark for the PWA tiles and the favicon —
    // escaped it entirely, and did not receive the centring fix. The icons
    // were shipping with the artwork sitting high in the tile.
    //
    // The duplicate is legitimate: those files are built by sharp at a
    // different scale, outside React, and cannot import a component. So the
    // rule is that it must carry the SAME optical correction, not that it must
    // not exist.
    const gen = readFileSync(join(root, "scripts/gen-icons.mjs"), "utf8");
    expect(gen, "512-grid mark is not nudged").toContain('transform="translate(0,24)"');
    expect(gen, "favicon mark is not nudged").toContain('transform="translate(0,1.5)"');
    // 24 on the 512 grid is 1.5 on the 32 grid, which is Logo.tsx's shift.
    expect(read("src/components/Logo.tsx")).toContain('viewBox="0 -1.5 32 32"');
  });

  it("lets a different palette re-skin the one drawing", () => {
    // Why the duplicate existed: the landing page has its own colours. The
    // variables are what make one component serve both, so they have to stay.
    const logo = read("src/components/Logo.tsx");
    expect(logo).toContain("--logo-flag");
    expect(logo).toContain("--logo-rim");
    expect(logo).toContain("--logo-cup");
    expect(read("src/app/page.tsx")).toContain('"--logo-flag": "var(--brass)"');
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
    expect(landing, "landing must map the tokens BrandMark reads").toContain('"--color-accent": "var(--brass)"');
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
    // Both the pennant and the stick fall back to --color-accent, the orange.
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
    expect(landing).toContain('"--logo-flag": "var(--brass)"');
    expect(landing).toContain('"--logo-ball": "var(--flag)"');
  });
});
