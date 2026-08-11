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
    expect(read("src/app/page.tsx")).toContain('"--logo-flag": "var(--flag)"');
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
