/**
 * An uploaded club logo, stored inline as a `data:` URI.
 *
 * The logo field has always been a URL, and the schema said why: an upload
 * needs blob storage. That is true of storing a FILE. It is not true of a club
 * logo, which is a few tens of kilobytes and already has a column to live in —
 * so this stores the image in `Organization.logoUrl` as a data URI and every
 * reader keeps working unchanged. Each one is a plain `<img src>`; `OrgBrand`
 * says outright that `next/image` is avoided here because it would need
 * configured domains, and a data URI needs none.
 *
 * No new table, no migration against a branch that auto-deploys, no bucket to
 * provision, and nothing to go wrong later when a signed URL expires or a host
 * starts blocking hotlinks — which is the exact failure `logo-check.ts` exists
 * to catch for the URL case and cannot happen to bytes we hold ourselves.
 *
 * What it costs is page weight: the logo is in the console header, the public
 * board, the printed scorecard and the tee sheet, so it is inlined on almost
 * every render and cannot be cached as a separate asset. That is the whole
 * reason for `MAX_LOGO_BYTES` and for the client downscaling before it ever
 * gets here. A club that wants a large image still has the URL field.
 *
 * THE CAP IS ENFORCED SERVER-SIDE, and that is not belt-and-braces.
 * `saveOrganizationBranding` is a `"use server"` export, which CLAUDE.md is
 * explicit about: a public HTTP endpoint that will be called with whatever the
 * caller likes. The browser's resize is a convenience; this is the rule.
 */

/**
 * What an organizer may upload, and what to call it on screen.
 *
 * PNG, JPEG and WebP because all three rasterise through a canvas, which is
 * how the browser downscales before encoding. SVG is deliberately absent: it
 * does not survive that path, and it is markup rather than pixels, so holding
 * one inline is a different question with a different answer. An SVG logo
 * still works perfectly through the URL field.
 */
export const LOGO_UPLOAD_TYPES = [
  { mime: "image/png", ext: "PNG" },
  { mime: "image/jpeg", ext: "JPG" },
  { mime: "image/webp", ext: "WebP" },
] as const;

/** For an `<input type="file" accept=...>`. */
export const LOGO_ACCEPT = LOGO_UPLOAD_TYPES.map((t) => t.mime).join(",");

/** "PNG, JPG or WebP" — the list an organizer reads. */
export const LOGO_EXT_LIST = LOGO_UPLOAD_TYPES.map((t) => t.ext)
  .join(", ")
  .replace(/, ([^,]*)$/, " or $1");

/**
 * The longest side the stored image is downscaled to, in pixels.
 *
 * 512 is generous for every place it renders — the console header draws it at
 * 28px and the printed scorecard is the largest at roughly 120 — and leaves
 * room for a retina screen and for print without holding a photograph.
 */
export const MAX_LOGO_EDGE = 512;

/**
 * Cap on the stored string, base64 and all.
 *
 * 256KB of data URI is about 190KB of image, which is a very generous club
 * logo after a 512px downscale — a typical one lands under 40KB. The cap is
 * here for the request that skips the browser entirely.
 */
export const MAX_LOGO_BYTES = 256 * 1024;

export function isDataUrl(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith("data:");
}

/**
 * Why this data URI may not be stored, or null if it may.
 *
 * Deliberately strict about SHAPE as well as type: only base64 payloads, and
 * only the three image types above. A `data:` URI can carry anything,
 * including `text/html`, and while this value only ever reaches an `<img src>`
 * — where markup does not execute — the field is rendered on the public board
 * and printed scorecards, so the narrow allowlist is the cheap answer rather
 * than reasoning about every sink it might reach later.
 */
export function dataUrlProblem(raw: string): string | null {
  const value = raw.trim();

  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]*)$/i.exec(value);
  if (!match) {
    return `That image couldn't be read. Upload a ${LOGO_EXT_LIST} file, or paste an https:// link instead.`;
  }

  const mime = match[1].toLowerCase();
  if (!LOGO_UPLOAD_TYPES.some((t) => t.mime === mime)) {
    return `Uploaded logos must be ${LOGO_EXT_LIST}. Paste an https:// link for any other kind of image.`;
  }

  const payload = match[2].replace(/\s+/g, "");
  if (!payload) return "That image was empty.";
  // Base64 encodes three bytes as four characters, so the length must be a
  // multiple of four — a truncated upload fails here rather than rendering as
  // a broken image on every scorecard.
  if (payload.length % 4 !== 0) return "That image didn't upload completely. Try it again.";

  if (value.length > MAX_LOGO_BYTES) {
    return `That image is too large. Keep it under ${Math.round(MAX_LOGO_BYTES / 1024)}KB, or paste an https:// link to it instead.`;
  }

  return null;
}
