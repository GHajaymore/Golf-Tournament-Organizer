import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { FEATURE_KEYS, PLANS, featureOverrides, featureAllowed, type FeatureKey } from "@/lib/plans";

/**
 * A FEATURE KEY NOBODY READS IS A GATE THAT DOES NOT EXIST.
 *
 * `plans.ts` can declare anything. What decides whether a club may do a thing
 * is whether some line of code asks — and the two drift silently, because a
 * declared-and-unread flag looks exactly like a working one from the plan file
 * and from a pricing page generated off it.
 *
 * THE LESSON IS PAID FOR. `seasonPlay` sat in `org-profile.ts` for months
 * gating nothing whatsoever; it was found on 2026-09-17 only because somebody
 * tried to advertise it in a picker and went to check what it did, and was
 * deleted on 2026-09-20. And
 * `seasonStandings` was sold by `upgradeBenefits` and given away by the season
 * screen for as long as both existed, because the one service that read the
 * flag was never called.
 *
 * So: every key here is read somewhere that can refuse, and the file that
 * generates the offer cannot outrun the file that enforces it.
 */

/** Every `.ts`/`.tsx` under src, with comments stripped — source, not prose. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !full.includes("__tests__")) {
      out.push(full);
    }
  }
  return out;
}

const ROOT = join(process.cwd(), "src");
const FILES = sourceFiles(ROOT)
  .filter((f) => !f.endsWith(join("lib", "plans.ts")))
  // Relative to the repo root, because `readSource` joins onto `process.cwd()`
  // — and it is `readSource` rather than a plain read so the COMMENTS ARE
  // STRIPPED. Every paragraph above quotes these key names; searching the raw
  // text would find each one in its own explanation and report a dead flag as
  // thoroughly gated. That is the `readSource` trap, and this file would have
  // walked straight into it.
  .map((f) => f.slice(process.cwd().length + 1));
const BODIES = new Map(FILES.map((f) => [f, readSource(f)]));

describe("every feature key is actually read", () => {
  it("has files to search at all", () => {
    // The control. A sweep whose file list is empty reports every key as read
    // by nobody, or every key as fine, depending on which way it is written —
    // and both readings are wrong in the same silent way.
    expect(FILES.length).toBeGreaterThan(200);
    expect(FEATURE_KEYS.length).toBeGreaterThanOrEqual(6);
  });

  /**
   * The functions that can actually REFUSE somebody. A key is read when it is
   * handed to one of these, and not merely when its name appears.
   *
   * WRITTEN TWICE, because the first version was wrong in both directions at
   * once and said so the moment it ran:
   *
   *   - it searched for the quoted key, so `whiteLabel` — read as
   *     `.features.whiteLabel`, a property rather than a string — was reported
   *     as gating nothing, which is a false alarm about a working gate;
   *   - and `"roster"` and `"flights"` are ordinary strings in this codebase,
   *     a nav item and a setup step among them, so two keys that genuinely
   *     refused nobody were reported as thoroughly read. That is the worse
   *     direction: a sweep that says the thing you hoped it would say.
   *
   * Matching on a line that names a READER kills both. It is the same shape
   * `metered-features.test.ts` settled on, for the same reason.
   */
  const READERS = /organizationAllows|entitlementForEvent|featureAllowed|hasFeature/;

  for (const key of FEATURE_KEYS) {
    it(`"${key}" is handed to something that can refuse`, () => {
      const quoted = `"${key}"`;
      const readers = [...BODIES.entries()]
        .filter(([, body]) =>
          body
            .split("\n")
            .some((line) => (READERS.test(line) && line.includes(quoted)) || line.includes(`features.${key}`)),
        )
        .map(([file]) => file);

      expect(
        readers,
        `${key} is declared on every plan and gates nothing. Either wire it to a sink that can refuse, or take it out — a flag that refuses nobody is a promise the pricing page cannot keep.`,
      ).not.toEqual([]);
    });
  }
});

describe("the tier and the club's own exceptions", () => {
  it("falls back to the tier when there is no exception", () => {
    expect(featureAllowed("free", "", "whiteLabel")).toBe(false);
    expect(featureAllowed("club", "", "whiteLabel")).toBe(true);
  });

  it("lets one club have what its tier does not", () => {
    // Grandfathering, in one line: the club that had it before it was priced.
    expect(featureAllowed("free", '{"whiteLabel":true}', "whiteLabel")).toBe(true);
  });

  it("lets one club lose what its tier grants", () => {
    // The three-in-the-morning case: something is going wrong for one tenant
    // and it has to stop without a deploy.
    expect(featureAllowed("club", '{"seasonStandings":false}', "seasonStandings")).toBe(false);
  });

  it("ignores rubbish rather than throwing or locking anybody out", () => {
    /**
     * This column is edited by hand — that is its entire purpose — and it is
     * read on the way to answering "may this club do what it is trying to do".
     * Every malformed shape has to degrade to the tier, because the
     * alternative is a typo taking a club's tournament away mid-round.
     */
    for (const junk of ["", "   ", "not json", "[]", "null", "42", '{"seasonStandings":"yes"}', '{"nonsense":true}']) {
      expect(featureOverrides(junk), `${junk} should parse to nothing`).toEqual({});
      expect(featureAllowed("club", junk, "seasonStandings"), `${junk} changed the answer`).toBe(true);
    }
  });

  it("keeps a valid key beside an invalid one", () => {
    // Half-right JSON is the likeliest hand-edit of all, and the good half
    // should still count.
    expect(featureOverrides('{"honours":false,"nonsense":true,"sms":"yes"}')).toEqual({ honours: false });
  });
});

describe("what the tiers say today", () => {
  it("gives every plan an answer for every key", () => {
    // A missing key would read as `undefined` and therefore as "no" at the
    // sink, which is a feature quietly withdrawn by an omission.
    for (const plan of Object.values(PLANS)) {
      for (const key of FEATURE_KEYS) {
        expect(typeof plan.features[key as FeatureKey], `${plan.key}.${key}`).toBe("boolean");
      }
    }
  });

  it("has not gated anything off while the tiers are undecided", () => {
    /**
     * Ajay, 2026-09-18: gate the features per tier, and make it dynamic — with
     * the tiers themselves ("3-5 level tiered plan and the pricing and
     * features") to be decided after the app is ready.
     *
     * So the newly gateable capabilities are ON for everybody, and this cell is
     * what says so out loud. It will fail the day somebody flips one, which is
     * the moment to ask whether the ladder has actually been decided or whether
     * a tier is being chosen by accident.
     */
    for (const key of ["honours"] as FeatureKey[]) {
      expect(PLANS.free.features[key], `${key} was switched off before the tiers were decided`).toBe(true);
      expect(PLANS.club.features[key], `${key} must not be off for a paying club`).toBe(true);
    }
  });
});
