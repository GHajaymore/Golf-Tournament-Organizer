import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE SECONDARY TEXT COLOUR (Ajay, 2026-09-30).
 *
 * "I still see inconsistency." Secondary text had grown at least nine
 * hand-mixed greys — 45, 52, 55, 58, 62, 72, 78 and 82 per cent of the text
 * colour — beside the one token, `--color-text-muted`, that the theme solves
 * to 7:1 on both grounds. Each was a different grey on the same screen, and
 * the weakest read 4:1. They all read the token now.
 *
 * So no TEXT colour is a percentage of `--color-text`. Backgrounds, borders
 * and shadows may be (a 6% tint is a surface, not a grey word), and a
 * placeholder may be fainter than what gets typed, which is the convention.
 */

const ROOTS = [join("src", "app"), join("src", "components")];
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(css|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

/** `color:` (not background-color, border-color…) set to a mix of the text colour. */
const HAND_MIXED = /(?:^|[\s{;,])color:\s*["'`]?color-mix\(in srgb, var\(--color-text\) \d+%/;

describe("secondary text reads the one muted token", () => {
  const offenders: string[] = [];
  for (const f of ROOTS.flatMap(files)) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/placeholder/.test(line) || /placeholder/.test(lines[i - 1] ?? "")) return;
      if (HAND_MIXED.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }

  it("no text colour is a hand-mixed percentage of --color-text", () => {
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("CONTROL: the pattern catches the shape it is for", () => {
    expect(HAND_MIXED.test("  color: color-mix(in srgb, var(--color-text) 55%, transparent);")).toBe(true);
    expect(HAND_MIXED.test('          color: "color-mix(in srgb, var(--color-text) 72%, transparent)",')).toBe(true);
    // A background is a surface, not a grey word.
    expect(HAND_MIXED.test("  background: color-mix(in srgb, var(--color-text) 8%, transparent);")).toBe(false);
    expect(HAND_MIXED.test("  border-color: color-mix(in srgb, var(--color-text) 16%, transparent);")).toBe(false);
  });
});
