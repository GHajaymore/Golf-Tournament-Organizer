import { prisma } from "@/lib/db";

/**
 * A PERSON AT THE CLUB HAS LOOKED AT THIS CARD AND SAYS IT MATCHES.
 *
 * The one writer of a course's `verifiedAt` / `verifiedBy`: "Mark as checked"
 * on the course screen (`verifyCourseCard`) and the scorecard step of the setup
 * questionnaire (`createEventFromAnswers`) both come here, so the two cannot
 * come to mean different things. Scoped to the organization — the caller has
 * already decided who may.
 */
export async function markCourseCardChecked(courseId: string, organizationId: string, by: string): Promise<boolean> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId },
    select: { id: true },
  });
  if (!course) return false;
  await prisma.course.update({
    where: { id: courseId },
    data: { verifiedAt: new Date(), verifiedBy: by },
  });
  return true;
}
