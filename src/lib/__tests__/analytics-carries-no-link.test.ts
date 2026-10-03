import { describe, it, expect } from "vitest";
import { scrubAnalyticsEvent, analyticsEnabled } from "@/lib/domain/analytics-event";
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
    expect(component).toMatch(/"beforeSend",[\s\S]{0,80}?scrubAnalyticsEvent\(/);
  });
});
