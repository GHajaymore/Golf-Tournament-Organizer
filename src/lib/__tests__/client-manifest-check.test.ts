import { describe, it, expect } from "vitest";
import { manifestProblems } from "../../../scripts/build-checked.mjs";

/**
 * The check that turns the intermittent "Could not find the module … in the
 * React Client Manifest" build into a rebuild instead of a 500 on a random
 * page. See the header of scripts/build-checked.mjs for the fault and why a
 * rebuild is not a test retry.
 */
const page = (...mods: string[]) => new Set(mods.map((m) => `/repo/src/components/${m}.tsx`));

describe("the client-manifest consistency check", () => {
  it("passes a build where every page lists the same client modules", () => {
    expect(manifestProblems({ "a/page": page("A", "B"), "b/page": page("A", "B") })).toEqual([]);
  });

  it("names the page and the module when one page is missing one — the fault", () => {
    const problems = manifestProblems({ "a/page": page("A", "B"), "me/page": page("A") });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("me/page");
    expect(problems[0]).toContain("src/components/B.tsx");
  });

  it("refuses an unreadable manifest and an empty build", () => {
    expect(manifestProblems({ "a/page": null })[0]).toContain("could not be read");
    expect(manifestProblems({})[0]).toContain("no client-reference manifests");
  });

  it("ignores framework entries outside the app's own source", () => {
    const withFramework = new Set([...page("A"), "/repo/node_modules/next/dist/client/x.js"]);
    expect(manifestProblems({ "a/page": withFramework, "b/page": page("A") })).toEqual([]);
  });
});
