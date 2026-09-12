import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * AN UPSTREAM ERROR NEVER REACHES A SCREEN.
 *
 * Seven call sites across four action files each built their own request to the
 * model API, and each had to remember the same rule on the way back. Two of
 * them wrote it down:
 *
 *     "The status, never the body: an upstream error can echo the request back,
 *      and the request contains the field's names."
 *     "...and this one contained a photograph of somebody's card."
 *
 * The other five did not, and a rule stated in two places out of seven is a
 * rule the eighth caller will not know about. CLAUDE.md's second hard rule is
 * that no player PII may ever leave — the repository is public — and an API
 * error that quotes the request back is exactly how a field list or a
 * scorecard photograph escapes into a log or onto a screen.
 *
 * `askClaude` is the one caller now. It returns a STATUS for a refusal and
 * never the response text, so the rule is held by construction rather than by
 * seven people remembering it.
 */

function sourceFiles(dir = "src", out: string[] = []): string[] {
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

const HELPER = join("src", "lib", "services", "claude.ts");

describe("talking to the model", () => {
  it("happens in one place", () => {
    const offenders = sourceFiles().filter(
      (f) => !f.endsWith(join("services", "claude.ts")) && /api\.anthropic\.com/.test(readSource(f)),
    );
    expect(
      offenders,
      `use askClaude() rather than calling the API directly: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("hands back a status on a refusal, and never the body", () => {
    /**
     * The PRESENCE half, and the reason this file exists rather than just the
     * sweep above: a single caller that started returning `await res.text()`
     * would pass the count and leak everything.
     */
    const src = readSource(HELPER);
    expect(src).toMatch(/if \(!res\.ok\) return \{ ok: false, reason: "refused", status: res\.status \}/);
    // The body is read exactly once, on the SUCCESS path, and only `.content`
    // is taken from it.
    expect(src.match(/res\.json\(\)/g)?.length ?? 0).toBe(1);
    expect(src, "the response body must not be read as text").not.toMatch(/res\.text\(\)/);
  });

  it("says the feature is off rather than throwing when there is no key", () => {
    // A missing key is a configuration state, not an error: every caller words
    // it as "this isn't switched on, here is what to do instead". Throwing
    // would turn that into a 500 on a screen somebody is using.
    const src = readSource(HELPER);
    expect(src).toMatch(/if \(!key\) return \{ ok: false, reason: "not-configured" \}/);
  });

  it("pins the API version in the one place it is sent", () => {
    /**
     * Seven copies of `anthropic-version` is seven things to update, and a
     * version skew shows up as a refusal nobody can explain. One now.
     */
    const src = readSource(HELPER);
    expect(src.match(/anthropic-version/g)?.length ?? 0).toBe(1);
  });
});
