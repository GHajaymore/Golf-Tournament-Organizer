import { describe, it, expect } from "vitest";
import { HOME_CSS } from "@/lib/landing/home-styles";
import { readSource, stripComments } from "./source";

/**
 * THE FRONT DOOR'S OWN STYLESHEET STYLES WHAT THE PAGE WRITES, AND NOTHING ELSE.
 *
 * The home page was rebuilt on 2026-10-11 with a sheet of its own
 * (`home-styles.ts`), every class prefixed `m-` and scoped to `main.m-home`,
 * beside the shared sheet that also dresses /faq, /privacy and /terms. The
 * shared sheet is the cautionary tale: the day the page was rebuilt it still
 * carried rules for 40-odd class names no file writes any more, because nothing
 * ever compared the two lists — a section is deleted from the page and its
 * rules stay for ever, shipped inline to every visitor.
 *
 * So, for the new sheet, the two lists are held together:
 *
 *  - a class the sheet styles is one the page (or its script) writes;
 *  - a class the page writes is one the sheet styles, or is a NAMED hook;
 *  - every rule is scoped to the page, so it cannot reach the app or the other
 *    three pages that share the chrome;
 *  - a keyframe that is defined is used, and one that is used is defined — a
 *    misspelt animation name fails silently in a browser.
 *
 * What it cannot see: whether a rule that matches still does anything worth
 * having, and a class name assembled at run time. Neither file builds one
 * today; the first that does needs a line in `HOOKS` or this will call its
 * rule dead.
 */

/** Where an `m-` class can be written: the page, its script, and the two shared pieces it draws with. */
const WRITERS = ["src/app/page.tsx", "src/components/LandingHomeEffects.tsx", "src/components/landing/chrome.tsx", "src/components/landing/shots.tsx"];

/**
 * Written on purpose and styled by nothing, each with what it is for.
 */
const HOOKS: Record<string, string> = {
  "m-decor": "marks a decorative layer nobody is asked to read — the picture spec's one exemption looks for it, with aria-hidden",
  "m-band": "the four theme captures in the slider, which the script finds by this name to move their edges",
};

/** The sheet with its comments out: a class named in a comment is not a rule. */
const SHEET = stripComments(HOME_CSS);

function classesIn(text: string, pattern: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(pattern)) out.add(m[1]);
  return out;
}

const styled = classesIn(SHEET, /\.(m-[a-z0-9-]+)/g);
const written = classesIn(WRITERS.map((p) => readSource(p)).join("\n"), /(?<![a-zA-Z0-9_-])(m-[a-z0-9-]+)(?![a-zA-Z0-9_-])/g);

describe("the front door's own stylesheet", () => {
  it("CONTROL: both lists are found at all, and hold what is known to be live", () => {
    // A reader that found nothing would pass every comparison below.
    expect(styled.size, "classes the sheet styles").toBeGreaterThan(100);
    expect(written.size, "classes the page writes").toBeGreaterThan(100);
    for (const live of ["m-hero", "m-phone", "m-plan", "m-in", "m-armed"]) {
      expect(styled.has(live), `${live} is styled`).toBe(true);
      expect(written.has(live), `${live} is written`).toBe(true);
    }
  });

  it("styles no class that nothing writes", () => {
    const dead = [...styled].filter((c) => !written.has(c)).sort();
    expect(dead, "rules for a class no file writes — delete the rule, or write the class").toEqual([]);
  });

  it("writes no class it does not style, except a named hook", () => {
    const bare = [...written].filter((c) => !styled.has(c) && !(c in HOOKS)).sort();
    expect(bare, "written and styled by nothing — style it, drop it, or name it in HOOKS with its reason").toEqual([]);
    // and the list of hooks does not outlive what it excuses
    const stale = Object.keys(HOOKS).filter((c) => !written.has(c) || styled.has(c));
    expect(stale, "a hook nothing writes any more, or one that has since been styled").toEqual([]);
  });

  it("scopes every rule to the page", () => {
    // Walk the sheet rule by rule: the text before each `{` is a selector list,
    // an at-rule's own header, or a keyframe's step.
    const loose: string[] = [];
    let depth = 0;
    let head = "";
    const inKeyframes: boolean[] = [];
    for (const ch of SHEET) {
      if (ch === "{") {
        const h = head.trim();
        const atRule = h.startsWith("@");
        const insideKeyframes = inKeyframes.includes(true);
        if (!atRule && !insideKeyframes) {
          for (const sel of h.split(",").map((s) => s.trim()).filter(Boolean)) {
            if (!sel.startsWith(".m-home")) loose.push(sel.slice(0, 80));
          }
        }
        inKeyframes.push(atRule && h.startsWith("@keyframes"));
        depth += 1;
        head = "";
      } else if (ch === "}") {
        depth -= 1;
        inKeyframes.pop();
        head = "";
      } else if (ch === ";" && depth > 0) {
        head = "";
      } else {
        head += ch;
      }
    }
    expect(depth, "the sheet's braces do not balance").toBe(0);
    expect(loose, "a selector that does not start at .m-home reaches other pages").toEqual([]);
  });

  it("defines every animation it names, and names every one it defines", () => {
    const defined = classesIn(SHEET, /@keyframes\s+(m-[a-z0-9-]+)/g);
    const named = new Set<string>();
    for (const m of SHEET.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
      for (const word of m[1].split(/[\s,]+/)) if (/^m-[a-z0-9-]+$/.test(word)) named.add(word);
    }
    expect(defined.size, "no keyframes were found").toBeGreaterThan(5);
    expect([...named].filter((n) => !defined.has(n)).sort(), "an animation with no keyframes — it does nothing").toEqual([]);
    expect([...defined].filter((d) => !named.has(d)).sort(), "keyframes nothing plays").toEqual([]);
  });

  it("writes no colour by hand", () => {
    // The palette is generated and graded (`landing-contrast.test.ts`); a hex
    // here would be a colour nobody graded. `rgba(0, 0, 0, …)` is a shadow and
    // `black`/`white` a mix endpoint — neither is a colour of the page.
    expect(SHEET.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "a hex colour in the home sheet").toEqual([]);
  });
});
