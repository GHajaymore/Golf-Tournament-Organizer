import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./source";

/**
 * EVERY READ THAT MEANS "THE FLIGHTS" SAYS SO.
 *
 * `Group` does two jobs — a flight of the field, and a player-less match
 * carrier that exists only because `Match.groupId` is NOT NULL — and
 * `isCarrier` is what separates them. Six reads were taught that on
 * 2026-09-15. Six reads that agree today is a LIST, and this repo has spent
 * the week learning what lists cost: a fixture sweep keyed on one prefix
 * missed the script using the other, and the guard `isManualFormat` was
 * exactly "a guard you must remember to call".
 *
 * So the rule is swept rather than remembered. A reader written next year is
 * covered the day it is added, and a reader that genuinely wants every Group
 * row has to say why in `ALLOWED` rather than simply forgetting.
 *
 * WHY NOT ONE FUNCTION THEY ALL CALL, which was the obvious suggestion. The
 * readers are not one shape: `loadEventState` does `findMany`, the setup flow
 * does `count`, four actions do `findFirst` by a caller-supplied id, and
 * `matchCarrierGroup` looks for `isCarrier: true`. A shared helper would fit
 * two of them and be bypassed by the rest, which is a list again with extra
 * indirection. What IS shared is the obligation to decide, and that is what
 * this file enforces.
 *
 * `loadEventState` remains the real sink for everything downstream —
 * `state.groups` is filtered once there and the dashboard, the flights screen
 * and the tee sheet all inherit it without knowing this rule exists. This
 * covers the reads that go round it.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The reads that could be mistaken for "the flights". Writes are not. */
const READS = ["findMany", "findFirst", "findUnique", "count"];

/**
 * The text of one `prisma.group.<method>(...)` call, by paren depth.
 *
 * Depth rather than a regex, and deliberately: CLAUDE.md records three sweeps
 * in one day disarmed by a shell eating a backslash — one reported 211 of 211
 * server actions unreachable because every pattern had been turned into a
 * backspace byte. A scan built from `indexOf` and a counter cannot be
 * silently disarmed that way.
 */
function callAt(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen);
}

interface Site {
  file: string;
  method: string;
  call: string;
}

function groupReads(): Site[] {
  const sites: Site[] = [];
  for (const full of sourceFiles(SRC)) {
    // Stripped, or the long comment above a filtered query would satisfy the
    // assertion instead of the query — the `readSource` trap, which cost this
    // codebase two green duds on 2026-09-05.
    const src = stripComments(readFileSync(full, "utf8"));
    const file = relative(SRC, full).split(sep).join("/");
    let from = 0;
    for (;;) {
      const at = src.indexOf("prisma.group.", from);
      if (at === -1) break;
      from = at + 1;
      const rest = src.slice(at + "prisma.group.".length);
      const method = rest.slice(0, rest.indexOf("("));
      if (!READS.includes(method)) continue;
      const open = at + "prisma.group.".length + method.length;
      sites.push({ file, method, call: callAt(src, open) });
    }
  }
  return sites;
}

/**
 * Reads that deliberately take every Group row, each with its reason.
 *
 * Short by design, and every entry is a place the rule can rot. A reason that
 * is not written here is a filter somebody forgot.
 */
const ALLOWED: Record<string, string> = {
  /**
   * A LOOKUP TABLE, not a list of flights. Both build `groupId -> teeId` and
   * are read through `player.groupId`, so a carrier contributes an entry
   * nothing can reach. Filtering could only LOSE information: on a row already
   * damaged by the old regenerate — a carrier holding players — dropping it
   * would silently fall those players back to the round's tees, which is a
   * scoring change made on the way past.
   */
  "lib/services/handicaps.ts": "groupId -> teeId lookup, read through player.groupId",
  /** Explicit ids from the caller; it is answering about rows already chosen. */
  "lib/services/handicap-record.ts": "takes the group ids it is asked about",
  /**
   * Filters on `captainId` / `viceCaptainId`, which a carrier never has —
   * nothing appoints one, and `setFlightCaptain` now refuses a carrier outright.
   */
  "lib/services/availability.ts": "already narrowed to rows with a captain",
};

describe("a read that means the flights says so", () => {
  const sites = groupReads();

  it("finds the reads at all, so a green run is not an empty one", () => {
    /**
     * THE CONTROL. A sweep that finds nothing may be broken rather than
     * reporting a clean codebase — three sweeps on 2026-09-13 were measuring
     * nothing and only the ones with controls said so. Two halves: the scan
     * finds a useful number of sites, and it finds specific ones known to
     * exist and known to be filtered.
     */
    expect(sites.length).toBeGreaterThan(8);

    const filtered = sites.filter((s) => s.call.includes("isCarrier"));
    expect(filtered.length, "no filtered read found — the scan is broken").toBeGreaterThan(4);

    // Named, so a refactor that moves the sink somewhere else fails here
    // rather than quietly leaving this file asserting nothing.
    const files = new Set(sites.map((s) => s.file));
    expect(files, "loadEventState is the sink and must be in the sweep").toContain(
      "lib/services/tournament.ts",
    );
    expect(files).toContain("lib/services/regroup.ts");
  });

  it("every read either filters on isCarrier or is allowed with a reason", () => {
    const offenders = sites
      .filter((s) => !s.call.includes("isCarrier"))
      .filter((s) => !(s.file in ALLOWED))
      .map((s) => `${s.file} — prisma.group.${s.method}(...)`);

    expect(
      offenders,
      "A Group read that does not say whether it means flights or carriers. " +
        "Add `isCarrier: false` (or `true` for a carrier lookup), or add the " +
        "file to ALLOWED with the reason it wants every row.",
    ).toEqual([]);
  });

  it("keeps the allow-list honest", () => {
    /**
     * An ALLOWED entry for a file that no longer reads groups is a licence
     * nobody is using, and the next reader takes it as precedent. This is the
     * half that makes the list shrink on its own.
     */
    const reading = new Set(sites.map((s) => s.file));
    for (const file of Object.keys(ALLOWED)) {
      expect(reading, `${file} is allow-listed but no longer reads groups`).toContain(file);
    }
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim().length, `${file} needs a real reason`).toBeGreaterThan(20);
    }
  });
});
