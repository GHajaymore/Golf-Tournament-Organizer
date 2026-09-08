import { describe, it, expect } from "vitest";
import {
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
