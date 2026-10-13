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
  /**
   * The stamp is written by `formatDayAt` since 2026-10-13 (the app's own
   * words, `date-words.ts`). What this holds is the same guarantee as before,
   * asked of the function and then of the screen: pinned to UTC the two zones
   * write one day; and the screen pins it until it has mounted.
   */
  it("the function writes one day in both zones while pinned to UTC, and the reader's own once it is not", async () => {
    const { formatDayAt } = await import("@/lib/domain/locale");
    const at = new Date(JUST_AFTER_MIDNIGHT_UTC);
    const server = inZone("UTC", () => formatDayAt(at, "en-GB", "UTC"));
    const browser = inZone("America/Los_Angeles", () => formatDayAt(at, "en-GB", "UTC"));
    expect(server).toBe("26 Sept 2026");
    expect(browser).toBe(server);
    // CONTROL: without the pin the reader in Los Angeles is still on the 25th, so the pin is doing something.
    expect(inZone("America/Los_Angeles", () => formatDayAt(at, "en-GB"))).toBe("25 Sept 2026");
  });

  it("the screen pins it to UTC until mounted", () => {
    const src = readSource("src/components/ScoreEntryClient.tsx");
    expect(src, "the stamp is not written here any more").toContain('formatDayAt(new Date(active.scoredAt), locale, mounted ? undefined : "UTC")');
    expect(src).toMatch(/useEffect\(\(\) => setMounted\(true\), \[\]\)/);
    expect(src, "the stamp is formatted in place again, by whichever engine draws it").not.toMatch(/new Intl\.DateTimeFormat\(/);
  });
});
