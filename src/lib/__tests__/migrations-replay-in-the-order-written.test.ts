import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A FRESH DATABASE REPLAYS THE MIGRATIONS IN TEXT ORDER, so a new one must be
 * named to replay LAST.
 *
 * It has bitten once: folders numbered 0_ to 27_ replayed as 0, 1, 10, 11 …
 * 19, 2, 20, and a fresh database died on the first migration that touched a
 * table an earlier-numbered one had not made yet (`scripts/pad-migration-names.mjs`
 * renamed them to two digits). And it was about to again: two digits run out at
 * 99, and "100_" sorts BEFORE "10_". CI builds a fresh database on every run.
 *
 * THE HISTORY IS NOT IN ORDER, AND STAYS AS IT IS. Twenty-six migrations of
 * August and September 2026 carry Prisma's timestamp names, which sort between
 * 19_ and 20_ although most were written after 40_. A fresh database replays
 * them there and works — CI proves it on every run — so they are history, and
 * renaming applied migrations is its own risk (see pad-migration-names).
 *
 * The rule from 2026-10-14 is about what comes NEXT: A000_ to A999_, then
 * B000_. A capital letter sorts after every digit, so each new one replays
 * after all of the history, and the three digits after it sort among
 * themselves. A new timestamp name would replay in the middle of the history,
 * and is refused with the rest.
 */
const DIR = join(process.cwd(), "prisma", "migrations");
/** The last timestamp-named migration there is: none may be newer. */
const LAST_TIMESTAMP = "20260925010000";
const HISTORY = /^(?:\d{2}|\d{14})_[a-z0-9_]+$/;
const NEXT = /^[A-Z]\d{3}_[a-z0-9_]+$/;

describe("a new migration replays after every one before it", () => {
  const folders = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isDirectory());

  it("CONTROL: the trap is real, and the names refuse it", () => {
    expect(["10_b", "100_a"].sort()).toEqual(["100_a", "10_b"]);
    expect(HISTORY.test("100_stage_cut_made_at") || NEXT.test("100_stage_cut_made_at")).toBe(false);
    expect(NEXT.test("A000_stage_cut_made_at")).toBe(true);
    expect(["A000_x", "99_y", "B000_z", "A001_w", "20260925010000_v"].sort()).toEqual([
      "20260925010000_v", "99_y", "A000_x", "A001_w", "B000_z",
    ]);
    expect(folders.length).toBeGreaterThan(99);
  });

  it("every folder is history or named to come next", () => {
    expect(folders.filter((f) => !HISTORY.test(f) && !NEXT.test(f))).toEqual([]);
  });

  it("no timestamp name newer than the history, which would replay in the middle of it", () => {
    const stamps = folders.filter((f) => /^\d{14}_/.test(f)).map((f) => f.slice(0, 14));
    expect(stamps.length).toBe(26);
    expect(stamps.filter((s) => s > LAST_TIMESTAMP)).toEqual([]);
  });

  it("the new ones replay after all of the history, in their own order, with no number used twice", () => {
    const sorted = [...folders].sort();
    const next = folders.filter((f) => NEXT.test(f)).sort();
    expect(sorted.slice(sorted.length - next.length), "a new migration does not replay last").toEqual(next);
    const heads = next.map((f) => f.split("_")[0]);
    expect(heads.filter((h, i) => heads.indexOf(h) !== i)).toEqual([]);
  });
});
