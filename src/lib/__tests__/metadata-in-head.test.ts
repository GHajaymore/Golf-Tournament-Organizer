import { describe, it, expect, beforeAll } from "vitest";
import { shouldServeStreamingMetadata } from "next/dist/server/lib/streaming-metadata";

/**
 * Metadata has to arrive in `<head>`, and this asserts the DECISION rather than
 * the setting that produces it.
 *
 * Next 15 streams metadata by default: the shell flushes and the `<title>`,
 * `<meta>` and `<link>` tags land at the end of the BODY, on the assumption
 * that a client running JavaScript will hoist them. Measured on production on
 * 2026-09-06, it does not: `</head>` closed at character 1,303 with every tag
 * at ~70,000, and in the live post-hydration DOM `document.head` held 5 meta
 * tags against `document.body`'s 22 — the canonical's `parentElement` read
 * BODY. A canonical in the body is not a canonical; Google honours the tag in
 * the head only, so every `alternates.canonical` on the site was inert.
 *
 * Streaming was already switched off for the default `htmlLimitedBots` — the
 * unfurlers that cannot run JavaScript — so Twitter, Slack, WhatsApp and
 * Facebook were being served correctly the whole time. Googlebot is
 * deliberately absent from that list because it renders, and it was the one
 * reader getting the broken version. One rule, two readers, and the reader
 * that mattered had it wrong.
 *
 * WHY THIS SHAPE. Asserting `next.config.mjs` contains `htmlLimitedBots` would
 * pass off the word appearing in the comment above it, which this codebase has
 * been bitten by twice. Asserting the config VALUE would still not prove Next
 * acts on it. So this loads the real config and runs Next's own
 * `shouldServeStreamingMetadata` — the function `base-server` calls per
 * request — converting the RegExp to `.source` exactly as Next's config loader
 * does. A rename or a behaviour change on upgrade fails the import or the
 * assertion, which is the point: this decision is worth re-proving whenever
 * the framework moves under it.
 */

interface Config {
  htmlLimitedBots?: RegExp;
}

let config: Config;

beforeAll(async () => {
  /**
   * Imported by RELATIVE specifier deliberately. An absolute `file://` URL
   * built from `process.cwd()` is the obvious way to reach a file outside
   * `src`, and it fails here: the checkout path contains spaces, and the
   * percent-encoded URL reaches Vite's resolver as a filename that does not
   * exist. The relative form is resolved before that ever happens.
   */
  const mod = await import("../../../next.config.mjs");
  config = (mod as { default: Config }).default;
});

/** Blocking metadata means it is emitted in `<head>`; streaming means the body. */
const servesHeadMetadata = (ua: string) =>
  !shouldServeStreamingMetadata(ua, config.htmlLimitedBots?.source);

/**
 * Real agents, and mostly the ones that were BROKEN before. Googlebot and a
 * plain browser are the cases this change exists for; the unfurlers are here
 * so a future narrowing of the regex cannot quietly take them back out.
 */
const AGENTS: Array<[string, string]> = [
  ["Chrome on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"],
  ["Chrome on Android", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"],
  ["Safari on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1"],
  ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["Bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
  ["Twitterbot", "Twitterbot/1.0"],
  ["facebookexternalhit", "facebookexternalhit/1.1"],
  ["Slackbot", "Slackbot-LinkExpanding 1.0"],
  ["WhatsApp", "WhatsApp/2.23"],
  ["LinkedInBot", "LinkedInBot/1.0"],
];

describe("every agent is served its metadata in the head", () => {
  it.each(AGENTS)("%s", (_name, ua) => {
    expect(servesHeadMetadata(ua)).toBe(true);
  });

  it("is the config doing it, not the framework default", () => {
    /**
     * The discriminating half. Without this, the block above passes for
     * Twitterbot and WhatsApp on Next's DEFAULT list, so a suite that lost the
     * config entirely would still show green rows — the shape of "a green cell
     * is not a checked cell". Googlebot is not on the default list, so the two
     * assertions together can only pass because the config is applied.
     */
    expect(config.htmlLimitedBots, "next.config.mjs no longer sets htmlLimitedBots").toBeInstanceOf(RegExp);

    const googlebot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    expect(shouldServeStreamingMetadata(googlebot, undefined)).toBe(true);
    expect(shouldServeStreamingMetadata(googlebot, config.htmlLimitedBots?.source)).toBe(false);
  });
});

describe("what this cannot fix", () => {
  it("still streams to a request with no user-agent at all", () => {
    /**
     * Not an oversight and not reachable from config: Next tests
     * `userAgent && regex.test(userAgent)`, so an absent header short-circuits
     * to streaming whatever the list says. Verified against a real server over
     * a raw socket — a GET carrying no User-Agent header put the description
     * and the canonical back in the body.
     *
     * Asserted rather than left unsaid so that the limit is a known one, and so
     * that a future Next release which closes it shows up here as a failure to
     * read rather than a silent improvement nobody notices.
     */
    expect(servesHeadMetadata("")).toBe(false);
  });
});
