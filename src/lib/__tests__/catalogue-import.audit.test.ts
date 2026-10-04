import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE APP'S OWN DAILY COURSE IMPORT (2026-10-04) — against real rows, with a
 * fake directory so no test ever spends the real allowance.
 *
 * The catalogue was built by a script on one machine and lost with that
 * machine's database. The cron that replaces it runs in production, so what
 * matters is what a script run never had to prove: it stops inside its
 * function's time, it keeps its place in the database, it never fetches a
 * course it already holds, and a directory that will not answer ends the day
 * rather than the function.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const MARK = "zz-cat-";
const KEY = "zz-catalogue-walk-test";
const SECRET = "zz-audit-catalogue-secret";

const { importCatalogueSlice } = await import("@/lib/services/catalogue-import");
const { GET } = await import("@/app/api/cron/course-catalogue/route");

const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const holes = (pars: number[], si: number[]) =>
  pars.map((par, i) => ({ number: i + 1, par, handicap_index: si[i], yardages: {} }));

/**
 * A directory with `n` courses in one state's listing (no country on the row,
 * as a state listing is the US) and `world` more in the world listing (marked
 * GB). Even-numbered courses have a good card, odd ones none.
 */
const STATES = ["ZZ"];
function directory(n: number, opts: { refuse?: boolean; world?: number } = {}) {
  const ids = Array.from({ length: n }, (_, i) => `${MARK}${String(i).padStart(3, "0")}`);
  const worldIds = Array.from({ length: opts.world ?? 0 }, (_, i) => `${MARK}w${String(i).padStart(3, "0")}`);
  const all = [...ids, ...worldIds];
  const calls: string[] = [];
  const page = (list: string[], limit: number, offset: number, country: string) => ({
    status: 200,
    body: {
      courses: list.slice(offset, offset + limit).map((id) => ({
        id, course_name: `ZZ Links ${id}`, city: "Zz Town", state: "", ...(country ? { country_iso: country } : {}),
      })),
    },
  });
  const fetchJson = async (path: string) => {
    calls.push(path);
    if (opts.refuse) return { status: 429, body: null };
    const inState = /\/courses\/state\/ZZ\?limit=(\d+)&offset=(\d+)/.exec(path);
    if (inState) return page(ids, Number(inState[1]), Number(inState[2]), "");
    const world = /\/courses\/search\?limit=(\d+)&offset=(\d+)/.exec(path);
    if (world) return page(worldIds, Number(world[1]), Number(world[2]), "gb");
    const id = decodeURIComponent(path.split("/").pop() ?? "");
    const i = all.indexOf(id);
    if (i < 0) return { status: 404, body: null };
    return {
      status: 200,
      body: {
        id, course_name: `ZZ Links ${id}`, city: "Zz Town", state: "",
        holes_data: i % 2 === 0 ? holes(PARS, SI) : [],
        tees: [],
      },
    };
  };
  const isListing = (c: string) => c.includes("/search") || c.includes("/state/");
  const details = () => calls.filter((c) => !isListing(c)).length;
  return { ids, worldIds, calls, details, isListing, fetchJson };
}

const noSleep = async () => {};
const later = () => Date.now() + 60_000;
const run = (dir: ReturnType<typeof directory>, budget: number, deadline = later()) =>
  importCatalogueSlice({ budget, deadline, fetchJson: dir.fetchJson, sleep: noSleep, cursorKey: KEY, states: STATES });
const catalogued = () => prisma.courseCatalog.findMany({ where: { id: { startsWith: MARK } }, orderBy: { id: "asc" } });
const cursor = async () => JSON.parse((await prisma.platformSetting.findUnique({ where: { key: KEY } }))?.value ?? "{}");
const at = (phase: number, offset: number) => ({ phase, offset });

async function scrub() {
  await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: MARK } } });
  await prisma.platformSetting.deleteMany({ where: { key: KEY } });
}

beforeAll(scrub);
afterEach(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("a day's slice of the directory", () => {
  it("stores each course as judged: the card where it is usable, the reason where it is not", async () => {
    const dir = directory(4);
    const r = await run(dir, 10);

    expect(r).toMatchObject({ fetched: 4, withCard: 2, withoutCard: 2, stopped: "end", position: at(0, 0) });
    const rows = await catalogued();
    expect(rows.map((x) => x.id)).toEqual(dir.ids);
    const [good, bad] = rows;
    expect(JSON.parse(good.pars)).toEqual(PARS);
    expect(JSON.parse(good.strokeIndex)).toEqual(SI);
    expect(good.par).toBe(72);
    expect(good.cardProblem).toBe("");
    // A refused card is stored EMPTY with its reason — never a placeholder par.
    expect(bad.pars).toBe("");
    expect(bad.par).toBe(0);
    expect(bad.cardProblem).toContain("no hole-by-hole card");
    // A state listing is the US, whether or not the row says so.
    expect(good.country).toBe("US");
  });

  it("walks the US states before the world, and takes the world's country from its listing", async () => {
    const dir = directory(3, { world: 2 });
    const r = await run(dir, 10);
    expect(r).toMatchObject({ fetched: 5, stopped: "end", position: at(0, 0) });
    const listings = dir.calls.filter(dir.isListing);
    // The state listing is asked first, the world's after it.
    expect(listings[0]).toContain("/state/ZZ");
    expect(listings.findIndex((c) => c.includes("/search"))).toBeGreaterThan(0);
    const rows = await catalogued();
    expect(rows.filter((x) => dir.worldIds.includes(x.id)).map((x) => x.country)).toEqual(["GB", "GB"]);
  });

  it("stops at its budget part-way through a page, stays on that page, and never re-fetches", async () => {
    const dir = directory(150);
    const first = await run(dir, 40);
    expect(first).toMatchObject({ fetched: 40, stopped: "budget", position: at(0, 0) });
    expect(await cursor()).toEqual(at(0, 0));

    const second = await run(dir, 100);
    // The first forty are held, so they cost nothing: 60 left on page one,
    // then 40 of the second page's 50.
    expect(second.fetched).toBe(100);
    expect(second.position).toEqual(at(0, 100));
    expect(dir.details()).toBe(140);
    expect(await prisma.courseCatalog.count({ where: { id: { startsWith: MARK } } })).toBe(140);
    expect(new Set(dir.calls.filter((c) => !dir.isListing(c))).size).toBe(140);
  });

  it("starts again at the first state after the world's end, which is how new courses are found", async () => {
    const dir = directory(30);
    await prisma.platformSetting.create({ data: { key: KEY, value: JSON.stringify(at(1, 100)) } });
    const r = await run(dir, 10);
    expect(r).toMatchObject({ fetched: 0, stopped: "end", position: at(0, 0) });
    expect(await cursor()).toEqual(at(0, 0));
  });

  it("starts nothing once its deadline has passed", async () => {
    const dir = directory(10);
    const r = await run(dir, 10, Date.now() - 1);
    expect(r).toMatchObject({ fetched: 0, stopped: "deadline" });
    expect(dir.calls).toEqual([]);
  });

  it("ends the day, not the function, when the directory will not answer — and keeps its place", async () => {
    await prisma.platformSetting.create({ data: { key: KEY, value: JSON.stringify(at(0, 300)) } });
    const dir = directory(10, { refuse: true });
    const r = await run(dir, 10);
    expect(r).toMatchObject({ fetched: 0, stopped: "refused", position: at(0, 300) });
    // Asked, backed off, asked again — not hammered, not given up on at once.
    expect(dir.calls.length).toBe(3);
    expect(await cursor()).toEqual(at(0, 300));
    expect(await prisma.courseCatalog.count({ where: { id: { startsWith: MARK } } })).toBe(0);
  });
});

describe("who may run it", () => {
  const original = process.env.CRON_SECRET;
  const ask = (headers: Record<string, string> = {}) =>
    GET(new Request("https://example.invalid/api/cron/course-catalogue", { headers }));
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("refuses without the secret, with a wrong one, and when none is configured — and asks the directory nothing", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);

    process.env.CRON_SECRET = SECRET;
    expect((await ask()).status).toBe(401);
    expect((await ask({ authorization: "Bearer nope" })).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await ask({ authorization: `Bearer ${SECRET}` })).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("lets the scheduler through (the control — else a route that always refuses passes)", async () => {
    /**
     * Against the REAL position key, so its row is put back exactly as found.
     * The stubbed directory returns an empty listing: the run reaches "the
     * end" at once, writes offset 0, and spends nothing.
     */
    const { WALK_KEY } = await import("@/lib/services/catalogue-import");
    const before = await prisma.platformSetting.findUnique({ where: { key: WALK_KEY } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ courses: [] }), { status: 200 })));
    process.env.CRON_SECRET = SECRET;
    try {
      const res = await ask({ authorization: `Bearer ${SECRET}` });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, fetched: 0, stopped: "end" });
    } finally {
      if (before) await prisma.platformSetting.update({ where: { key: WALK_KEY }, data: { value: before.value } });
      else await prisma.platformSetting.deleteMany({ where: { key: WALK_KEY } });
    }
  });

  it("is scheduled", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
    expect(vercel.crons.map((c) => c.path)).toContain("/api/cron/course-catalogue");
  });
});
