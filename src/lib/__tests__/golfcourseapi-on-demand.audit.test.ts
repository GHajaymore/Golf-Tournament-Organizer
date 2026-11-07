import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * GOLFCOURSEAPI, ON DEMAND (7 Nov 2026) — against real rows, with a fake HTTP
 * call so no test ever spends the real allowance or needs a key.
 *
 * The scheduled walk is gone (`golfcourseapi-on-demand.test.ts` pins that).
 * What is left is the one course somebody picked: fetched, judged by
 * `cardRefusal`, stored. A missing stroke index is stored as a reason, never as
 * a usable card.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const MARK = "zz-gca-";

const { fetchGolfCourseApiCourse, gcaId } = await import("@/lib/services/golfcourseapi-live");

const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];

async function scrub() {
  await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: `gca:${MARK}` } } });
}
beforeAll(scrub);
afterEach(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("the picked GolfCourseAPI course", () => {
  const gholes = (pars: number[], si: (number | null)[]) => pars.map((par, i) => ({ par, handicap: si[i], yardage: 0 }));
  const answer = (si: (number | null)[]) => async () => ({
    status: 200,
    body: {
      id: 1,
      club_name: "ZZ Club",
      course_name: "",
      location: { city: "Zz", country: "England" },
      tees: { male: [{ tee_name: "White", course_rating: 71.2, slope_rating: 128, par_total: 72, total_yards: 6500, holes: gholes(PARS, si) }] },
    },
  });

  it("stores the one course with its card and its rated tees", async () => {
    const calls: string[] = [];
    const fetchJson = async (path: string) => {
      calls.push(path);
      return answer(SI)();
    };
    const c = await fetchGolfCourseApiCourse(`gca:${MARK}ok`, { fetchJson });
    expect(c?.card).toMatchObject({ usable: true });
    expect(calls).toEqual([`/v1/courses/${encodeURIComponent(`${MARK}ok`)}`]);
    const row = await prisma.courseCatalog.findUniqueOrThrow({ where: { id: gcaId(`${MARK}ok`) } });
    expect(JSON.parse(row.strokeIndex)).toEqual(SI);
    expect(JSON.parse(row.tees)).toMatchObject([{ name: "White", gender: "men", courseRating: 71.2, slopeRating: 128 }]);
  });

  it("stores the reason, not a card, when the stroke index is missing", async () => {
    await fetchGolfCourseApiCourse(`gca:${MARK}nosi`, { fetchJson: answer(PARS.map(() => null)) });
    const row = await prisma.courseCatalog.findUniqueOrThrow({ where: { id: gcaId(`${MARK}nosi`) } });
    expect(row.pars).toBe("");
    expect(row.cardProblem).toContain("no stroke index");
  });

  it("never blanks a card already held when a later answer has none", async () => {
    await fetchGolfCourseApiCourse(`gca:${MARK}held`, { fetchJson: answer(SI) });
    await fetchGolfCourseApiCourse(`gca:${MARK}held`, { fetchJson: answer(PARS.map(() => null)) });
    const row = await prisma.courseCatalog.findUniqueOrThrow({ where: { id: gcaId(`${MARK}held`) } });
    expect(JSON.parse(row.strokeIndex)).toEqual(SI);
  });

  it("stores nothing when the lookup does not answer", async () => {
    expect(await fetchGolfCourseApiCourse(`gca:${MARK}down`, { fetchJson: async () => null })).toBeNull();
    expect(await prisma.courseCatalog.findUnique({ where: { id: gcaId(`${MARK}down`) } })).toBeNull();
  });
});
