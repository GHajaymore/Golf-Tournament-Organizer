import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A SPEC DOES NOT RELOAD STRAIGHT AFTER A WRITE PRESS (B122, from the QA gate of #1243).
 *
 * A press that saves runs a server action and then refreshes the screen. A `.reload()` written on the very
 * next line lands mid-save, which a person never does and which Firefox answers `NS_BINDING_ABORTED` (the
 * finding fixed in #1238). Between the press and the reload there must be a WAIT: `savedBeforeReload(scope)`
 * (`e2e/save-settled.ts`), or an `expect` / `expect.poll` on the value the press saved. Never a timeout and
 * never `networkidle` (`docs/claude/e2e-traps.md`).
 *
 * The rule read here: in `e2e/*.spec.ts`, read through `readSource` (comments stripped), the statement written
 * IMMEDIATELY before a `.reload(` must not be a write press (`.click(`, `.fill(`, `.check(`, `.selectOption(`,
 * `.press(`). Any other statement counts as the wait: the helper, an `expect`, a `poll`.
 *
 * A reload that is directly after a press is listed by `file:line-text` in `KNOWN_DIRECT_RELOADS`, which is
 * CAPPED at KNOWN_DIRECT_RELOADS_CAP and may only shrink. It is empty today (27 Nov 2026).
 */
export const KNOWN_DIRECT_RELOADS: readonly string[] = [];

/** The list's size today (0). NEVER RAISE: put `savedBeforeReload` or an `expect.poll` before the reload instead. */
export const KNOWN_DIRECT_RELOADS_CAP = 0;

/** The least number of `.reload(` calls in the specs today (measured on this head). Raise it, never lower it. */
export const MIN_RELOADS = 100;

const WRITE_PRESS = /\.(click|fill|check|selectOption|press|blur|setChecked)\(/;
const RELOAD = /\.reload\(/;

export interface DirectReload {
  line: number;
  text: string;
  press: string;
}

/** Every `.reload(` of one spec source whose previous code statement is a write press. */
export function directReloads(src: string): { reloads: number; direct: DirectReload[] } {
  const lines = src.split("\n");
  const direct: DirectReload[] = [];
  let reloads = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!RELOAD.test(lines[i])) continue;
    reloads++;
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === "") j--;
    if (j < 0) continue;
    // The previous statement may span lines: walk up to its first line (one that starts with `await` or `expect`).
    let k = j;
    while (k > 0 && !/^\s*(await|expect|const|let|return)\b/.test(lines[k])) k--;
    const stmt = lines.slice(k, j + 1).join("\n");
    if (WRITE_PRESS.test(stmt) && !/\bexpect\b|savedBeforeReload|\.poll\(/.test(stmt)) {
      direct.push({ line: i + 1, text: lines[i].trim(), press: stmt.trim() });
    }
  }
  return { reloads, direct };
}

const SPEC_DIR = join(process.cwd(), "e2e");
const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".spec.ts"));
const found = specs.map((f) => ({ f, ...directReloads(readSource("e2e", f)) }));
const keyOf = (f: string, d: DirectReload) => `${f}:${d.text}`;

describe("a spec waits on the save before it reloads", () => {
  it("finds the reloads (a broken reader would make the sweep pass on none)", () => {
    expect(found.reduce((n, x) => n + x.reloads, 0)).toBeGreaterThanOrEqual(MIN_RELOADS);
  });

  it("no reload directly follows a write press", () => {
    const bad = found.flatMap((x) => x.direct.filter((d) => !KNOWN_DIRECT_RELOADS.includes(keyOf(x.f, d))).map((d) => `${x.f}:${d.line} reloads straight after: ${d.press}`));
    expect(bad, "put savedBeforeReload(scope) from e2e/save-settled.ts, or an expect.poll on the saved value, between the press and the reload").toEqual([]);
  });

  it("KNOWN_DIRECT_RELOADS is capped: it may only shrink, never grow", () => {
    expect(KNOWN_DIRECT_RELOADS.length).toBeLessThanOrEqual(KNOWN_DIRECT_RELOADS_CAP);
  });

  it("the twelve specs of B122 each wait with the helper before a reload that follows a save", () => {
    for (const f of ["access", "club-staff", "organizer-entry", "flight-board", "named-side-bet", "side-game-renamed", "skins-pot", "organizer-cup", "draws-and-play-offs", "tournament-access", "weekly-sign-up", "rounds-and-formats"]) {
      expect(readSource("e2e", `${f}.spec.ts`), `${f}.spec.ts lost its savedBeforeReload`).toMatch(/savedBeforeReload\(/);
    }
  });

  it("CONTROL: a planted press then reload is refused, and a wait between passes", () => {
    const planted = 'await save.click();\nawait page.reload();';
    expect(directReloads(planted).direct).toHaveLength(1);
    const multi = 'await box\n  .getByRole("button", { name: "Save" })\n  .click();\nawait page.reload();';
    expect(directReloads(multi).direct).toHaveLength(1);
    expect(directReloads('await save.click();\nawait savedBeforeReload(card);\nawait page.reload();').direct).toHaveLength(0);
    expect(directReloads('await save.click();\nawait expect.poll(row).toBe(1);\nawait page.reload();').direct).toHaveLength(0);
    expect(directReloads('await save.click();\nawait expect(card).toBeVisible();\nawait page.reload();').direct).toHaveLength(0);
  });
});
