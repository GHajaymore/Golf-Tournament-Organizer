import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { holesPlayed } from "../domain/handicap";
import { readSource } from "./source";

/**
 * HOW LONG A ROUND IS GETS NORMALISED IN ONE PLACE.
 *
 * A round's length is stored as a plain integer and is only ever 9 or 18, so
 * every reader has to say so. `holesPlayed` was extracted for exactly that, and
 * its own note says why: a path that forgot it passed a hard 18, and a
 * nine-hole four-ball was priced with eighteen-hole handicaps — roughly twice
 * the strokes the sides were owed, on a card with nine holes on it.
 *
 * Then it was not adopted. Five files used it and **forty-two call sites went
 * on writing `holes === 9 ? 9 : 18` by hand**, across server actions, services,
 * domain helpers and a dozen screens. A helper you must remember to reach for
 * is the same shape as a guard you must remember to call, and this file is what
 * turns it into one you cannot forget.
 *
 * Swept from the filesystem rather than listed, for the reason `layout.spec.ts`
 * and the board sweep are: a list covers the files somebody remembered.
 */

const SRC = "src";

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

describe("a round's length", () => {
  it("is normalised through holesPlayed and nowhere else", () => {
    /**
     * `handicap.ts` is exempt because it DEFINES it — and only that file. The
     * objection `knockout-readers.test.ts` makes to file-level exemptions is
     * about allowing everything in a file for ever; here the exempted file is
     * the one line being guarded.
     *
     * Read through `readSource`, which strips comments, so the prose above
     * `holesPlayed` describing the ternary cannot satisfy this by accident.
     * That is the one mutation failure that looks like a mutation success.
     */
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      if (f.endsWith(join("domain", "handicap.ts"))) continue;
      for (const line of readSource(f).split("\n")) {
        if (/===\s*9\s*\?\s*9\s*:\s*18/.test(line)) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      `use holesPlayed() instead of writing the ternary again: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("answers 9 for a nine and 18 for everything else", () => {
    /**
     * The BEHAVIOUR, so the sweep above is guarding something that works. The
     * "everything else" half is the point: the column is a plain integer and a
     * round set to 0, or left null by an older row, must not price a card over
     * nought holes.
     */
    expect(holesPlayed(9)).toBe(9);
    expect(holesPlayed(18)).toBe(18);
    for (const odd of [0, 1, 8, 10, 17, 27, -9]) {
      expect(holesPlayed(odd), `${odd} holes`).toBe(18);
    }
    expect(holesPlayed(null)).toBe(18);
    expect(holesPlayed(undefined)).toBe(18);
  });
});
