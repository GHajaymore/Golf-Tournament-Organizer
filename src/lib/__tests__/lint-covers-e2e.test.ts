import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// B131: `next lint` reads only app, pages, components, lib and src unless `eslint.dirs` says
// otherwise, so e2e/ went unlinted and an unused import sat in a spec that no check saw.
// CI runs `npx next lint`; the folders it reads are defined once, in next.config.mjs.
describe("lint covers the browser tests", () => {
  const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
  const dirs = /eslint:\s*\{\s*dirs:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";

  it("names src and e2e as the folders next lint reads", () => {
    expect(dirs).toContain('"src"');
    expect(dirs).toContain('"e2e"');
  });

  it("CI lints through next lint, so the one definition applies", () => {
    const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("run: npx next lint");
  });
});
