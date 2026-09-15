import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// A plain .mjs helper, shared with the e2e fixture and the smoke scripts —
// they run outside the bundler, so it cannot live in `src`.
import { runMark } from "../../../scripts/run-mark.mjs";

/**
 * TWO SESSIONS ON ONE MACHINE DO NOT DELETE EACH OTHER'S FIXTURE.
 *
 * Every fixture here is named with a `zz-` mark and removed by deleting
 * everything that starts with it. The seeding path opens with that delete, so
 * a mark shared by every run means one run clears another's rows MID-RUN.
 *
 * Found 2026-09-14 by two sessions in parallel worktrees, in both directions:
 * five `offline.spec` tests failing together and then passing 5/5 in under
 * seven seconds on a re-run, and `verify-drafting` reporting seven failed
 * checks and then a clean pass — neither with anything changed in between.
 *
 * WHY IT NEEDS A TEST rather than just the fix. The failure it causes is
 * indistinguishable from a dead server: timeouts rather than assertions,
 * cascading, whole files at a time. CLAUDE.md documents that signature and
 * attributes it to the server dying, so a regression here does not announce
 * itself — it sends the next person to restart something that was never
 * broken. Nothing else in the suite would notice.
 */

describe("a fixture mark is per worktree", () => {
  it("differs between worktrees", () => {
    // The property the whole fix rests on. Two checkouts of this repo on one
    // machine must not produce the same mark.
    expect(runMark("zz-e2e", "/tmp/vigilant-hawking-0bb600")).not.toBe(
      runMark("zz-e2e", "/tmp/bold-darwin-632bc6"),
    );
  });

  it("is the same every run in one worktree", () => {
    /**
     * NOT A UUID, and this is the assertion that says why.
     *
     * The delete at the start of seeding is also what clears rows a CRASHED
     * run left behind. A mark unique per run would never match its own
     * leftovers, so every killed run would leak a fixture nothing removes —
     * trading a loud failure for a slow one.
     */
    const a = runMark("zz-e2e", "/tmp/same-tree");
    const b = runMark("zz-e2e", "/tmp/same-tree");
    expect(a).toBe(b);
  });

  it("still reads as a fixture", () => {
    // `zz-` is how a person scanning the database tells a fixture from a real
    // tournament, and how a deliberate sweep finds every run's rows.
    const mark = runMark("zz-e2e", "/tmp/anywhere");
    expect(mark.startsWith("zz-e2e")).toBe(true);
    expect(mark).not.toBe("zz-e2e");
  });

  it("does not collide between two different bases", () => {
    // The smoke scripts each have their own base. Same worktree, different
    // script, must still be different rows.
    expect(runMark("zz-verify-drafting", "/tmp/t")).not.toBe(runMark("zz-verify-week-view", "/tmp/t"));
  });
});

/**
 * AND EVERY FIXTURE-SEEDING FILE USES IT.
 *
 * The sweep, because this was five files with the identical mistake and the
 * sixth will be written by somebody who has not read any of them. A fixed mark
 * is fine right up until a second session exists, which is why it survived so
 * long.
 */
describe("every file that seeds a fixture marks it per run", () => {
  /** Files that delete rows by a `zz-` prefix — i.e. own a fixture. */
  function seeders(): string[] {
    const out: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        if (!/\.mjs$/.test(entry.name)) continue;
        const p = join(dir, entry.name);
        const src = readFileSync(p, "utf8");
        // The shape that owns a fixture: a mark, and a delete keyed on it.
        if (/const MARK\s*=/.test(src) && /startsWith:\s*MARK/.test(src)) {
          out.push(p.replace(/\\/g, "/"));
        }
      }
    };
    scan("scripts");
    scan("e2e");
    return out;
  }

  const files = seeders();

  it("finds the files that own a fixture — the sweep's own control", () => {
    /**
     * Five on 2026-09-14: the e2e fixture and four `verify-*` scripts. A zero
     * here would make the assertion below vacuously true, and this sweep
     * matches on a code shape rather than a filename, so a refactor really
     * could empty it.
     */
    expect(files.length, "no fixture-seeding files found — the sweep is broken").toBeGreaterThan(3);
  });

  it.each(files)("%s derives its mark per run", (file) => {
    const src = readFileSync(file, "utf8");
    expect(
      /const MARK\s*=\s*runMark\(/.test(src),
      `this file seeds a fixture and deletes by a FIXED mark, so its opening ` +
        `delete will reach into a concurrent run's rows and take that run's ` +
        `tests down with it. Wrap the mark in runMark() from scripts/run-mark.mjs.`,
    ).toBe(true);
  });
});
