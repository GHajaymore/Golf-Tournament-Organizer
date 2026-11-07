import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * LOADING THE CATALOGUE, AGAINST REAL ROWS (J29). Development database only, rows marked `zz-catload-`.
 *
 *   a load                       -> rows stored, counted "loaded"
 *   the same load again          -> nothing written: all "unchanged" (idempotent)
 *   a changed usable row         -> "updated"
 *   a refused card               -> skipped and counted, never stored
 *   a usable stored card         -> never replaced by a refused one
 *   a gca: id                    -> refused and counted apart, never stored
 *   somebody who is not an owner -> "Not found.", nothing stored
 *   every load                   -> one audit line, and no row is ever deleted
 */
const prisma = new PrismaClient();
const MARK = "zz-catload-";
const OWNER = `${MARK}owner@example.invalid`;
let session: { email: string; userId: string } | null = { email: OWNER, userId: "zz-catload-user" };
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { loadCourseCatalogue } = await import("@/app/actions/owner");
const { CATALOGUE_LOG_KEY } = await import("@/lib/services/catalogue-load");

const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const row = (n: string, over: Record<string, unknown> = {}) => ({
  id: `${MARK}${n}`,
  name: `Zz Invented ${n}`,
  city: "Nowhere",
  state: "ZZ",
  country: "US",
  website: "",
  address: "",
  par: 72,
  pars: JSON.stringify(PARS),
  yards: "",
  strokeIndex: JSON.stringify(SI),
  tees: "[]",
  cardProblem: "",
  ...over,
});
let logBefore: string | null = null;
let ownerWas: string | undefined;

beforeAll(async () => {
  ownerWas = process.env.OWNER_EMAILS;
  process.env.OWNER_EMAILS = OWNER;
  logBefore = (await prisma.platformSetting.findUnique({ where: { key: CATALOGUE_LOG_KEY } }))?.value ?? null;
  await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: MARK } } });
  await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: "gca:zz-catload" } } });
});

afterAll(async () => {
  try {
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: MARK } } });
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: "gca:zz-catload" } } });
    if (logBefore === null) await prisma.platformSetting.deleteMany({ where: { key: CATALOGUE_LOG_KEY } });
    else await prisma.platformSetting.update({ where: { key: CATALOGUE_LOG_KEY }, data: { value: logBefore } });
    if (ownerWas === undefined) delete process.env.OWNER_EMAILS;
    else process.env.OWNER_EMAILS = ownerWas;
  } finally {
    await prisma.$disconnect();
  }
});

const stored = (n: string) => prisma.courseCatalog.findUnique({ where: { id: `${MARK}${n}` } });

describe("loadCourseCatalogue", () => {
  it("loads, then a re-load is idempotent", async () => {
    const first = await loadCourseCatalogue([row("a"), row("b")]);
    expect(first).toMatchObject({ ok: true, counts: { loaded: 2, updated: 0, unchanged: 0, skipped: 0, refusedGca: 0 } });
    const before = (await stored("a"))!.updatedAt.getTime();
    const again = await loadCourseCatalogue([row("a"), row("b")]);
    expect(again.counts).toMatchObject({ loaded: 0, updated: 0, unchanged: 2 });
    expect((await stored("a"))!.updatedAt.getTime()).toBe(before);
  });

  it("updates a changed usable row", async () => {
    const res = await loadCourseCatalogue([row("a", { name: "Zz Invented A, renamed" })]);
    expect(res.counts).toMatchObject({ updated: 1, loaded: 0 });
    expect((await stored("a"))!.name).toBe("Zz Invented A, renamed");
  });

  it("skips a refused card, never storing it, and never downgrading a usable one", async () => {
    const blankSi = JSON.stringify(PARS.map(() => 0));
    const res = await loadCourseCatalogue([row("c", { strokeIndex: blankSi }), row("b", { pars: "", strokeIndex: "", cardProblem: "No card" })]);
    expect(res.counts).toMatchObject({ skipped: 2, loaded: 0, updated: 0 });
    expect(await stored("c")).toBeNull();
    const b = (await stored("b"))!;
    expect(b.pars).toBe(JSON.stringify(PARS));
    expect(b.cardProblem).toBe("");
  });

  it("refuses a gca: id and stores nothing for it, counted apart", async () => {
    const res = await loadCourseCatalogue([row("d", { id: "gca:zz-catload-1" }), row("e")]);
    expect(res.counts).toMatchObject({ refusedGca: 1, loaded: 1 });
    expect(await prisma.courseCatalog.count({ where: { id: { startsWith: "gca:zz-catload" } } })).toBe(0);
  });

  it("never deletes: rows absent from a later load stay", async () => {
    await loadCourseCatalogue([row("e")]);
    expect(await stored("a")).not.toBeNull();
    expect(await stored("b")).not.toBeNull();
  });

  it("writes an audit line naming who, and the counts", async () => {
    const log = (await prisma.platformSetting.findUnique({ where: { key: CATALOGUE_LOG_KEY } }))!.value;
    const last = log.split("\n").pop()!;
    expect(last).toContain(OWNER);
    expect(last).toMatch(/\d+ loaded, \d+ updated/);
  });

  it("is Not found. for somebody who is not an owner, and for nobody signed in; nothing stored", async () => {
    const was = session;
    session = { email: `${MARK}stranger@example.invalid`, userId: "zz-catload-stranger" };
    expect(await loadCourseCatalogue([row("f")])).toEqual({ ok: false, error: "Not found." });
    session = null;
    expect(await loadCourseCatalogue([row("f")])).toEqual({ ok: false, error: "Not found." });
    session = was;
    expect(await stored("f")).toBeNull();
  });

  it("refuses an empty or oversized request", async () => {
    expect((await loadCourseCatalogue([])).ok).toBe(false);
    expect((await loadCourseCatalogue(Array.from({ length: 400 }, (_, i) => row(`x${i}`)))).ok).toBe(false);
    expect((await loadCourseCatalogue("nope")).ok).toBe(false);
  });
});
