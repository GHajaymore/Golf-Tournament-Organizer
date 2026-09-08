import { describe, it, expect } from "vitest";
import {
  logoSrc,
  logoVersion,
  isDataUrl,
  dataUrlProblem,
  LOGO_ACCEPT,
  LOGO_EXT_LIST,
  MAX_LOGO_BYTES,
} from "../logo-upload";

/**
 * What may be stored when a club uploads its logo rather than linking one.
 *
 * The rules live here, away from both the browser and the action, because
 * BOTH have to apply them and they must not drift. The browser's copy exists
 * to name the bad file while the organizer is still looking at the picker;
 * this one is the rule, and `saveOrganizationBranding` is a `"use server"`
 * export — CLAUDE.md: a public HTTP endpoint that will be called with whatever
 * the caller likes. A cap enforced only in the resize code is not a cap.
 */

/** A one-pixel PNG, which is a real image and short enough to read. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("telling an upload from a link", () => {
  it("recognises a data URI", () => {
    expect(isDataUrl(PNG_1PX)).toBe(true);
    expect(isDataUrl("  DATA:image/png;base64,AAAA")).toBe(true);
  });

  it("does not mistake a URL for one", () => {
    expect(isDataUrl("https://club.example/logo.png")).toBe(false);
    expect(isDataUrl("")).toBe(false);
  });
});

describe("what may be stored", () => {
  it("takes a real PNG", () => {
    expect(dataUrlProblem(PNG_1PX)).toBeNull();
  });

  it("takes JPEG and WebP", () => {
    expect(dataUrlProblem("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(dataUrlProblem("data:image/webp;base64,AAAA")).toBeNull();
  });

  it("refuses a type that is not an image at all", () => {
    /**
     * The reason the list is an allowlist rather than a check for "image/".
     * A data URI can carry anything, and this value is rendered on the public
     * board and on printed scorecards. It only ever reaches an `<img src>`,
     * where markup does not execute — but naming the three types it may be is
     * cheaper than re-deciding that for every sink it reaches later.
     */
    expect(dataUrlProblem("data:text/html;base64,PHNjcmlwdD4=")).toMatch(/must be/i);
  });

  it("refuses SVG, which is markup rather than pixels", () => {
    // Deliberately absent from the upload list: it does not survive the canvas
    // downscale the browser does, so an SVG could only be stored at whatever
    // size it arrived. It still works through the URL field, and the help text
    // says so.
    expect(dataUrlProblem("data:image/svg+xml;base64,PHN2Zy8+")).toMatch(/must be/i);
  });

  it("refuses a data URI that is not base64", () => {
    // `data:image/png,<raw>` is legal and unencoded. Accepting it would mean
    // two shapes to reason about for no gain.
    expect(dataUrlProblem("data:image/png,rawbytes")).toBeTruthy();
  });

  it("refuses an empty payload", () => {
    expect(dataUrlProblem("data:image/png;base64,")).toMatch(/empty/i);
  });

  it("refuses a truncated upload", () => {
    /**
     * Base64 encodes three bytes as four characters, so a length that is not a
     * multiple of four cannot be complete. Without this the row saves and the
     * logo renders as a broken image on every scorecard — the failure that
     * shows up somewhere other than where it was caused.
     */
    expect(dataUrlProblem("data:image/png;base64,AAAAA")).toMatch(/completely/i);
  });

  it("refuses one over the cap, and says the size", () => {
    const huge = `data:image/png;base64,${"A".repeat(MAX_LOGO_BYTES)}`;
    const problem = dataUrlProblem(huge);
    expect(problem).toMatch(/too large/i);
    // The number has to be in the message: "too large" alone leaves an
    // organizer guessing how much smaller.
    expect(problem).toMatch(new RegExp(String(Math.round(MAX_LOGO_BYTES / 1024))));
  });

  it("takes one exactly at the cap — the boundary, not near it", () => {
    const prefix = "data:image/png;base64,";
    // Padded to a multiple of four so only the SIZE rule is under test.
    const payload = "A".repeat(Math.floor((MAX_LOGO_BYTES - prefix.length) / 4) * 4);
    const at = `${prefix}${payload}`;
    expect(at.length).toBeLessThanOrEqual(MAX_LOGO_BYTES);
    expect(dataUrlProblem(at)).toBeNull();
  });
});

describe("what the organizer is told", () => {
  it("lists the extensions in words, not MIME types", () => {
    // The screen says this verbatim, and "image/webp" is not a thing anybody
    // recognises as a file they have.
    expect(LOGO_EXT_LIST).toBe("PNG, JPG or WebP");
  });

  it("gives the file picker the matching MIME list", () => {
    // The two must not drift: a picker that accepts a type the rule refuses
    // lets somebody choose a file that is then rejected.
    expect(LOGO_ACCEPT).toBe("image/png,image/jpeg,image/webp");
  });

  it("names every accepted type in the refusal", () => {
    // A refusal that does not say what IS allowed makes the organizer guess.
    for (const ext of ["PNG", "JPG", "WebP"]) {
      expect(dataUrlProblem("data:image/gif;base64,AAAA")).toContain(ext);
    }
  });
});

describe("where an uploaded logo is served from", () => {
  /**
   * MEASURED, not assumed. The public board polls every 30 seconds and
   * `router.refresh()` re-fetches the rendered payload, so an inlined image is
   * re-sent every time. On the console leaderboard with a 40KB logo that was
   * **81KB added per render** — the string lands in both the HTML and the RSC
   * flight data — or roughly 10MB an hour per spectator, on a phone on a golf
   * course. A URL is a short string whose image the browser caches once.
   */
  const ORG = "org_abc123";

  it("leaves a linked logo exactly as it is", () => {
    // The club's own URL is already cacheable and already theirs. Rewriting it
    // would put our server in front of their CDN for no reason.
    const url = "https://ridgeline.example/logo.png";
    expect(logoSrc(ORG, url)).toBe(url);
  });

  it("leaves an empty logo empty", () => {
    // `OrgBrand` renders a monogram when this is falsy; a URL here would make
    // it render a broken image instead.
    expect(logoSrc(ORG, "")).toBe("");
    expect(logoSrc(ORG, "   ")).toBe("");
  });

  it("routes an uploaded one, under the prefix middleware skips", () => {
    const src = logoSrc(ORG, PNG_1PX);
    expect(src).toMatch(/^\/api\/logo\/org_abc123\?v=/);
  });

  it("changes the URL when the image changes, and only then", () => {
    /**
     * This is what makes `immutable` safe on the route. Without a version the
     * club swaps its logo and every spectator keeps the old one for a year;
     * with a version that changes on every render, nothing caches at all.
     */
    const a = logoSrc(ORG, PNG_1PX);
    expect(logoSrc(ORG, PNG_1PX), "same image, same URL").toBe(a);
    expect(logoSrc(ORG, "data:image/png;base64,AAAA"), "different image").not.toBe(a);
  });

  it("gives different organizations different URLs for the same image", () => {
    // Two clubs uploading the same file must not share a cache entry keyed
    // only on content — the path is what says whose logo it is.
    expect(logoSrc("org_one", PNG_1PX)).not.toBe(logoSrc("org_two", PNG_1PX));
  });

  it("fingerprints without collapsing similar images", () => {
    // A hash that returned a constant would pass every test above except this
    // one, and would pin every club to the first logo it ever uploaded.
    const seen = new Set(
      ["AAAA", "AAAB", "BAAA", "ABCD"].map((p) => logoVersion(`data:image/png;base64,${p}`)),
    );
    expect(seen.size).toBe(4);
  });
});
