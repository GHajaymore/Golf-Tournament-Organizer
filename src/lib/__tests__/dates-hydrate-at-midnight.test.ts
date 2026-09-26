import { describe, it, expect, afterEach, vi } from "vitest";
import { readSource } from "./source";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
// Server actions as no-ops. Never answering `then`, or the module reads as a
// promise and the import waits for ever.
vi.mock("@/app/actions/messaging", () =>
  new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : async () => ({ ok: true })) }),
);

/**
 * A DATE RENDERS THE SAME ON THE SERVER AND IN THE BROWSER, WHATEVER ZONE EACH
 * IS IN.
 *
 * The server formats in its own zone (UTC on Vercel) and the browser in the
 * reader's, so a message written at 00:30 UTC was "26 Sept" in the HTML and
 * "25 Sept" in a US browser's first render — a hydration error for a few hours
 * around every midnight (deferred register, 2026-09-25). The pre-mount render
 * is pinned to UTC; after mount the reader's own date is shown.
 *
 * Proven by running the same call under two process zones.
 */
const zoneWas = process.env.TZ;
afterEach(() => {
  process.env.TZ = zoneWas;
});

const inZone = <T,>(tz: string, fn: () => T): T => {
  process.env.TZ = tz;
  return fn();
};

// 00:30 UTC on 26 Sept — still the 25th in every US zone.
const JUST_AFTER_MIDNIGHT_UTC = Date.UTC(2026, 8, 26, 0, 30);

describe("the first render of a message's date", () => {
  it("is the same in UTC and in Los Angeles", async () => {
    const { when } = await import("@/components/MessagesClient");
    const server = inZone("UTC", () => when(JUST_AFTER_MIDNIGHT_UTC, "en-GB", null));
    const browser = inZone("America/Los_Angeles", () => when(JUST_AFTER_MIDNIGHT_UTC, "en-GB", null));
    expect(browser).toBe(server);
  });

  it("the zones really do disagree without the pin (control)", () => {
    // Without this, the test above would pass on a machine whose Intl ignored
    // process.env.TZ, proving nothing.
    const fmt = () => new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(JUST_AFTER_MIDNIGHT_UTC));
    expect(inZone("America/Los_Angeles", fmt)).not.toBe(inZone("UTC", fmt));
  });

  it("uses the reader's own date once mounted, far enough back to be a date", async () => {
    const { when } = await import("@/components/MessagesClient");
    const later = JUST_AFTER_MIDNIGHT_UTC + 30 * 86_400_000;
    const la = inZone("America/Los_Angeles", () => when(JUST_AFTER_MIDNIGHT_UTC, "en-GB", later));
    expect(la).toMatch(/25/);
  });
});

describe("the score-entry stamp", () => {
  it("formats in UTC until mounted", () => {
    const src = readSource("src/components/ScoreEntryClient.tsx");
    const end = src.indexOf("format(new Date(active.scoredAt))");
    expect(end, "the stamp is not formatted here any more").toBeGreaterThan(0);
    const stamp = src.slice(src.lastIndexOf("new Intl.DateTimeFormat", end), end);
    expect(stamp).toMatch(/mounted \? \{\} : \{ timeZone: "UTC" \}/);
    expect(src).toMatch(/useEffect\(\(\) => setMounted\(true\), \[\]\)/);
  });
});
