import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addCourseToLibrary } from "@/lib/services/course-library";

/**
 * THE DOOR INTO A CLUB'S COURSE LIBRARY, AGAINST REAL ROWS.
 *
 * `one-door-for-a-course.test.ts` proves nothing else writes a Course.
 * This proves the door does the job the other paths were skipping — two of the
 * four never checked for a duplicate at all, so a club that pasted the same
 * card twice got two rows for one golf course.
 *
 * Why that matters more than tidiness: the two rows are not interchangeable.
 * One may carry the club's real stroke index and the other a card nobody has
 * checked, and picking the wrong one allocates handicap shots to the wrong
 * holes for every round played on it. `handicap-policy.ts` calls that class of
 * fault catastrophic, and it is invisible — a wrong par is noticed on the
 * tee, a wrong stroke index never is.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ONEDOOR";
const CARD = {
  pars: JSON.stringify(new Array(18).fill(4)),
  yards: JSON.stringify(new Array(18).fill(400)),
  strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
};

let organizationId = "";

beforeAll(async () => {
  // Start from nothing, in case a previous run died before its teardown — the
  // counts below are assertions about this club's library and a leftover row
  // would make them lie in whichever direction is least obvious.
  await prisma.course.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });

  const org = await prisma.organization.create({
    data: { name: `${TAG} Golf Society`, kind: "society" },
    select: { id: true },
  });
  organizationId = org.id;
});

afterAll(async () => {
  // Swept BY THE MARK, not by an id held in a variable: a run that dies before
  // its teardown would otherwise leave a club in the development database for
  // ever, and the next person has no way to tell it from a real one.
  // `audit-guards.test.ts` enforces this, and caught this file doing it the
  // other way.
  try {
    await prisma.course.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("adding a course to a club's library", () => {
  it("adds the first one and hands back its id", async () => {
    const added = await addCourseToLibrary({
      organizationId,
      origin: "entered",
      data: { name: `${TAG} Maketewah`, city: "Cincinnati", ...CARD },
    });

    expect(added.ok, "ok" in added && !added.ok ? added.error : "").toBe(true);
    const row = await prisma.course.findFirst({
      where: { organizationId, name: `${TAG} Maketewah` },
      select: { id: true, city: true },
    });
    expect(row?.id).toBe(added.ok ? added.courseId : "");
    // The payload is written through unchanged — the door is a gate, not a
    // filter, and a field it silently dropped would be a card with a hole in it.
    expect(row?.city).toBe("Cincinnati");
  });

  it("refuses the same course twice and names the one already there", async () => {
    const again = await addCourseToLibrary({
      organizationId,
      origin: "imported-card",
      data: { name: `${TAG} Maketewah`, ...CARD },
    });

    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error).toContain("already in your course library");
    // The existing id comes back so the screen can offer that course rather
    // than sending somebody off to find it.
    const row = await prisma.course.findFirst({
      where: { organizationId, name: `${TAG} Maketewah` },
      select: { id: true },
    });
    expect(again.courseId).toBe(row?.id);

    const count = await prisma.course.count({ where: { organizationId } });
    expect(count, "a second row was written despite the refusal").toBe(1);
  });

  it("treats a difference of case or padding as the same course", async () => {
    /**
     * The check that used to exist on the directory path was case-SENSITIVE,
     * so "Maketewah" and "maketewah" were two courses to the database and one
     * course to everybody else. A club typing a name by hand is exactly where
     * that difference comes from.
     */
    const padded = await addCourseToLibrary({
      organizationId,
      origin: "entered",
      data: { name: `  ${TAG.toLowerCase()} maketewah  `, ...CARD },
    });

    expect(padded.ok).toBe(false);
    expect(await prisma.course.count({ where: { organizationId } })).toBe(1);
  });

  it("stores a name trimmed, so the next comparison is against a clean one", async () => {
    const added = await addCourseToLibrary({
      organizationId,
      origin: "entered-at-scoring",
      data: { name: `  ${TAG} Losantiville  `, ...CARD },
    });

    expect(added.ok).toBe(true);
    const row = await prisma.course.findFirst({
      where: { organizationId, name: `${TAG} Losantiville` },
      select: { name: true },
    });
    expect(row?.name, "the untrimmed name was stored").toBe(`${TAG} Losantiville`);
  });

  it("refuses a nameless course rather than storing a blank row", async () => {
    const added = await addCourseToLibrary({
      organizationId,
      origin: "entered",
      data: { name: "   ", ...CARD },
    });

    expect(added.ok).toBe(false);
    expect(await prisma.course.count({ where: { organizationId } })).toBe(2);
  });

  it("lets a different club have a course of the same name", async () => {
    /**
     * The control on the duplicate rule, and the failure that would matter
     * most: two clubs play courses with the same name all the time, and a
     * check written against the whole table rather than one organization
     * would refuse the second club a course it actually plays.
     */
    const other = await prisma.organization.create({
      data: { name: `${TAG} Other Society`, kind: "society" },
      select: { id: true },
    });
    try {
      const added = await addCourseToLibrary({
        organizationId: other.id,
        origin: "entered",
        data: { name: `${TAG} Maketewah`, ...CARD },
      });
      expect(added.ok, "a second club was refused a course of the same name").toBe(true);
    } finally {
      await prisma.course.deleteMany({ where: { organizationId: other.id } });
      await prisma.organization.deleteMany({ where: { id: other.id } });
    }
  });
});
