import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * ACCENT WORDS ARE STEP 200 (Ajay, 2026-09-30: "are you sure you fixed the
 * issue and its consistent?").
 *
 * Fixing the leaderboard left the rest of the app as it was: a scan of 28
 * screens on both grounds found 292 words under 7:1, most of them an inline
 * `color:` in the accent at step 500, 400 or 300 — links, kickers, the green
 * of money owed, a round's number. Every one of those is text, and the text
 * step is 200 (themes.test measures it at 7:1 for every preset on both
 * grounds). 100 is darker still and allowed; 300 is the FILL a label sits on.
 *
 * This pins the direct shape and the one-line ternary. A ternary split over
 * several lines is not seen here — the rendered scan is the check for that.
 */

const ROOTS = [join("src", "app"), join("src", "components")];
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(css|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const WEAK = String.raw`var\(--color-accent(?:-2)?(?:-300|-400|-500)?\)`;
/** `color:` itself (not border-color, borderColor, caret-color) set straight to a weak step. */
const DIRECT = new RegExp(String.raw`(?<![A-Za-z-])color:\s*["'\x60]?` + WEAK);
/** `color: cond ? "…" : "…"` on one line, either branch a weak step. */
const TERNARY = new RegExp(String.raw`(?<![A-Za-z-])color:[^,;{}]*\?[^,;{}]*` + WEAK);

const weak = (line: string) => DIRECT.test(line) || TERNARY.test(line);

describe("accent words read crisp", () => {
  const offenders: string[] = [];
  for (const f of ROOTS.flatMap(files)) {
    readSource(f).split(/\r?\n/).forEach((line, i) => {
      if (weak(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }

  it("no text colour is the accent at step 300, 400 or 500", () => {
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("CONTROL: catches the shapes it is for, and not the ones it isn't", () => {
    expect(weak('<Link style={{ color: "var(--color-accent)" }}>')).toBe(true);
    expect(weak("  color: var(--color-accent-300);")).toBe(true);
    expect(weak('color: owed ? "var(--color-accent-2-300)" : "var(--color-text)",')).toBe(true);
    expect(weak('color: s === "in" ? "var(--color-text)" : "var(--color-accent-400)",')).toBe(true);
    // The text steps, a fill, and a border are all fine.
    expect(weak('color: "var(--color-accent-200)"')).toBe(false);
    expect(weak('color: "var(--color-accent-2-100)"')).toBe(false);
    expect(weak('background: "var(--color-accent-300)", color: "var(--color-on-accent)"')).toBe(false);
    expect(weak('borderColor: "var(--color-accent)"')).toBe(false);
    expect(weak("  border-left-color: var(--color-accent);")).toBe(false);
  });
});
