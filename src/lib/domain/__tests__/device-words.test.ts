import { describe, it, expect } from "vitest";
import { deviceLabel } from "../device-words";

/**
 * A browser in words, from User-Agent strings as the browsers really send them
 * (copied from each browser's own current release, 2026). The traps are the
 * browsers that also claim to be Chrome or Safari.
 */
const UA = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
};

describe("a browser in words", () => {
  it("names the browser and the system, the particular names first", () => {
    expect(deviceLabel(UA.chromeWindows)).toBe("Chrome on Windows");
    expect(deviceLabel(UA.edgeWindows)).toBe("Edge on Windows");
    expect(deviceLabel(UA.safariIphone)).toBe("Safari on iPhone");
    expect(deviceLabel(UA.chromeIphone)).toBe("Chrome on iPhone");
    expect(deviceLabel(UA.samsung)).toBe("Samsung Internet on Android");
    expect(deviceLabel(UA.firefoxMac)).toBe("Firefox on Mac");
  });

  it("says so plainly when it cannot tell", () => {
    expect(deviceLabel("")).toBe("an unrecognised browser");
    expect(deviceLabel(null)).toBe("an unrecognised browser");
    expect(deviceLabel("curl/8.4.0")).toBe("an unrecognised browser");
  });
});
