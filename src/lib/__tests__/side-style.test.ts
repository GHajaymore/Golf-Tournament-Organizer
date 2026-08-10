import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  cleanSideStyle,
  defaultFormatFor,
  wantsTeams,
  SIDE_STYLE_OPTIONS,
  SIDE_STYLES,
} from "../side-style";
import { isPlayable, findFormat } from "../formats";

/**
 * The setup answer routes; it never rules.
 *
 * The whole design rests on this being a default rather than a constraint, so
 * the tests that matter most are the ones proving it cannot become one.
 */

describe("it only ever suggests a runnable format", () => {
  it("suggests a pairs format for pairs", () => {
    const f = defaultFormatFor("pairs", "stroke");
    expect(findFormat(f).sideSize).toBe(2);
    expect(isPlayable(f)).toBe(true);
  });

  it("suggests a four-a-side format for teams", () => {
    const f = defaultFormatFor("teams", "stroke");
    const fmt = findFormat(f);
    expect(fmt.maxSideSize ?? fmt.sideSize).toBeGreaterThanOrEqual(4);
    expect(isPlayable(f)).toBe(true);
  });

  it("leaves individual play on the scoring the event already chose", () => {
    expect(defaultFormatFor("individual", "match")).toBe("Match Play");
    expect(defaultFormatFor("individual", "stroke")).toBe("Stroke Play");
  });

  it("treats 'it changes by round' as no opinion at all", () => {
    // Somebody who says every round differs has not asked for a team default;
    // they have asked to decide per round.
    expect(defaultFormatFor("varies", "match")).toBe("Match Play");
    expect(defaultFormatFor("varies", "stroke")).toBe("Stroke Play");
  });

  it("never suggests something the app cannot run", () => {
    for (const style of SIDE_STYLES) {
      for (const scoring of ["match", "stroke"] as const) {
        const f = defaultFormatFor(style, scoring);
        expect(isPlayable(f), `${style}/${scoring} suggested unplayable ${f}`).toBe(true);
      }
    }
  });
});

describe("the Teams screen becomes reachable", () => {
  it("is wanted by every answer except individual", () => {
    expect(wantsTeams("individual")).toBe(false);
    expect(wantsTeams("pairs")).toBe(true);
    expect(wantsTeams("teams")).toBe(true);
    // The catch-22 this fixes: the screen explaining how to set up team golf
    // used to be hidden until a team round existed.
    expect(wantsTeams("varies")).toBe(true);
  });
});

describe("bad input", () => {
  it("falls back to individual rather than throwing", () => {
    expect(cleanSideStyle(null)).toBe("individual");
    expect(cleanSideStyle("")).toBe("individual");
    expect(cleanSideStyle("nonsense")).toBe("individual");
    expect(cleanSideStyle("pairs")).toBe("pairs");
  });
});

describe("every option is offered and explained", () => {
  it("covers each style exactly once", () => {
    expect(SIDE_STYLE_OPTIONS.map((o) => o.key).sort()).toEqual([...SIDE_STYLES].sort());
  });

  it("says what each means in golf, not in software", () => {
    for (const o of SIDE_STYLE_OPTIONS) {
      expect(o.blurb.length, `${o.key} needs a blurb`).toBeGreaterThan(20);
    }
  });
});

/**
 * The line that must not be crossed.
 *
 * sideStyle is a routing hint. The moment a scoring engine reads it, the app
 * has two sources of truth for how a round is played — the round's format and
 * an event-level flag — and they will disagree on the day somebody changes one
 * round. That is the bug this whole design exists to avoid, so it is checked
 * rather than promised.
 */
describe("no scoring code reads it", () => {
  const root = process.cwd();

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }

  it("is absent from every scoring engine and standings path", () => {
    // Looks for a READ of the value — `event.sideStyle`, or an import of the
    // helpers that interpret it. Not the bare string: clone.ts carries
    // "sideStyle" in its field-policy list, which is the name as data and
    // exactly the kind of bookkeeping that should stay allowed.
    const reads = /\.sideStyle\b|from "\.\.\/side-style"|from "@\/lib\/side-style"/;
    const scoringDirs = ["src/lib/domain", "src/lib/services"];
    const offenders: string[] = [];
    for (const dir of scoringDirs) {
      for (const f of walk(dir)) {
        if (f.includes("__tests__")) continue;
        if (reads.test(readFileSync(join(root, f), "utf8"))) offenders.push(f);
      }
    }
    expect(offenders, `sideStyle reached scoring code: ${offenders.join(", ")}`).toEqual([]);
  });
});
