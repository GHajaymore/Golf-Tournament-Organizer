import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * GOLFCOURSEAPI IS ASKED ONLY WHEN SOMEBODY SEARCHES (Ajay, 7 Nov 2026: "Switch it off").
 *
 * The provider's terms forbid compiling its dataset, and a cron used to walk it
 * twice a day. Two promises, both pinned here:
 *
 *  1. NOTHING SCHEDULES THE WALK — no cron entry, no route, no importer left to
 *     call. (The control proves the sweep can see a cron at all.)
 *  2. A SEARCH THE STORED CATALOGUE CANNOT ANSWER FALLS BACK TO THE LIVE LOOKUP,
 *     for THAT search only, and the picked course alone is judged and stored.
 *
 * Every HTTP call is a stub: no test here reaches the real API, and no key is a
 * real key.
 */

const store = vi.hoisted(() => ({
  upserts: [] as Array<{ where: { id: string }; create: Record<string, unknown> }>,
  held: null as { pars: string } | null,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    courseCatalog: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => store.held),
      upsert: vi.fn(async (a: { where: { id: string }; create: Record<string, unknown> }) => {
        store.upserts.push(a);
        return {};
      }),
    },
  },
}));

const { searchDirectory, searchDirectoryWithNotice, fetchDirectoryCourse } = await import("@/lib/services/course-directory");
const { gcaFetch, GCA_TIMEOUT_MS, GCA_UNAVAILABLE_NOTICE } = await import("@/lib/services/golfcourseapi-live");

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("nothing schedules the catalogue walk", () => {
  const crons = () =>
    (JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons: Array<{ path: string }> }).crons.map((c) => c.path);

  it("exactly one cron walks the catalogue, once a day, and it is the OpenGolfAPI route", () => {
    expect(crons().filter((p) => /catalogue|course/i.test(p))).toEqual(["/api/cron/course-catalogue"]);
    expect(existsSync(join(ROOT, "src/app/api/cron/course-catalogue/route.ts"))).toBe(true);
  });

  it("control: the sweep can see a cron when there is one", () => {
    expect(crons()).toContain("/api/cron/expire-rounds");
  });

  it("the GolfCourseAPI walk is gone, with every importer and script that only it used", () => {
    expect(existsSync(join(ROOT, "src/lib/services/catalogue-gca.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "scripts/import-golfcourseapi.ts"))).toBe(false);
    const offenders = walk(join(ROOT, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
      .filter((f) => /importGcaSlice|GCA_TERMS|catalogue-gca/.test(readSource(f.slice(ROOT.length + 1))));
    expect(offenders).toEqual([]);
  });

  /** Every module a file reaches through `@/...` imports (static, re-exports and dynamic). */
  const reach = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const todo = [entry];
    while (todo.length) {
      const file = todo.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readSource(file);
      for (const m of src.matchAll(/(?:from|import\()\s*["']@\/([^"']+)["']/g)) {
        const base = `src/${m[1]}`;
        const hit = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(join(ROOT, p)));
        if (hit) todo.push(hit);
      }
    }
    return seen;
  };

  it("the cron's code path never reaches golfcourseapi-live.ts", () => {
    const reached = reach("src/app/api/cron/course-catalogue/route.ts");
    expect(reached.has("src/lib/services/catalogue-import.ts")).toBe(true); // it sees the real path
    expect(reached.has("src/lib/services/golfcourseapi-live.ts")).toBe(false);
  });

  it("control: from an organizer's search it does reach it", () => {
    expect(reach("src/app/actions/courses.ts").has("src/lib/services/golfcourseapi-live.ts")).toBe(true);
  });
});

describe("search falls back to the live lookup", () => {
  const KEY_ENV = "GOLFCOURSE_API_KEY";
  const saved = process.env[KEY_ENV];
  const urls: string[] = [];
  let headers: Array<Record<string, string>> = [];
  let gcaAnswer: () => Response | Promise<Response> = () => Response.json({ courses: [] });

  beforeEach(() => {
    process.env[KEY_ENV] = "zz-placeholder-not-a-key";
    store.upserts.length = 0;
    store.held = null;
    urls.length = 0;
    headers = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        urls.push(url);
        headers.push(init?.headers ?? {});
        // The open directory has nothing; GolfCourseAPI is the scripted one.
        return url.startsWith("https://api.golfcourseapi.com") ? gcaAnswer() : Response.json({ courses: [] });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = saved;
  });

  const summary = { id: 7, club_name: "ZZ Fixture Club", course_name: "", location: { city: "Zzville", country: "England" } };

  it("asks GolfCourseAPI for THIS search when nothing stored or open matches, and ids the hit gca:", async () => {
    gcaAnswer = () => Response.json({ courses: [summary] });
    const hits = await searchDirectory("zz fixture", false);
    expect(hits).toMatchObject([{ id: "gca:7", name: "ZZ Fixture Club", city: "Zzville", country: "GB" }]);
    const gcaCalls = urls.filter((u) => u.startsWith("https://api.golfcourseapi.com"));
    expect(gcaCalls).toEqual(["https://api.golfcourseapi.com/v1/search?search_query=zz%20fixture"]);
    expect(headers[urls.indexOf(gcaCalls[0])].Authorization).toMatch(/^Bearer /);
  });

  it("does not ask at all while typing (catalogue only)", async () => {
    gcaAnswer = () => Response.json({ courses: [summary] });
    expect(await searchDirectory("zz fixture", true)).toEqual([]);
    expect(urls).toEqual([]);
  });

  it("with no key it is silent: no call, no notice", async () => {
    delete process.env[KEY_ENV];
    const r = await searchDirectoryWithNotice("zz fixture", false);
    expect(r.hits).toEqual([]);
    expect(r.notice).toBeUndefined();
    expect(urls.some((u) => u.startsWith("https://api.golfcourseapi.com"))).toBe(false);
  });

  it("when the lookup is down it says so in plain words and does not throw", async () => {
    for (const down of [() => new Response("no", { status: 503 }), () => new Response("slow", { status: 429 })]) {
      gcaAnswer = down;
      const r = await searchDirectoryWithNotice("zz fixture", false);
      expect(r.hits).toEqual([]);
      expect(r.notice).toBe(GCA_UNAVAILABLE_NOTICE);
    }
    gcaAnswer = () => {
      throw new TypeError("network");
    };
    expect((await searchDirectoryWithNotice("zz fixture", false)).notice).toBe(GCA_UNAVAILABLE_NOTICE);
    // Nothing in the words blocks the other ways of adding a course.
    expect(GCA_UNAVAILABLE_NOTICE).toMatch(/typing it in or pasting/);
  });

  it("is bounded by a timeout", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return Response.json({});
    }));
    await gcaFetch("zz-placeholder-not-a-key")("/v1/search?search_query=x");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(GCA_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("fetches and stores only the picked course, through the card rule", async () => {
    const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
    const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
    const holes = (si: number[]) => PARS.map((par, i) => ({ par, handicap: si[i], yardage: 0 }));
    gcaAnswer = () =>
      Response.json({ course: { ...summary, tees: { male: [{ tee_name: "White", course_rating: 71.2, slope_rating: 128, holes: holes(SI) }] } } });
    const c = await fetchDirectoryCourse("gca:7", true);
    expect(c?.card).toMatchObject({ usable: true, strokeIndex: SI });
    expect(urls).toEqual(["https://api.golfcourseapi.com/v1/courses/7"]);
    expect(store.upserts).toHaveLength(1);
    expect(store.upserts[0].where.id).toBe("gca:7");
    expect(JSON.parse(store.upserts[0].create.strokeIndex as string)).toEqual(SI);

    // A repeated stroke index is refused by cardRefusal: stored as a reason, not a card.
    store.upserts.length = 0;
    gcaAnswer = () => Response.json({ course: { ...summary, tees: { male: [{ tee_name: "White", holes: holes(SI.map(() => 5)) }] } } });
    const bad = await fetchDirectoryCourse("gca:7", true);
    expect(bad?.card.usable).toBe(false);
    expect(store.upserts[0].create.pars).toBeUndefined();
    expect(store.upserts[0].create.cardProblem).not.toBe("");
  });

  it("never calls the live lookup for a catalogue-only read of a stored id", async () => {
    expect(await fetchDirectoryCourse("gca:7", false)).toBeNull();
    expect(urls).toEqual([]);
  });
});
