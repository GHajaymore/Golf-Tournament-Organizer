import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

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

const { importCatalogueSlice, refreshCatalogueSlice } = await import("@/lib/services/catalogue-import");
const { importGcaSlice, gcaId } = await import("@/lib/services/catalogue-gca");

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
  // Both directories' ids: GolfCourseAPI rows are stored as "gca:" + id.
  await prisma.courseCatalog.deleteMany({
    where: { OR: [{ id: { startsWith: MARK } }, { id: { startsWith: `gca:${MARK}` } }] },
  });
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

describe("another writer landing the same course in between", () => {
  it("is a skip, not a failed night — and what the other writer stored is left alone", async () => {
    /**
     * `known` is read, then each course is fetched and created. A bulk import
     * (or a second run) can store the same id inside that gap. The fake
     * directory does exactly that, for one course, the moment it is asked for
     * it.
     */
    const dir = directory(3);
    const raced = dir.ids[1];
    const fetchJson = async (path: string) => {
      if (path.endsWith(encodeURIComponent(raced))) {
        await prisma.courseCatalog.create({ data: { id: raced, name: "zz-stored-by-someone-else" } });
      }
      return dir.fetchJson(path);
    };
    const r = await importCatalogueSlice({ budget: 10, deadline: later(), fetchJson, sleep: noSleep, cursorKey: KEY, states: STATES });
    expect(r.fetched).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.stopped).toBe("end");
    // The other writer's row, untouched; the other two stored normally.
    expect((await prisma.courseCatalog.findUnique({ where: { id: raced } }))?.name).toBe("zz-stored-by-someone-else");
    expect(await prisma.courseCatalog.count({ where: { id: { startsWith: MARK } } })).toBe(3);
  });
});

/**
 * LATEST AND CLEAN (Ajay, 2026-10-04). The refresh pass against real rows,
 * confined to this file's marked ids. Each stored row is backdated past the
 * refresh age so it is due.
 */
describe("re-fetching the oldest stored courses", () => {
  const OLD = new Date(Date.now() - 90 * 86_400_000);
  const SORTED = [5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 3, 4]; // refused since #771
  const NEW_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
  const row = (id: string, pars: number[] | null) =>
    prisma.courseCatalog.create({
      data: {
        id, name: `ZZ Old ${id}`, fetchedAt: OLD,
        pars: pars ? JSON.stringify(pars) : "", strokeIndex: pars ? JSON.stringify(SI) : "",
        par: pars ? pars.reduce((a, b) => a + b, 0) : 0,
      },
    });
  /** A directory that answers per id: a good card, no card, or nothing at all. */
  const answering = (answers: Record<string, "card" | "none" | "404">) => async (path: string) => {
    const id = decodeURIComponent(path.split("/").pop() ?? "");
    const a = answers[id];
    if (!a || a === "404") return { status: 404, body: null };
    return {
      status: 200,
      body: { id, course_name: `ZZ Fresh ${id}`, city: "Zz Town", holes_data: a === "card" ? holes(NEW_PARS, SI) : [], tees: [] },
    };
  };
  const refresh = (answers: Record<string, "card" | "none" | "404">, budget = 10) =>
    refreshCatalogueSlice({ budget, deadline: later(), fetchJson: answering(answers), sleep: noSleep, idPrefix: MARK });
  const get = (id: string) => prisma.courseCatalog.findUniqueOrThrow({ where: { id } });

  it("takes the directory's newer card, judged by today's rules", async () => {
    await row(`${MARK}r1`, PARS);
    const r = await refresh({ [`${MARK}r1`]: "card" });
    expect(r).toMatchObject({ checked: 1, updated: 1 });
    const after = await get(`${MARK}r1`);
    expect(JSON.parse(after.pars)).toEqual(NEW_PARS);
    expect(after.name).toBe(`ZZ Fresh ${MARK}r1`);
    expect(after.fetchedAt.getTime()).toBeGreaterThan(OLD.getTime());
  });

  it("never swaps a good stored card for no card", async () => {
    await row(`${MARK}r2`, PARS);
    const r = await refresh({ [`${MARK}r2`]: "none" });
    expect(r).toMatchObject({ kept: 1, updated: 0, cleared: 0 });
    expect(JSON.parse((await get(`${MARK}r2`)).pars)).toEqual(PARS);
  });

  it("clears a stored card today's rules refuse, when nothing better comes, and says why", async () => {
    await row(`${MARK}r3`, SORTED);
    const r = await refresh({ [`${MARK}r3`]: "404" });
    expect(r).toMatchObject({ cleared: 1 });
    const after = await get(`${MARK}r3`);
    expect(after.pars).toBe("");
    expect(after.cardProblem).toContain("par 5s in a row");
    // Still in the catalogue, findable by name.
    expect(after.name).toBe(`ZZ Old ${MARK}r3`);
  });

  it("takes the oldest first, up to its budget, and moves each one's date", async () => {
    await row(`${MARK}r4`, PARS);
    await row(`${MARK}r5`, PARS);
    await prisma.courseCatalog.update({ where: { id: `${MARK}r5` }, data: { fetchedAt: new Date(OLD.getTime() - 86_400_000) } });
    const r = await refresh({}, 1);
    expect(r).toMatchObject({ checked: 1, stopped: "budget" });
    expect((await get(`${MARK}r5`)).fetchedAt.getTime()).toBeGreaterThan(OLD.getTime());
    expect((await get(`${MARK}r4`)).fetchedAt.getTime()).toBe(OLD.getTime());
  });

  it("leaves a course read recently alone (the control)", async () => {
    await prisma.courseCatalog.create({ data: { id: `${MARK}r6`, name: "ZZ Recent" } });
    expect((await refresh({ [`${MARK}r6`]: "card" })).checked).toBe(0);
  });
});

/**
 * INTERNATIONAL — GolfCourseAPI brought into the app, with a fake directory
 * and its own state key. Complete cards only: a missing stroke index is stored
 * as a reason, never as a usable card.
 */
describe("the international slice", () => {
  const GCA_KEY = "zz-gca-walk-test";
  afterEach(() => prisma.platformSetting.deleteMany({ where: { key: GCA_KEY } }));
  const gholes = (pars: number[], si: (number | null)[]) => pars.map((par, i) => ({ par, handicap: si[i], yardage: 0 }));
  const summary = (id: string, country: string, tees = 1) => ({
    id, club_name: `ZZ Club ${id}`, course_name: "", location: { city: "Zz", country }, tees: { male: tees },
  });
  const gcaDirectory = () => {
    const calls: string[] = [];
    const fetchJson = async (path: string) => {
      calls.push(path);
      if (path.startsWith("/v1/search")) {
        return {
          status: 200,
          body: {
            courses: [
              summary(`${MARK}us`, "United States"),
              summary(`${MARK}gb`, "England"),
              summary(`${MARK}nosi`, "Scotland"),
              summary(`${MARK}notees`, "Ireland", 0),
            ],
          },
        };
      }
      const id = decodeURIComponent(path.split("/").pop() ?? "");
      const noSi = id.endsWith("nosi");
      return { status: 200, body: { course: { tees: { male: [{ holes: gholes(PARS, noSi ? PARS.map(() => null) : SI) }] } } } };
    };
    return { calls, fetchJson };
  };

  it("stores complete cards, the reason for incomplete ones, and fetches outside the US first", async () => {
    const dir = gcaDirectory();
    const r = await importGcaSlice({ budget: 10, deadline: later(), fetchJson: dir.fetchJson, sleep: noSleep, stateKey: GCA_KEY });
    expect(r).toMatchObject({ withCard: 2, queued: 0, stopped: "drained" });
    const gb = await prisma.courseCatalog.findUniqueOrThrow({ where: { id: gcaId(`${MARK}gb`) } });
    expect(JSON.parse(gb.strokeIndex)).toEqual(SI);
    const noSi = await prisma.courseCatalog.findUniqueOrThrow({ where: { id: gcaId(`${MARK}nosi`) } });
    expect(noSi.pars).toBe("");
    expect(noSi.cardProblem).toContain("no stroke index");
    // No tee boxes: judged off the search row, no detail request spent on it.
    expect(dir.calls.some((c) => c.includes("notees"))).toBe(false);
    expect((await prisma.courseCatalog.findUniqueOrThrow({ where: { id: gcaId(`${MARK}notees`) } })).cardProblem).toContain("no tee boxes");
    // Outside the US first: the US course is the last detail asked for.
    const details = dir.calls.filter((c) => c.startsWith("/v1/courses/"));
    expect(details[details.length - 1]).toContain(`${MARK}us`);
  });

  it("stops at its budget and keeps the rest banked for tomorrow", async () => {
    const dir = gcaDirectory();
    const r = await importGcaSlice({ budget: 2, deadline: later(), fetchJson: dir.fetchJson, sleep: noSleep, stateKey: GCA_KEY });
    expect(r.stopped).toBe("budget");
    expect(r.requests).toBe(2);
    expect(r.queued).toBe(2);
    const state = JSON.parse((await prisma.platformSetting.findUniqueOrThrow({ where: { key: GCA_KEY } })).value);
    expect(state.queue).toHaveLength(2);
    expect(state.termIndex).toBe(1);
  });
});
