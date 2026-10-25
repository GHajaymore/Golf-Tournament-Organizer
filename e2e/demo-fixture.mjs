/**
 * A TEST'S OWN DEMO CLUB, TAKEN DOWN (2026-10-24; docs/claude/demo-club.md).
 *
 * A test builds the demo through the app's own `buildDemoClub` — pressed on
 * /owner by the owner spec, called directly by the database tests — under its
 * own `zz-demo` mark, and removes it with this in a `finally`. Only a marked
 * demo, never the bare one a visitor is watching, and only a club carrying the
 * demo's mark (`isDemo`).
 */
import { runMark } from "../scripts/run-mark.mjs";

/** This worktree's demo mark: the same in the server Playwright starts (`DEMO_CLUB_MARK`) and in the spec. */
export function demoTestMark(cwd = process.cwd()) {
  return runMark("zz-demo", cwd);
}

/** The club name `demoClubName(mark)` gives, written out for a test that cannot import the app's TypeScript. */
export function demoTestClubName(mark) {
  return `${mark} Quillstone Golf Club`;
}

export async function removeDemoClub(prisma, mark) {
  if (!String(mark).startsWith("zz-")) throw new Error("Only a test's own demo (a zz- mark) is ever removed.");
  const clubs = await prisma.organization.findMany({
    where: { name: { startsWith: mark }, isDemo: true },
    select: { id: true },
  });
  const ids = clubs.map((c) => c.id);
  if (ids.length === 0) return;
  await prisma.organization.updateMany({ where: { id: { in: ids } }, data: { defaultCourseId: null } });
  await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
  const courses = await prisma.course.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
  await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
  await prisma.course.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids }, isDemo: true } });
}
