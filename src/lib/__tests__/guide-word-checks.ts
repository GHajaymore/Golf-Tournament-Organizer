import type { GuideSection } from "../guide-steps";

/**
 * THE GUIDE'S WORD CHECKS, in one place (R1b): `guide-steps.test.ts` holds the real guide to them and
 * `guide-redesign.test.ts` holds every redesign variant to the same ones. Not a test file: importing
 * a test file would run its tests twice.
 */

/** Every [[label]] a set of sections uses, flattened. */
export function guideLabelsOf(sections: readonly GuideSection[]): Set<string> {
  const all = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\[\[([^\]]+)\]\]/g)) all.add(m[1]);
  };
  for (const section of sections) {
    for (const b of section.blocks) {
      if ("text" in b) scan(b.text);
      if ("items" in b) for (const it of b.items) scan(typeof it === "string" ? it : JSON.stringify(it));
    }
  }
  return all;
}

/** What is wrong with a part's shape: an id the contents cannot anchor, no blocks, an id used twice. */
export function guideShapeProblems(sections: readonly GuideSection[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of sections) {
    if (!/^[a-z]+$/.test(s.id)) problems.push(`${s.id}: an id is lowercase letters only`);
    if (s.blocks.length === 0) problems.push(`${s.id}: no blocks`);
    if (seen.has(s.id)) problems.push(`${s.id}: used twice`);
    seen.add(s.id);
  }
  return problems;
}
