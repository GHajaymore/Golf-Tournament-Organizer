import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { orgProfile, ORG_KINDS } from "@/lib/domain/org-profile";

/**
 * EVERY FLAG ON AN OUTFIT'S PROFILE DECIDES SOMETHING.
 *
 * `no-dead-feature-keys.test.ts` asks this of plan features. `OrgProfile` is
 * the same shape of trap and was never swept: three booleans describing what a
 * club, a society or a personal account IS, each read — or not — by whatever
 * happens to remember.
 *
 * It had a live example the day this was written. `seasonPlay` sat in
 * `org-profile.ts` with a comment describing what it meant, and **nothing in
 * the application read it**. It was found on 2026-09-17 only because somebody
 * tried to advertise it in a picker and went to check what it did — which is
 * precisely how long a flag can gate nothing before anybody notices. It was
 * deleted on 2026-09-20, which is this guard working rather than this guard
 * losing its example: the sweep below is what keeps the next one honest.
 *
 * The cost is the same as a dead plan feature: a profile flag reads as a rule
 * the app enforces, so the next person reasons from it, writes a screen around
 * it, and ships behaviour that was never there.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !full.includes("__tests__")) out.push(full.slice(process.cwd().length + 1));
  }
  return out;
}

// Comments stripped: every flag is named in the paragraph explaining it, and a
// raw search would find each one in its own documentation and call it read.
const FILES = sourceFiles(SRC).filter((f) => !f.endsWith(join("domain", "org-profile.ts")));
const BODIES = new Map(FILES.map((f) => [f, readSource(f)]));

/**
 * `flag` → why nothing reads it. Every entry is a decision somebody owes.
 *
 * EMPTY, and that is the finished state rather than an unwritten one. It held
 * `seasonPlay` from 2026-09-18 until Ajay's call on 2026-09-20; the flag is
 * deleted and the record of what it was meant to mean moved to the prose on
 * `ledger` in `org-profile.ts`, which is where it survives the flag.
 *
 * An entry here is a debt, not a dispensation. Anything added should name the
 * person who owes the decision and the date it was flagged, so the next reader
 * can tell a deliberate pause from something nobody ever came back to.
 */
const UNREAD: Record<string, string> = {};

describe("every profile flag decides something", () => {
  // Spread rather than cast: `OrgProfile` has no index signature, so
  // `as Record<string, unknown>` is a TS2352 error — and a spread is what the
  // sweep actually wants, which is the object read by key rather than by name.
  const club: Record<string, unknown> = { ...orgProfile("club") };
  const flags = Object.keys(club).filter((k) => typeof club[k] === "boolean");

  it("has flags and files to search", () => {
    // The control, in both directions: a sweep with no flags or no files is a
    // sweep that passes for ever.
    // Three since `seasonPlay` went on 2026-09-20. A floor rather than an
    // equality: this is here to catch a sweep looking at nothing, not to make
    // adding a flag fail.
    expect(flags.length).toBeGreaterThanOrEqual(3);
    expect(FILES.length).toBeGreaterThan(200);
  });

  for (const flag of flags) {
    it(`"${flag}" is read somewhere`, () => {
      const readers = [...BODIES]
        .filter(([, body]) => body.includes(`.${flag}`))
        .map(([file]) => file);
      if (UNREAD[flag]) {
        expect(readers, `${flag} is read now — take it off the UNREAD list`).toEqual([]);
        return;
      }
      expect(
        readers,
        `${flag} is on every outfit's profile and nothing reads it. A flag that decides nothing reads as a rule the app enforces, and the next person will build a screen around it.`,
      ).not.toEqual([]);
    });
  }

  it("keeps no exemption for a flag that no longer exists", () => {
    /**
     * THE MIRROR, and without it this file's allowlist could never fail.
     *
     * The sweep above iterates the flags on the PROFILE, so an `UNREAD` entry
     * for a flag that has been deleted is consulted by nothing: no test is
     * generated for it, and the entry sits for ever reading as a live
     * exemption somebody is still weighing. `seasonPlay` would have become
     * exactly that on 2026-09-20 had it been deleted and its entry left.
     *
     * Same shape as the exemption check in `audit-guards.test.ts` — an
     * allowlist nobody re-reads becomes a place to hide things, so every entry
     * has to prove it still describes something real.
     */
    for (const flag of Object.keys(UNREAD)) {
      expect(flags, `${flag} is exempted but is no longer a profile flag — drop the entry`).toContain(
        flag,
      );
    }
  });

  it("means the same thing for every kind it describes", () => {
    /**
     * Not a sweep — a sanity check on the data itself, because the flags are
     * only worth guarding if they actually differ between kinds. If every kind
     * agreed on all of them, the profile would be describing nothing.
     */
    const rows: Record<string, unknown>[] = ORG_KINDS.map((k) => ({ ...orgProfile(k) }));
    const differs = flags.some((f) => new Set(rows.map((r) => r[f])).size > 1);
    expect(differs, "no flag differs between kinds — the profile decides nothing at all").toBe(true);
  });
});
