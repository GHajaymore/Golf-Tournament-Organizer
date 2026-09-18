import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * ONE DOOR INTO A CLUB'S COURSE LIBRARY.
 *
 * Four paths created a Course, each with its own idea of the rules:
 *
 *   saveClubCourse           typed in by the club        — NO duplicate check
 *   importClubCourseCard     a card pasted in            — NO duplicate check
 *   importCourseFromDirectory  picked from the directory — exact-name check
 *   nameMatchVenue           named while scoring a round — fuzzy match first
 *
 * Two of four is the shape CLAUDE.md names: "a guard you must remember to call
 * is a guard that will be forgotten". The club that pastes the same card twice,
 * or types a name it already has, ends up choosing between two identical
 * venues with no way to tell them apart — and if one of them carries the real
 * stroke index and the other does not, that choice decides whether a season's
 * handicap shots land on the right holes.
 *
 * So the rule lives HERE, where the row is written, and the callers cannot
 * forget it. Same shape as `standingRows` returning `[]` for a manual format:
 * correct by construction rather than by everyone remembering.
 *
 * `one-door-for-a-course.test.ts` holds the door shut — it fails if a
 * `prisma.course.create` appears anywhere else.
 *
 * WHERE THE PLAN LIMIT WILL GO. A course-library cap is one of the gates the
 * tiers may want, and this is the line it goes on — a single `refusalFor` call
 * before the create. It is deliberately NOT here yet: the tier ladder is not
 * decided, and a limit key set to unlimited on every tier is a dead key of
 * exactly the kind `no-dead-feature-keys.test.ts` exists to catch.
 *
 * When it is added, `origin` is the reason it must be: a casual round naming
 * its own venue is the FREE thing anybody can do, and refusing it because a
 * club's paid library is full would be the app refusing a free feature on the
 * grounds that a paid one is full. See `limits.ts` on casual rounds not
 * counting as tournaments — same argument, same exemption.
 */
export type CourseOrigin =
  /** Typed into the club's course screen. */
  | "entered"
  /** A scorecard pasted in and parsed. */
  | "imported-card"
  /** Chosen from the course directory. */
  | "imported-directory"
  /** Named by a player while scoring a casual round. Never to be refused. */
  | "entered-at-scoring";

export type AddCourseResult =
  | { ok: true; courseId: string }
  /** `courseId` is the EXISTING course when the refusal is a duplicate, so the
   *  caller can offer it rather than making somebody go and find it. */
  | { ok: false; error: string; courseId?: string };

/**
 * The course this club already has under that name, if any.
 *
 * Trimmed and case-insensitive, because "Maketewah" and "maketewah " are the
 * same course to everybody except a database. Deliberately EXACT beyond that:
 * `matchCourse` does the fuzzy version, and it belongs to the scoring flow
 * where a player is standing on a tee and can be asked. A fuzzy refusal here
 * would stop a club adding "Blackwolf Run — Meadow Valleys" because it already
 * has "Blackwolf Run — River", which are two different golf courses.
 */
async function existingNamed(organizationId: string, name: string) {
  return prisma.course.findFirst({
    where: { organizationId, name: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true, name: true },
  });
}

/**
 * Add a course to an organization's library, or refuse and say why.
 *
 * Callers still own their own pre-checks — `nameMatchVenue` asks
 * `matchCourse` first because it has a better question to ask — and pass
 * through whatever comes back.
 */
export async function addCourseToLibrary(opts: {
  organizationId: string;
  origin: CourseOrigin;
  data: Omit<Prisma.CourseUncheckedCreateInput, "organizationId">;
}): Promise<AddCourseResult> {
  const { organizationId, data } = opts;
  const name = String(data.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter a course name." };

  const already = await existingNamed(organizationId, name);
  if (already) {
    return {
      ok: false,
      error: `${already.name} is already in your course library.`,
      courseId: already.id,
    };
  }

  const created = await prisma.course.create({
    data: { ...data, name, organizationId },
    select: { id: true },
  });
  return { ok: true, courseId: created.id };
}
