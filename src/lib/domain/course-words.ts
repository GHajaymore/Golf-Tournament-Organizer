/**
 * WHO MAY KEEP THE CLUB'S COURSES, in the words a screen says it (R2).
 *
 * The same sentence `requireCourseKeeper` refuses with (`actions/courses.ts`, `KEEPER_REFUSAL`): the
 * Courses screen's read-only banner must say what the refusal behind its buttons says, or a person is
 * told one thing and refused with another. `the-courses-screen.test.ts` holds the two equal. The rule
 * itself is `organizationAccess(...).canEdit`, asked on the server, never worked out here.
 */
export const COURSE_KEEPER_WORDS = "Only a Commissioner or Admin can change the club's courses.";
