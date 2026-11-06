import { describe, it, expect } from "vitest";
import { readSource, readVerbatim } from "./source";

/**
 * docs/brand-guide.md quotes its colours by hand. This keeps every one of them
 * true: each hex the guide names must be the value the source holds for the
 * thing the guide CALLS it (not merely a hex that exists somewhere), no hex in
 * the guide may be unaccounted for, and every brand colour in the source must
 * be in the guide.
 *
 * `checkGuide` takes the guide text and the source values as arguments so the
 * control below can run a planted wrong guide through the very same checker.
 */

type Ground = { bg: string; surface: string; text: string };
type Source = {
  /** --thq-* custom properties from globals.css, by name without the dashes. */
  thq: Record<string, string>;
  flag: string;
  ball: string;
  disc: string;
  ring: string;
  dark: Ground;
  light: Ground;
  /** hexes named only in prose (a colour the guide says was taken out). */
  prose: string[];
};

const HEX = "#[0-9a-fA-F]{6}";
const lc = (s: string) => s.toLowerCase();

/** Each claim: a pattern over the guide's own words with one capture per hex,
 *  and what each capture must equal in the source. */
function claims(s: Source): { says: string; re: RegExp; want: string[] }[] {
  const h = `\`(${HEX})\``;
  return [
    { says: "flag orange", re: new RegExp(`flag orange ${h}`), want: [s.thq["thq-flag"]] },
    { says: "light orange", re: new RegExp(`\\(light ${h}`), want: [s.thq["thq-orange-light"]] },
    { says: "deep orange", re: new RegExp(`, deep ${h}\\)`), want: [s.thq["thq-orange-deep"]] },
    { says: "ball green", re: new RegExp(`ball green ${h}`), want: [s.thq["thq-ball"]] },
    { says: "chip text", re: new RegExp(`chip text ${h}`), want: [s.thq["thq-on-flag"]] },
    {
      says: "wordmark stops on light",
      re: new RegExp(`orange stops ${h}, ${h}, ${h}`),
      want: [s.thq["thq-word-light-1"], s.thq["thq-word-light-2"], s.thq["thq-word-light-3"]],
    },
    { says: "emblem disc", re: new RegExp(`disc ${h}`), want: [s.disc] },
    { says: "emblem ring brass", re: new RegExp(`ring brass ${h}`), want: [s.ring] },
    {
      says: "dark ground",
      re: new RegExp(`Dark, \`DARK_GROUND\`: page ${h}, card ${h}, text ${h}`),
      want: [s.dark.bg, s.dark.surface, s.dark.text],
    },
    {
      says: "light ground",
      re: new RegExp(`Light, \`LIGHT_GROUND\`: page ${h}[^,]*, card ${h}, text ${h}`),
      want: [s.light.bg, s.light.surface, s.light.text],
    },
    { says: "the banned leaf green", re: new RegExp(`India-flag green ${h}`), want: s.prose },
  ];
}

export function checkGuide(guide: string, s: Source): string[] {
  const problems: string[] = [];
  const accounted = new Set<string>();
  for (const c of claims(s)) {
    const m = guide.match(c.re);
    if (!m) {
      problems.push(`guide no longer says "${c.says}" in a form this test reads`);
      continue;
    }
    m.slice(1).forEach((got, i) => {
      accounted.add(lc(got));
      if (c.says === "the banned leaf green") {
        if (!c.want.map(lc).includes(lc(got))) problems.push(`${c.says}: ${got} is not named in the source`);
        return;
      }
      const want = c.want[i];
      if (!want || lc(got) !== lc(want)) problems.push(`${c.says}: guide says ${got}, source holds ${want}`);
    });
  }
  const named = guide.match(new RegExp(HEX, "g")) ?? [];
  for (const hex of named) {
    if (!accounted.has(lc(hex))) problems.push(`guide names ${hex} but no claim in this test accounts for it`);
  }
  // Every brand colour in the source is in the guide.
  const inGuide = new Set(named.map(lc));
  const brand: [string, string][] = [
    ...Object.entries(s.thq).map(([k, v]): [string, string] => [`--${k}`, v]),
    ["FLAG", s.flag],
    ["BALL", s.ball],
    ["emblem disc", s.disc],
    ["emblem ring", s.ring],
    ["DARK_GROUND bg", s.dark.bg],
    ["DARK_GROUND surface", s.dark.surface],
    ["DARK_GROUND text", s.dark.text],
    ["LIGHT_GROUND bg", s.light.bg],
    ["LIGHT_GROUND surface", s.light.surface],
    ["LIGHT_GROUND text", s.light.text],
  ];
  for (const [name, hex] of brand) {
    if (!inGuide.has(lc(hex))) problems.push(`source ${name} ${hex} is not in the guide`);
  }
  return problems;
}

function grab(src: string, re: RegExp, what: string): string {
  const m = src.match(re);
  if (!m) throw new Error(`could not read ${what}`);
  return m[1];
}

function readSourceValues(): Source {
  const css = readSource("src/app/globals.css");
  const thq: Record<string, string> = {};
  // Only the brand's own marks and wordmark: the scoreboard block is its own thing.
  for (const m of css.matchAll(
    /--(thq-(?:flag|ball|orange-light|orange-deep|on-flag|word-light-\d)):\s*(#[0-9a-fA-F]{6})/g,
  )) {
    thq[m[1]] = m[2];
  }
  const icons = readSource("scripts/gen-icons.mjs");
  const logo = readSource("src/components/Logo.tsx");
  const themes = readSource("src/lib/themes.ts");
  const ground = (name: string): Ground => {
    const from = themes.slice(themes.indexOf(`export const ${name}`));
    const b = from.slice(0, from.indexOf("};"));
    return {
      bg: grab(b, /\bbg:\s*"(#[0-9a-fA-F]{6})"/, `${name}.bg`),
      surface: grab(b, /\bsurface:\s*"(#[0-9a-fA-F]{6})"/, `${name}.surface`),
      text: grab(b, /\btext:\s*"(#[0-9a-fA-F]{6})"/, `${name}.text`),
    };
  };
  return {
    thq,
    flag: grab(icons, /const FLAG = "(#[0-9a-fA-F]{6})"/, "FLAG"),
    ball: grab(icons, /const BALL = "(#[0-9a-fA-F]{6})"/, "BALL"),
    disc: grab(logo, /fill="(#[0-9a-fA-F]{6})" stroke="#[0-9a-fA-F]{6}"/, "emblem disc"),
    ring: grab(logo, /stroke="(#[0-9a-fA-F]{6})" strokeWidth="1\.1"/, "emblem ring"),
    dark: ground("DARK_GROUND"),
    light: ground("LIGHT_GROUND"),
    prose: readVerbatim("src/lib/themes.ts").includes("#138808") ? ["#138808"] : [],
  };
}

describe("docs/brand-guide.md colours match the source", () => {
  const guide = readVerbatim("docs/brand-guide.md");
  const source = readSourceValues();

  it("reads every source value (the reader is not empty)", () => {
    expect(Object.keys(source.thq)).toHaveLength(8);
    expect(source.prose).toEqual(["#138808"]);
  });

  it("every hex the guide names is the source's value for what the guide calls it, and none is missing", () => {
    expect(checkGuide(guide, source)).toEqual([]);
  });

  it("the icon generator holds the same flag and ball the app does", () => {
    expect(lc(source.flag)).toBe(lc(source.thq["thq-flag"]));
    expect(lc(source.ball)).toBe(lc(source.thq["thq-ball"]));
  });

  describe("control: the checker can see a wrong hex", () => {
    it("a planted wrong flag orange is reported", () => {
      const planted = guide.replace("flag orange `#f2862e`", "flag orange `#f2862f`");
      expect(planted).not.toBe(guide);
      expect(checkGuide(planted, source).join("\n")).toMatch(/flag orange: guide says #f2862f/);
    });
    it("a right hex under the wrong name is reported", () => {
      const planted = guide.replace("ball green `#56c74c`", "ball green `#f2862e`");
      expect(planted).not.toBe(guide);
      expect(checkGuide(planted, source).join("\n")).toMatch(/ball green: guide says #f2862e/);
    });
    it("a brand colour the guide omits is reported", () => {
      const planted = guide.replaceAll("#9c4a0f", "");
      expect(planted).not.toBe(guide);
      expect(checkGuide(planted, source).join("\n")).toMatch(/9c4a0f/);
    });
    it("a hex nobody accounts for is reported", () => {
      expect(checkGuide(guide + "\nA new colour `#123456`.", source).join("\n")).toMatch(/#123456/);
    });
  });
});
