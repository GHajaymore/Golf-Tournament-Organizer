import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY STAGE A FAMILY WALK STANDS AT ASKS THE LOCK TOO (J13).
 *
 * J13 is three things at every stage: the status, the lock and the one next
 * action. The family walks (`e2e/status-*.spec.ts`) were written asking two of
 * them — `expectTournamentSays` read the chip and the button — and for a week
 * the lock column of the family table was empty without anything saying so. The
 * helper now takes `lock` ("open", "live" or "completed": what Rounds & formats'
 * banner says), and this holds every call in every walk to giving it, so a stage
 * added later cannot leave the lock out quietly.
 *
 * It reads the specs' source (comments stripped, `readSource`). A call is either
 * `expectTournamentSays(page, { … })` — the object must name `lock` — or
 * `expectTournamentSays(page, name)`, where `const name = { … }` in the same
 * file must. The control at the bottom proves the reader can see a call with no
 * lock.
 */

const CALL = "expectTournamentSays(page,";

/** The text of the balanced `{ … }` that opens at `from` (which must be a `{`). */
function braces(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from);
}

/** Each call's argument as written — the object's text — with the line it is on. */
function callsWithoutLock(src: string): number[] {
  const missing: number[] = [];
  let at = src.indexOf(CALL);
  while (at !== -1) {
    let i = at + CALL.length;
    while (src[i] === " " || src[i] === "\n" || src[i] === "\r") i += 1;
    let object: string;
    if (src[i] === "{") {
      object = braces(src, i);
    } else {
      // A named object: `const over = { … }` somewhere in the file.
      let end = i;
      while (end < src.length && src[end] !== ")" && src[end] !== ",") end += 1;
      const name = src.slice(i, end).trim();
      const made = src.indexOf(`const ${name} = {`);
      object = made === -1 ? "" : braces(src, src.indexOf("{", made));
    }
    if (!object.includes("lock:")) missing.push(src.slice(0, at).split("\n").length);
    at = src.indexOf(CALL, at + CALL.length);
  }
  return missing;
}

const walks = readdirSync(join(process.cwd(), "e2e")).filter((f) => f.startsWith("status-") && f.endsWith(".spec.ts"));

describe("every stage a family walk stands at asks the lock too (J13)", () => {
  it("finds the walks, and they call the helper", () => {
    expect(walks.length).toBeGreaterThanOrEqual(9);
    const calling = walks.filter((f) => readSource("e2e", f).includes(CALL));
    // The nine that read the dashboard's chip: the eight families with a lifecycle, and the timeline.
    expect(calling.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of walks) {
    it(`${file}: every expectTournamentSays names the lock`, () => {
      expect(callsWithoutLock(readSource("e2e", file)), "calls with no lock, by line").toEqual([]);
    });
  }

  it("CONTROL: a call with no lock is seen, inline or by name; one with a lock is not", () => {
    const inline = `await expectTournamentSays(page, { chip: "Live", nextAction: null });`;
    const named = `const over = { chip: "Play over", nextAction: null } as const;\nawait expectTournamentSays(page, over);`;
    const nested = `await expectTournamentSays(page, {\n  chip: "Live",\n  refused: { because: "x", wayOut: { says: "y", href: "/z" } },\n});`;
    expect(callsWithoutLock(inline)).toEqual([1]);
    expect(callsWithoutLock(named)).toEqual([2]);
    expect(callsWithoutLock(nested)).toEqual([1]);
    expect(callsWithoutLock(inline.replace("{ chip", `{ lock: "live", chip`))).toEqual([]);
    expect(callsWithoutLock(named.replace("{ chip", `{ lock: "live", chip`))).toEqual([]);
    expect(callsWithoutLock(nested.replace(`chip: "Live",`, `chip: "Live",\n  lock: "live",`))).toEqual([]);
  });
});
