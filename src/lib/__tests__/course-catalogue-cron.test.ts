import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PRODUCTION CATALOGUE'S DAY, AS ORCHESTRATED BY ITS ROUTE (2026-10-04).
 *
 * The three steps are mocked: each is tested against real rows in
 * `catalogue-import.audit.test.ts`. This pins who may run it, what it runs and
 * in which order, and that one step failing does not cost the others their day.
 */
const calls: string[] = [];
vi.mock("@/lib/services/catalogue-import", () => ({
  importCatalogueSlice: vi.fn(async (o: { budget: number }) => {
    calls.push(`walk:${o.budget}`);
    return { fetched: 0, stopped: "end" };
  }),
  refreshCatalogueSlice: vi.fn(async (o: { budget: number }) => {
    calls.push(`latest:${o.budget}`);
    return { checked: 0, stopped: "done" };
  }),
}));
vi.mock("@/lib/services/catalogue-gca", () => ({
  gcaFetch: vi.fn(() => async () => null),
  importGcaSlice: vi.fn(async (o: { budget: number }) => {
    calls.push(`international:${o.budget}`);
    return { requests: 0, stopped: "drained" };
  }),
}));

const SECRET = "zz-catalogue-cron-secret";
const { GET } = await import("@/app/api/cron/course-catalogue/route");
const services = await import("@/lib/services/catalogue-import");
const gca = await import("@/lib/services/catalogue-gca");
const ask = (headers: Record<string, string> = {}) =>
  GET(new Request("https://example.invalid/api/cron/course-catalogue", { headers }));

const saved = { secret: process.env.CRON_SECRET, key: process.env.GOLFCOURSE_API_KEY };
beforeEach(() => {
  calls.length = 0;
  process.env.CRON_SECRET = SECRET;
  delete process.env.GOLFCOURSE_API_KEY;
});
afterEach(() => {
  if (saved.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved.secret;
  if (saved.key === undefined) delete process.env.GOLFCOURSE_API_KEY;
  else process.env.GOLFCOURSE_API_KEY = saved.key;
});

describe("who may run it", () => {
  it("refuses without the secret, with a wrong one, and when none is configured — and runs nothing", async () => {
    expect((await ask()).status).toBe(401);
    expect((await ask({ authorization: "Bearer nope" })).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await ask({ authorization: `Bearer ${SECRET}` })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("lets the scheduler through (the control)", async () => {
    expect((await ask({ authorization: `Bearer ${SECRET}` })).status).toBe(200);
  });
});

describe("what a day does", () => {
  it("international first when the key is set, then latest, then the domestic walk", async () => {
    process.env.GOLFCOURSE_API_KEY = "zz-not-a-real-key";
    const body = await (await ask({ authorization: `Bearer ${SECRET}` })).json();
    expect(calls).toEqual(["international:22", "latest:20", "walk:200"]);
    expect(body).toMatchObject({ ok: true, international: { stopped: "drained" }, latest: {}, domestic: {} });
  });

  it("says plainly that international is off without a key, and still does the rest", async () => {
    const body = await (await ask({ authorization: `Bearer ${SECRET}` })).json();
    expect(calls).toEqual(["latest:20", "walk:200"]);
    expect(body.international).toEqual({ skipped: "GOLFCOURSE_API_KEY is not set" });
  });

  it("does not let one step's failure cost the others their day", async () => {
    process.env.GOLFCOURSE_API_KEY = "zz-not-a-real-key";
    vi.mocked(gca.importGcaSlice).mockRejectedValueOnce(new TypeError("boom: postgres://secret@host"));
    vi.mocked(services.refreshCatalogueSlice).mockRejectedValueOnce(new Error("also boom"));
    const res = await ask({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toEqual(["walk:200"]);
    // The kind of fault only — a message can carry a connection string.
    expect(body.international).toEqual({ error: "TypeError" });
    expect(body.latest).toEqual({ error: "Error" });
    expect(JSON.stringify(body)).not.toContain("secret@host");
  });

  it("is scheduled twice a day, which is what spends the free allowance", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const runs = vercel.crons.filter((c) => c.path === "/api/cron/course-catalogue");
    expect(runs).toHaveLength(2);
    // Daily schedules only (minute and hour fixed), which is what every plan allows.
    for (const r of runs) expect(r.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});
