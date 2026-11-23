import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * The fold's heading is a `.btn`, and `.btn` is `white-space: nowrap`. A long state line on it then never breaks and the
 * page scrolls sideways on a 320px phone (the Event screen's "More", found by the console sweep). The heading must
 * say it wraps, and Event's state line must stay short.
 */
describe("SectionFold heading wraps on a small phone", () => {
  it("overrides the button's nowrap", () => {
    expect(readSource("src", "components", "setup", "SectionFold.tsx")).toMatch(/whiteSpace:\s*"normal"/);
  });

  it("keeps Event's More state a short line", () => {
    const src = readSource("src", "components", "event", "EventScreen.tsx");
    const m = src.match(/id="event-more"[^>]*state=\{"([^"]+)"\}/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(40);
  });
});
