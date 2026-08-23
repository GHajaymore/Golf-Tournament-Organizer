import { describe, it, expect } from "vitest";
import { readDataUrl, MAX_DATA_URL_BYTES, ALLOWED_MEDIA } from "../image-upload";

/**
 * The boundary between a public endpoint and somebody else's API key.
 *
 * Three `"use server"` exports take a data URL from any caller and forward it
 * to Anthropic on our account. TypeScript's `dataUrl: string` is erased at
 * runtime, so this function is the whole of what stands between those two
 * facts — and until now it had no tests at all.
 *
 * The tests are therefore about what must NOT get through, not about the happy
 * path.
 */

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("what is allowed through", () => {
  it("takes the formats a phone produces", () => {
    for (const media of ALLOWED_MEDIA) {
      const parsed = readDataUrl(`data:${media};base64,AAAA`);
      expect(parsed?.media, media).toBe(media);
    }
  });

  it("returns the payload without its wrapper", () => {
    expect(readDataUrl(JPEG)?.base64).toBe("/9j/4AAQSkZJRg==");
  });

  it("strips the whitespace a wrapped data URL carries", () => {
    // Some clients line-wrap base64. The payload is joined rather than refused.
    expect(readDataUrl("data:image/png;base64,AA AA\nBB")?.base64).toBe("AAAABB");
  });

  it("is case-insensitive about the media type but stores it lowercased", () => {
    expect(readDataUrl("data:IMAGE/JPEG;base64,AAAA")?.media).toBe("image/jpeg");
  });
});

describe("what must never get through", () => {
  it("refuses a media type that is not on the list", () => {
    // The list is the whole control. An endpoint that forwarded text/html or
    // application/pdf would be a way to post arbitrary content on our account.
    for (const bad of [
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:application/pdf;base64,JVBERi0=",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:application/octet-stream;base64,AAAA",
    ]) {
      expect(readDataUrl(bad), bad).toBeNull();
    }
  });

  it("refuses SVG specifically, which is a script container wearing image/", () => {
    // It starts with image/ and would sail past a naive prefix check.
    expect(readDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
  });

  it("refuses anything that is not a base64 data URL at all", () => {
    for (const bad of [
      "https://example.invalid/card.jpg",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:image/jpeg,notbase64",
      "data:image/jpeg;base64,",
      "",
      "   ",
    ]) {
      expect(readDataUrl(bad), bad).toBeNull();
    }
  });

  it("refuses a payload outside the base64 alphabet", () => {
    // A quote or an angle bracket in the payload has no business in base64 and
    // is the shape of somebody trying to break out of it.
    for (const bad of [
      'data:image/jpeg;base64,AA"BB',
      "data:image/jpeg;base64,AA<script>",
      "data:image/jpeg;base64,AA;rm -rf",
      // Escaped, never a raw byte: a literal NUL in source is invisible, makes
      // grep treat the file as binary, and is what no-control-bytes.test.ts
      // exists to stop. It caught this line.
      "data:image/jpeg;base64,AA\u0000BB",
    ]) {
      expect(readDataUrl(bad), bad).toBeNull();
    }
  });

  it("refuses a second data URL smuggled after the first", () => {
    expect(readDataUrl(`${JPEG},data:text/html;base64,PHNjcmlwdD4=`)).toBeNull();
  });

  it("refuses anything over the size cap without parsing it", () => {
    // Checked before the regex: a very large hostile string should not be run
    // through a pattern at all.
    const huge = `data:image/jpeg;base64,${"A".repeat(MAX_DATA_URL_BYTES)}`;
    expect(readDataUrl(huge)).toBeNull();
  });

  it("survives a value that is not a string, because the type is erased", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(readDataUrl(bad as any), String(bad)).toBeNull();
    }
  });
});
