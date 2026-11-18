import { describe, it, expect } from "vitest";
import { readSource, readVerbatim } from "./source";

/**
 * AN ACCEPTED VULNERABILITY STAYS ACCEPTED ONLY WHILE ITS REASON IS TRUE (2026-11-17).
 *
 * scripts/qa/known-vulnerabilities.json lets the dependency gate pass on a published advisory that
 * has no fix yet, each entry with WHY it cannot reach a user and a date to look again. The date is
 * enforced by scripts/qa/dependencies.mjs. The WHY was not: the picomatch entries (GHSA-fc5q-39xc-vjpf,
 * accepted until 2026-12-01 with the owner's permission) hold only because @sentry/nextjs's webpack
 * loader never runs, and it runs only when next.config is wrapped in withSentryConfig. A later change
 * that adds the wrapper would make the reason false while the gate stayed green.
 *
 * So: while any accepted entry leans on "the loader never runs", next.config may not name
 * withSentryConfig and the server may not import the loader. When the entries come off the list
 * (a patched release, or @sentry/nextjs replaced), this test has nothing to hold and passes.
 */

type Accepted = { package: string; lookAgain: string; reason: string };
const list = JSON.parse(readVerbatim("scripts", "qa", "known-vulnerabilities.json")) as { accepted: Accepted[] };
const leansOnUnusedLoader = list.accepted.filter((e) => /withSentryConfig|unused webpack loader|webpack loader/.test(e.reason));

describe("accepted vulnerabilities: the reason each one is safe is still true", () => {
  it("every entry has a reason and an ISO date to look again", () => {
    for (const e of list.accepted) {
      expect(e.reason.length, e.package).toBeGreaterThan(40);
      expect(e.lookAgain, e.package).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("while an entry relies on Sentry's webpack loader never running, next.config does not wrap itself in withSentryConfig", () => {
    if (leansOnUnusedLoader.length === 0) return;
    const config = readSource("next.config.mjs");
    expect(config).not.toMatch(/withSentryConfig/);
    expect(config).not.toMatch(/@sentry\/nextjs/);
  });

  it("while an entry relies on it, the server reaches Sentry only through init and captureRequestError", () => {
    if (leansOnUnusedLoader.length === 0) return;
    const instrumentation = readSource("src", "instrumentation.ts");
    expect(instrumentation).not.toMatch(/withSentryConfig|wrappingLoader|@rollup\/plugin-commonjs/);
  });

  it("control: the pattern would see a wrapped config", () => {
    expect("export default withSentryConfig(nextConfig, {})").toMatch(/withSentryConfig/);
  });
});
