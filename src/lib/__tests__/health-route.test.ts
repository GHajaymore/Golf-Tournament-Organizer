import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The health check an uptime monitor reads: 200 when the database answers,
 * 503 when it errors or hangs, and never a word about why.
 */

/**
 * A plain function rather than `vi.fn()`: the spy chains its own handler onto a
 * returned promise to record it, and a REJECTED one then surfaces as an
 * unhandled rejection that fails the test the route itself handled correctly.
 */
let answer: () => Promise<unknown> = async () => [];
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: () => answer() } }));

const { GET } = await import("@/app/api/health/route");

/** Past any timeout a health check could sensibly use (the route's is 4 s). */
const LONGER_THAN_ANY_TIMEOUT_MS = 60_000;

describe("/api/health", () => {
  afterEach(() => vi.useRealTimers());

  it("is 200 when the database answers", async () => {
    answer = async () => [{ "?column?": 1 }];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is 503 when the database errors — and does not repeat the error", async () => {
    answer = async () => {
      throw new Error("Can't reach database server at `db.zz-host.invalid:5432`");
    };
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ ok: false }));
    expect(body).not.toContain("zz-host");
  });

  it("is 503 when the database hangs past the timeout", async () => {
    vi.useFakeTimers();
    answer = () => new Promise(() => {});
    const pending = GET();
    await vi.advanceTimersByTimeAsync(LONGER_THAN_ANY_TIMEOUT_MS);
    expect((await pending).status).toBe(503);
  });
});
