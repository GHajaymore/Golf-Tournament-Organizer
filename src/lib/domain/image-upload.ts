/**
 * What a photographed card is allowed to be, before it leaves this server.
 *
 * This is a security boundary, and it was the only one in the card-reading
 * path with no tests. Three `"use server"` exports accept a data URL from
 * whatever caller likes and forward it to an external API using our key. If
 * this function is wrong, that endpoint becomes a way for somebody to post
 * arbitrary content to Anthropic on our account — the string is parsed rather
 * than trusted for exactly that reason, and now the parsing is pinned.
 *
 * Its own module so it can be tested at all: it was private to the action
 * file, which is a `"use server"` module the test runner cannot import
 * meaningfully.
 */

/**
 * Eight megabytes of data URL.
 *
 * The browser downscales to a 1600px JPEG before uploading, which is well
 * under this. The cap is not about the honest path — it is the ceiling on what
 * an endpoint will hold in memory and forward when somebody skips the browser.
 */
export const MAX_DATA_URL_BYTES = 8 * 1024 * 1024;

/** Formats a phone actually produces, and that the API accepts. */
export const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export interface ParsedDataUrl {
  media: string;
  base64: string;
}

/**
 * Split a data URL into its media type and payload, refusing anything else.
 *
 * Parsed rather than trusted: the string arrives over HTTP, and forwarding an
 * arbitrary one to an external API would make this endpoint a way to post
 * whatever somebody likes using our key.
 *
 * The allow-list is on the MEDIA TYPE, not the file extension or the caller's
 * word for it, and the payload is checked to be base64 alphabet only — a
 * `data:text/html` or a `data:image/svg+xml` carrying script never reaches the
 * fetch, and neither does a payload with a quote in it.
 */
export function readDataUrl(dataUrl: string): ParsedDataUrl | null {
  if (typeof dataUrl !== "string") return null;
  if (dataUrl.length > MAX_DATA_URL_BYTES) return null;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const media = m[1].toLowerCase();
  if (!(ALLOWED_MEDIA as readonly string[]).includes(media)) return null;
  const base64 = m[2].replace(/\s+/g, "");
  if (base64.length === 0) return null;
  return { media, base64 };
}
