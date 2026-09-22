import { describe, it, expect } from "vitest";
import { isFontFetchFailure } from "../../../scripts/build-checked.mjs";

/**
 * A BUILD IS RETRIED FOR ONE REASON, AND EVERY OTHER FAILURE STILL FAILS.
 *
 * `build-checked.mjs` already rebuilds once when a client-reference manifest
 * comes out provably incomplete. On 2026-09-21 the OTHER build-time fault
 * failed three CI jobs across three pull requests in one evening —
 * `next/font/google` could not fetch, its loader regex returned null, and the
 * build died reporting an error against `src/app/layout.tsx`. Two of those
 * three commits could not have caused anything: one added a single test file,
 * one edited only CLAUDE.md. Every one cleared on a re-run.
 *
 * So the fetch failure is retried too. The danger in that is obvious and it is
 * the whole subject of this file: a retry drawn one inch too wide starts
 * hiding real build failures, and CLAUDE.md forbids `retries` in the e2e suite
 * for exactly that reason.
 *
 * The logs below are REAL — taken from the runs named in CLAUDE.md, and from
 * an ordinary mistake made the same evening (a JSX comment placed where an
 * expression was expected, which CI caught in Typecheck). The negative cases
 * matter more than the positive one.
 */

/** #551, Build and smoke. The failure this retry exists for. */
const FONT_FETCH = `
   ▲ Next.js 15.5.25
   Creating an optimized production build ...
Failed to compile.

src/app/layout.tsx
An error occurred in \`next/font\`.

TypeError: Cannot read properties of null (reading '1')
    at /home/runner/work/app/node_modules/next/dist/compiled/@next/font/dist/google/loader.js:122:78
    at async nextFontGoogleFontLoader (/home/runner/work/app/node_modules/next/dist/compiled/@next/font/dist/google/loader.js:104:33)
> Build failed because of webpack errors
`;

/** The same fault reported through a Playwright webServer, #554 small-phone. */
const FONT_FETCH_VIA_WEBSERVER = `
[WebServer] Failed to compile.
[WebServer] An error occurred in \`next/font\`.
[WebServer] TypeError: Cannot read properties of null (reading '1')
[WebServer]     at /home/runner/work/app/node_modules/next/dist/compiled/@next/font/dist/google/loader.js:122:78
`;

/** My own mistake, 2026-09-21. This must fail on the first attempt. */
const REAL_SYNTAX_ERROR = `
Failed to compile.

./src/components/AttendanceReport.tsx
Error:   x Expected '</', got 'style'
    Syntax Error
> Build failed because of webpack errors
`;

/** The other documented fault, which has its OWN handling and must not use this one. */
const CLIENT_MANIFEST = `
 ⨯ Error: Could not find the module "/home/runner/work/app/src/components/SeriesClient.tsx#SeriesClient" in the React Client Manifest. This is probably a bug in the React Server Components bundler.
`;

/**
 * A REAL font MISCONFIGURATION, which is the dangerous near-miss.
 *
 * Next reports a bad weight or a missing subset through the same `next/font`
 * headline — and that IS the author's fault, is deterministic, and retrying it
 * would loop on a mistake a person has to fix. It is told apart by the absence
 * of the packaged loader frame, which is why both signals are required.
 */
const FONT_MISCONFIGURED = `
Failed to compile.

src/app/layout.tsx
An error occurred in \`next/font\`.

Error: Unknown font \`Oswaldd\`
> Build failed because of webpack errors
`;

describe("build-checked retries only the font fetch", () => {
  it("recognises the fetch failure", () => {
    expect(isFontFetchFailure(FONT_FETCH)).toBe(true);
  });

  it("recognises it through a Playwright webServer prefix", () => {
    // Same fault, different instrument — #554 reported it this way while #551
    // reported it bare, and a matcher that only knew one spelling would retry
    // half of them.
    expect(isFontFetchFailure(FONT_FETCH_VIA_WEBSERVER)).toBe(true);
  });

  it("does NOT retry an ordinary syntax error", () => {
    // The one that matters. This exact failure was shipped and caught by CI on
    // 2026-09-21; if a retry had swallowed it the second build would have
    // failed identically and wasted several minutes saying so.
    expect(isFontFetchFailure(REAL_SYNTAX_ERROR)).toBe(false);
  });

  it("does NOT claim the client-manifest fault, which is handled separately", () => {
    expect(isFontFetchFailure(CLIENT_MANIFEST)).toBe(false);
  });

  /**
   * The control that makes the two-signal rule mean something. Matching
   * "An error occurred in `next/font`" alone passes every test above except
   * this one — so this is the assertion that would go red if somebody
   * "simplified" the check to one substring.
   */
  it("does NOT retry a font that is genuinely misconfigured", () => {
    expect(isFontFetchFailure(FONT_MISCONFIGURED)).toBe(false);
  });

  it("is not tripped by an empty or missing log", () => {
    for (const v of ["", null, undefined]) expect(isFontFetchFailure(v)).toBe(false);
  });

  it("does not retry a build that merely mentions fonts in passing", () => {
    expect(isFontFetchFailure("Compiled successfully. Fonts inlined: Oswald, Inter")).toBe(false);
  });
});
