import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { MARK } from "./fixture.mjs";

/**
 * THE PERSON STANDING ON THE FIRST TEE WITH NO CLUB, and the course they type.
 *
 * `casual-round.spec.ts` plays a casual round from the empty setup screen to
 * the result, the way somebody does it at the course. It needs two things the
 * shared fixture deliberately does not have:
 *
 *   - a signed-in user who belongs to NO club. Somebody in a club gets that
 *     club's courses and roster offered on the setup screen; the person this
 *     feature is for has neither, so the course has to come from the search.
 *   - a course in the CATALOGUE with a complete card and a rated tee, so the
 *     search finds it without the live directory — a test that depended on a
 *     third-party API answering would go red on somebody else's outage.
 *
 * The tee is rated 72.0 / 113 over a par of 72, so a course handicap equals the
 * index and the strokes a player receives can be read straight off the card.
 *
 * Kept OUT of `seed()`: a casual round makes its own event inside this user's
 * own organization, and the shared fixture's club must not grow a second
 * event that every other spec would then see.
 */
export const CASUAL_EMAIL = `${MARK}-casual@example.invalid`;
export const CASUAL_ORG = `${MARK}-casual`;
export const CASUAL_COURSE = `${MARK}-Fairway Meadows — Links`;
const CATALOGUE_ID = `${MARK}-catalogue`;

export const CASUAL_PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 505];

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/**
 * Everything a run left: the round's events, the course it copied out of the
 * catalogue, the organization, the user and the catalogue row. Safe to call
 * when none of it exists.
 */
export async function teardownCasual(prisma = new PrismaClient()) {
  try {
    const orgs = await prisma.organization.findMany({ where: { name: CASUAL_ORG }, select: { id: true } });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length) {
      await prisma.event.deleteMany({ where: { organizationId: { in: orgIds } } });
      const courses = await prisma.course.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
      await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
      await prisma.course.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    await prisma.user.deleteMany({ where: { email: CASUAL_EMAIL } });
    await prisma.courseCatalog.deleteMany({ where: { id: CATALOGUE_ID } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Seed from clean, and return the signed session cookie for the user. */
export async function seedCasual() {
  await teardownCasual();
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.create({
      data: { email: CASUAL_EMAIL, name: "Casey Fairway", password: "x:unusable" },
    });
    // Their own organization, made ahead so the round lands in one this file
    // knows the name of — `personalOrganizationFor` reuses an owned personal one.
    const org = await prisma.organization.create({ data: { name: CASUAL_ORG, kind: "personal" } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
    await prisma.courseCatalog.create({
      data: {
        id: CATALOGUE_ID,
        name: CASUAL_COURSE,
        city: "Dayton",
        state: "OH",
        country: "US",
        par: CASUAL_PARS.reduce((a, b) => a + b, 0),
        pars: JSON.stringify(CASUAL_PARS),
        yards: JSON.stringify(YARDS),
        strokeIndex: JSON.stringify(SI),
        tees: JSON.stringify([
          { name: "White", gender: "any", courseRating: 72, slopeRating: 113, par: 72, yards: YARDS.reduce((a, b) => a + b, 0) },
        ]),
      },
    });
    return { session: sign(user.id) };
  } finally {
    await prisma.$disconnect();
  }
}
