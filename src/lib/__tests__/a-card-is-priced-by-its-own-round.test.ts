import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSource } from "./source";

/**
 * NOBODY PRICES A CARD OFF THE TOURNAMENT'S TEES.
 *
 * `Event.defaultTeeId` is one value for a whole tournament. Which set a ROUND is
 * played from is a per-round answer — `Stage.teeId`, then the event's, then the
 * first set on the course actually being played — and `teeForPlay` is the chain.
 *
 * Nine call sites converted a roster of Handicap Indexes into Course Handicaps
 * and six of them asked the tournament: three through `teeSetupFor`, three
 * through `roundTeeId`. Every one of them had the round in hand. Three of the six
 * WRITE what they compute — net match play stores its per-hole winners, the team
 * recompute stores a side's card, the net importer converts net to gross and
 * stores the gross, and nothing recomputes a stored stroke.
 *
 * And each built its ratings map without `courseId`, which `courseHandicapMap`
 * reads — in its own words — as "a caller that supplies ratings without a
 * courseId cannot be judged, and must keep behaving exactly as it did", so a
 * stored `Player.teeId` from another venue resolved to a real rating from the
 * wrong club while everybody beside them was priced correctly.
 *
 * SWEPT FROM THE FILESYSTEM, not from a list, because a list of readers goes out
 * of date exactly when it matters — the format axis of this same bug missed its
 * fifth board for a day and a filesystem sweep found a sixth on its first run.
 *
 * Two deliberate exemptions, both documented in CLAUDE.md and both named below.
 * They are not exceptions to the rule; they are places where the question the
 * rule answers is not being asked. If a third appears it wants writing down
 * rather than adding here quietly.
 */

const ROOT = path.join(process.cwd(), "src");

/** Every .ts/.tsx under src, so a file added tomorrow is swept tomorrow. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
    }
  }
  return out;
}

const FILES = walk(ROOT);

/**
 * The two places that resolve a tee for a ROSTER rather than a card.
 *
 * `regroup.ts` balances flights over a CHAIN of qualifying rounds, which has no
 * single card to resolve per round — and flighting, seeding and the draw are
 * deliberately roster-level questions, which `loadEventState` says of its own
 * `hcpOf` in the same words. `week-view.ts` documents the identical exemption for
 * its match tiebreaks. `tournament.ts` builds the per-round and per-match maps
 * themselves, through `teeForPlay`, which is the rule rather than a bypass of it.
 */
const EXEMPT = new Set([
  "src/lib/services/regroup.ts",
  "src/lib/services/week-view.ts",
  "src/lib/services/tournament.ts",
]);

/** Where `courseHandicapMap` is defined and where the sanctioned wrapper lives. */
const OWNERS = new Set(["src/lib/domain/handicap.ts", "src/lib/services/handicaps.ts"]);

describe("a card is priced by its own round", () => {
  it("has something to sweep", () => {
    /**
     * THE CONTROL FOR THE WALK. A broken `walk` and a clean codebase both report
     * zero offenders, and only this can tell them apart — the same discipline
     * CLAUDE.md asks of every sweep.
     */
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES).toContain("src/lib/services/handicaps.ts");
    expect(FILES).toContain("src/app/actions/tournament.ts");
    // And the walk must not be quietly reading its own kind.
    expect(FILES.filter((f) => f.includes("__tests__"))).toEqual([]);
  });

  it("finds the callers it is about", () => {
    /**
     * THE CONTROL FOR THE PATTERN, which is the half that catches a sweep that
     * is merely NARROW rather than broken. Three of the six fixed callers are
     * asserted to still be converting handicaps at all — if a rename made
     * `roundCourseHandicaps` unfindable, the offender check below would pass by
     * looking for nothing.
     */
    for (const f of [
      "src/lib/services/skins-pot.ts",
      "src/lib/services/teams.ts",
      "src/lib/services/points-standings.ts",
      "src/app/actions/tournament.ts",
    ]) {
      expect(readSource(f), `${f} no longer resolves a round's handicaps at all`).toMatch(
        /roundCourseHandicaps\(\{/,
      );
    }
  });

  it("nobody resolves a round's tee through the tournament's own", () => {
    /**
     * `teeSetupFor` and `roundTeeId` both answer "which set has the TOURNAMENT
     * configured". Either is the wrong question wherever a card is being priced,
     * and both were being asked. `teeSetupFor` is gone; `roundTeeId` remains for
     * the roster-level screens, which is why this is a sweep and not a deletion.
     */
    const offenders = FILES.filter((f) => {
      if (EXEMPT.has(f) || OWNERS.has(f)) return false;
      const src = readSource(f);
      /**
       * Only files that actually convert an index are candidates — a screen
       * reading a tee by name is not pricing anything, which is why
       * `/grouping` and `/registration` stay out while still calling
       * `roundTeeId`.
       *
       * BOTH SPELLINGS, and the second one is the point. A first draft asked
       * for `courseHandicapMap(` alone, and every file this commit FIXED stopped
       * matching it — so reintroducing `roundTeeId` in one of them would have
       * been invisible to the guard written to prevent exactly that. A sweep
       * that stops covering the code it just corrected is the narrow-sweep
       * failure CLAUDE.md describes, and it reports zero either way.
       */
      if (!/courseHandicapMap\(|roundCourseHandicaps\(/.test(src)) return false;
      return /teeSetupFor\(|roundTeeId\(/.test(src);
    });
    expect(
      offenders,
      `these price a card off the tournament's tees rather than the round's — use roundCourseHandicaps:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("nobody hands courseHandicapMap ratings with no course on them", () => {
    /**
     * THE OTHER HALF, and it needs its own assertion because it fails in the
     * opposite direction: the tee resolves correctly and a stored
     * `Player.teeId` from another venue then overrides it, because the map
     * cannot tell the two venues apart. `teeRatingsOf` is the one way to build
     * it; a hand-rolled literal is the tell.
     */
    const offenders = FILES.filter((f) => {
      if (EXEMPT.has(f) || OWNERS.has(f)) return false;
      const src = readSource(f);
      if (!/courseHandicapMap\(/.test(src)) return false;
      return /courseRating: t\.courseRating/.test(src) && !/teeRatingsOf\(/.test(src);
    });
    expect(
      offenders,
      `these build a ratings map by hand, so courseHandicapMap cannot tell which sets are at the round's course — use teeRatingsOf:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the exemption list honest — each entry still needs exempting", () => {
    /**
     * AN EXEMPTION LIST IS A PLACE DEFECTS HIDE, so assert each entry is still
     * doing the thing it is excused for. A file that stops resolving handicaps
     * at all should leave this list, because a stale exemption silently excuses
     * whatever is written there next.
     *
     * A first draft asserted the WORDS of each file's comment explaining itself.
     * That cannot work and should not: `readSource` strips comments precisely so
     * that a sentence describing a guard cannot satisfy an assertion about the
     * guard — CLAUDE.md calls it the one mutation failure that looks like a
     * success. The reason still belongs in those files; it is just not something
     * a test can check, so this checks the code fact instead.
     */
    for (const f of ["src/lib/services/regroup.ts", "src/lib/services/week-view.ts"]) {
      const src = readSource(f);
      expect(src, `${f} is on the exemption list and no longer resolves a tee`).toMatch(
        /roundTeeId\(|courseHandicapMap\(|strokeCourseFor/,
      );
    }
    // And `tournament.ts` is exempt because it IMPLEMENTS the per-round rule
    // rather than bypassing it. If it ever stops calling `teeForPlay` per stage,
    // the exemption is wrong and this says so.
    expect(readSource("src/lib/services/tournament.ts")).toMatch(/courseHcpByStage\.set\(/);
  });

  it("the sanctioned resolver walks all three rungs and scopes them", () => {
    // The rule itself, at the one place that implements it. Without the course
    // argument `teeForPlay` cannot refuse a rung at another venue, which is the
    // defect that made the round-handicap screen agree with a wrong board.
    const src = readSource("src/lib/services/handicaps.ts");
    expect(src).toMatch(/matchTeeId: match\?\.teeId/);
    expect(src).toMatch(/stageTeeId: stage\?\.teeId/);
    expect(src).toMatch(/eventDefaultTeeId: event\?\.defaultTeeId/);
    expect(src).toMatch(/match\?\.courseId \?\? stage\?\.courseId \?\? event\?\.courseId/);
  });
});
