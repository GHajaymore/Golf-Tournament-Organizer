import { describe, it, expect } from "vitest";
import { scrubAnalyticsEvent, analyticsEnabled, pageViewFor, isPlayerLinkPage } from "@/lib/domain/analytics-event";
import { readSource } from "./source";

/**
 * Page counts never carry a link that opens something. See analytics-event.ts.
 */
const TOKEN = "zz-club-tok-Q7xP2";

describe("an analytics page view", () => {
  it("counts a board, an entry form, a reset and a round code without their credentials", () => {
    for (const url of [
      `https://tourneyhq.club/live/${TOKEN}`,
      `https://tourneyhq.club/live/${TOKEN}/tv`,
      `https://tourneyhq.club/register/${TOKEN}`,
      `https://tourneyhq.club/reset-password?token=${TOKEN}`,
      `https://tourneyhq.club/play?code=${TOKEN}`,
    ]) {
      const out = scrubAnalyticsEvent({ type: "pageview", url });
      expect(out.url, url).not.toContain(TOKEN);
      expect(out.url).toContain("[redacted]");
    }
  });

  it("CONTROL: an ordinary page is counted as it is", () => {
    for (const url of ["https://tourneyhq.club/", "https://tourneyhq.club/faq", "https://tourneyhq.club/live"]) {
      expect(scrubAnalyticsEvent({ type: "pageview", url }).url).toBe(url);
    }
  });

  it("keeps the event's other fields", () => {
    expect(scrubAnalyticsEvent({ type: "pageview", url: "https://tourneyhq.club/" }).type).toBe("pageview");
  });
});

describe("analytics is off unless switched on", () => {
  it("only the exact word turns it on", () => {
    expect(analyticsEnabled(undefined)).toBe(false);
    expect(analyticsEnabled("")).toBe(false);
    expect(analyticsEnabled("true")).toBe(false);
    expect(analyticsEnabled("on")).toBe(true);
  });

  it("the page frame renders it only behind that switch, and hands every event to the scrubber", () => {
    const layout = readSource("src", "app", "layout.tsx");
    expect(layout).toMatch(/analyticsEnabled\(process\.env\.NEXT_PUBLIC_ANALYTICS\)\s*&&\s*<SiteAnalytics/);
    const component = readSource("src", "components", "SiteAnalytics.tsx");
    // Through `pageViewFor`, which drops the player link's page and scrubs every other.
    expect(component).toMatch(/"beforeSend",[\s\S]{0,80}?pageViewFor\(/);
    const domain = readSource("src", "lib", "domain", "analytics-event.ts");
    expect(domain).toMatch(/function pageViewFor[\s\S]{0,200}?return scrubAnalyticsEvent\(event\)/);
  });
});

/**
 * A GUEST'S PLAYER LINK PAGE IS NEVER COUNTED (J39/J40, the review's S3). The
 * code rides in /p's fragment until the page strips it, and a beacon can race
 * that: two locks — no script renders on /p, and a page view of /p is dropped.
 */
describe("the player link's page", () => {
  const CODE = "K7QM2XRA9DTP";
  it("is dropped, with or without its code, a query or a trailing slash", () => {
    for (const url of [`https://tourneyhq.club/p#${CODE}`, "https://tourneyhq.club/p", "https://tourneyhq.club/p?ended=1", `https://tourneyhq.club/p/${CODE}`]) {
      expect(pageViewFor({ type: "pageview", url }), url).toBeNull();
      expect(isPlayerLinkPage(url), url).toBe(true);
    }
  });
  it("and its code is redacted by the shared scrubber wherever it sits, if it were ever counted", () => {
    for (const url of [`https://tourneyhq.club/p#${CODE}`, `https://tourneyhq.club/p/${CODE}`, `https://tourneyhq.club/me?code=${CODE}`]) {
      expect(scrubAnalyticsEvent({ type: "pageview", url }).url, url).not.toContain(CODE);
    }
  });
  it("CONTROL: a page whose path merely starts with p is counted", () => {
    for (const url of ["https://tourneyhq.club/play", "https://tourneyhq.club/privacy", "https://tourneyhq.club/pricing"]) {
      expect(pageViewFor({ type: "pageview", url })?.url, url).toBe(url);
    }
  });
  it("SiteAnalytics renders nothing on /p", () => {
    const component = readSource("src", "components", "SiteAnalytics.tsx");
    expect(component).toMatch(/if \(isPlayerLinkPage\(path \?\? "\/"\)\) return null;/);
  });
});
