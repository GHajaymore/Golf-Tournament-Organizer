import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";

/**
 * A SPEC DOES NOT RELOAD STRAIGHT AFTER A WRITE PRESS (B122, from the QA gate of #1243).
 *
 * A press that saves runs a server action and then refreshes the screen. A `.reload()` written on the very
 * next line lands mid-save, which a person never does and which Firefox answers `NS_BINDING_ABORTED` (the
 * finding fixed in #1238).
 *
 * The rule read here: in `e2e/*.spec.ts`, read through `readSource` (comments stripped), between a write press
 * (`.click(`, `.fill(`, `.check(`, `.selectOption(`, `.press(`) and the next `.reload(` there must be a REAL wait:
 * an `expect` on what the press saved (on the screen, or an `expect.poll`) or `savedBeforeReload`. A timeout,
 * `networkidle`, `waitForLoadState` and any other statement are NOT waits, and a line holding one never counts
 * (`docs/claude/e2e-traps.md`).
 *
 * `savedBeforeReload` (`e2e/save-settled.ts`) is only a wait where the pressed control renders "Saving…"; on a
 * screen with no indicator it passes at once, so wait on the saved thing on the screen instead (the SITES list
 * below). A screen with no indicator is an Engineer follow-up (a SaveState), not something a spec can supply.
 *
 * A reload directly after a press is listed by `file:line-text` in `KNOWN_DIRECT_RELOADS`, CAPPED at
 * KNOWN_DIRECT_RELOADS_CAP and may only shrink. Eight today (27 Nov 2026), none in the twelve specs of B122.
 */
export const KNOWN_DIRECT_RELOADS: readonly string[] = [
  // 27 Nov 2026, found by the tightened rule in specs OUTSIDE B122's twelve; owner Test Engineer, follow-up "B122b": give each a real wait.
  "closing-a-round-where-the-cards-are.spec.ts:await section.getByRole(\"button\", { name: \"Keep it open\" }).click();",
  "closing-team-cup-and-tap-rounds.spec.ts:await section.getByRole(\"button\", { name: \"Keep it open\" }).click();",
  "event-setup-calm.spec.ts:await screen.teeSelect().selectOption(tee.id);",
  "event-setup-calm.spec.ts:await screen.lastDay().fill(\"2099-06-16\");",
  "event-setup-calm.spec.ts:await more.getByLabel(/No fixed course/).check();",
  "net-without-tees-says-so.spec.ts:await screen.teeSelect().selectOption(tee.id);",
  "organizer-tees.spec.ts:await screen.teeSelect().selectOption(white.id);",
  "organizer-tees.spec.ts:await screen.teeSelect().selectOption(\"\");",
];

/** The list's size today (8). NEVER RAISE: put a real wait before the reload instead. */
export const KNOWN_DIRECT_RELOADS_CAP = 8;

/** The least number of `.reload(` calls in the specs today (measured on this head). Raise it, never lower it. */
export const MIN_RELOADS = 100;

const WRITE_PRESS = /\.(click|fill|check|selectOption|press|blur|setChecked)\(/;
const RELOAD = /\.reload\(/;
/** A REAL wait: an `expect` (screen state or poll) or the helper. */
const REAL_WAIT = /\bexpect\b|\.poll\(|savedBeforeReload\(/;
/** A line holding any of these is never counted as the wait, even if it also holds an `expect`. */
const NOT_A_WAIT = /waitForTimeout|networkidle|waitForLoadState/;

export interface DirectReload {
  line: number;
  text: string;
  press: string;
}

/** Every `.reload(` of one spec source with a write press earlier in the same test and no real wait between them. */
export function directReloads(src: string): { reloads: number; direct: DirectReload[] } {
  const lines = src.split("\n");
  const direct: DirectReload[] = [];
  let reloads = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!RELOAD.test(lines[i])) continue;
    reloads++;
    let p = i - 1;
    while (p >= 0 && !WRITE_PRESS.test(lines[p]) && !/\btest(\.\w+)?\(/.test(lines[p])) p--;
    if (p < 0 || !WRITE_PRESS.test(lines[p])) continue; // no press earlier in this test
    const between = lines.slice(p + 1, i).filter((l) => !NOT_A_WAIT.test(l));
    if (!between.some((l) => REAL_WAIT.test(l))) direct.push({ line: i + 1, text: lines[i].trim(), press: lines[p].trim() });
  }
  return { reloads, direct };
}

const SPEC_DIR = join(process.cwd(), "e2e");
const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".spec.ts"));
const found = specs.map((f) => ({ f, ...directReloads(readSource("e2e", f)) }));
const keyOf = (f: string, d: DirectReload) => `${f}:${d.press}`;

describe("a spec waits on the save before it reloads", () => {
  it("finds the reloads (a broken reader would make the sweep pass on none)", () => {
    expect(found.reduce((n, x) => n + x.reloads, 0)).toBeGreaterThanOrEqual(MIN_RELOADS);
  });

  it("no reload follows a write press without a real wait between", () => {
    const bad = found.flatMap((x) => x.direct.filter((d) => !KNOWN_DIRECT_RELOADS.includes(keyOf(x.f, d))).map((d) => `${x.f}:${d.line} reloads after: ${d.press}`));
    expect(bad, "put an expect on the saved thing (screen or poll), or savedBeforeReload where 'Saving…' renders, between the press and the reload").toEqual([]);
  });

  it("KNOWN_DIRECT_RELOADS is capped: it may only shrink, never grow", () => {
    expect(KNOWN_DIRECT_RELOADS.length).toBeLessThanOrEqual(KNOWN_DIRECT_RELOADS_CAP);
  });

  it("the screen waits of B122 are in place: each spec waits on what the press saved before it reloads", () => {
    const SITES: Record<string, RegExp> = {
      "access.spec.ts": /the helper is not listed before the reload/,
      "club-staff.spec.ts": /the currency does not say it was saved/,
      "draws-and-play-offs.spec.ts": /the play-off is not offered before the reload/,
      "flight-board.spec.ts": /the player is not under Flight B before the reload/,
      "organizer-cup.spec.ts": /the lineup does not hold the match before the reload/,
      "side-game-renamed.spec.ts": /the new name is not on Side games before the reload/,
      "tournament-access.spec.ts": /the removed helper is still listed before the reload/,
      "weekly-sign-up.spec.ts": /the list does not count the player out before the reload/,
    };
    for (const [f, re] of Object.entries(SITES)) expect(readVerbatim("e2e", f), `${f} lost its wait before the reload`).toMatch(re);
  });

  it("CONTROL: a planted press then reload is refused, and a real wait between passes", () => {
    expect(directReloads("await save.click();\nawait page.reload();").direct).toHaveLength(1);
    expect(directReloads('await box\n  .getByRole("button", { name: "Save" })\n  .click();\nawait page.reload();').direct).toHaveLength(1);
    expect(directReloads("await save.click();\nawait savedBeforeReload(card);\nawait page.reload();").direct).toHaveLength(0);
    expect(directReloads("await save.click();\nawait expect.poll(row).toBe(1);\nawait page.reload();").direct).toHaveLength(0);
    expect(directReloads("await save.click();\nawait expect(card).toBeVisible();\nawait page.reload();").direct).toHaveLength(0);
  });

  it("CONTROL: a timeout, networkidle, or any other statement is not the wait", () => {
    expect(directReloads("await save.click();\nawait page.waitForTimeout(500);\nawait page.reload();").direct, "a timeout").toHaveLength(1);
    expect(directReloads('await save.click();\nawait page.waitForLoadState("networkidle");\nawait page.reload();').direct, "networkidle").toHaveLength(1);
    expect(directReloads("await save.click();\nconst x = 1;\nawait page.reload();").direct, "any other statement").toHaveLength(1);
    expect(directReloads("await save.click();\n}\nawait page.reload();").direct, "a closed block").toHaveLength(1);
    expect(directReloads("await save.click();\nawait expect(a).toBeVisible(); await page.waitForTimeout(5);\nawait page.reload();").direct, "a line with a timeout is never the wait").toHaveLength(1);
    expect(directReloads("test('a', async () => {\nawait page.reload();").direct, "a reload with no press in its test").toHaveLength(0);
  });
});
