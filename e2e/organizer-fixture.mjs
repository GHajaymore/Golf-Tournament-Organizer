import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { MARK } from "./fixture.mjs";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A NEW ORGANIZER WITH NOTHING YET — no club, no tournament, no course.
 *
 * `organizer-medal.spec.ts` runs a club medal from the empty first screen to
 * the finished board, which is the one path the shared fixture can never walk:
 * it arrives with everything already built.
 *
 * Deliberately NOT given an organization. One created here would have no
 * subscription, and a club without one is grandfathered past the published
 * plan terms — so the run would test a club that no new customer can be. The
 * app creates it, on the free plan, the way it does for everybody.
 *
 * The course is in the CATALOGUE, found by typing, with a complete card and a
 * tee rated 72.0 / 113 over par 72 — so a course handicap equals the index and
 * the strokes on the board can be worked out by hand.
 */
export const ORGANIZER_EMAIL = `${MARK}-new-organizer@example.invalid`;
export const MEDAL_COURSE = `${MARK}-Kingsbarn Heath — Old`;
const CATALOGUE_ID = `${MARK}-medal-catalogue`;

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 505];
export const MEDAL_PARS = PARS;
/** A field player's address — invented, marked, and swept by the teardown. */
export const medalEmail = (i) => `${MARK}-medal-${i}@example.invalid`;

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/**
 * Everything the run made. The organization is found through the user's own
 * membership — the app names it after the person, not after the mark — and is
 * refused if anybody else belongs to it.
 */
export async function teardownOrganizer() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: ORGANIZER_EMAIL }, select: { id: true } });
    const owned = user
      ? await prisma.organizationMember.findMany({ where: { userId: user.id }, select: { organizationId: true } })
      : [];
    /**
     * AND THE CLUB A KILLED RUN LEFT WITH NOBODY IN IT (2026-10-11).
     *
     * The organizer's address carries the fixture's mark, and the standing
     * fixture opens every run by deleting every user under that mark. So when
     * a run is stopped inside one of these specs and another is started, the
     * organizer is deleted by THAT sweep — their membership goes with them —
     * and the club, which the app names after the person and not the mark, is
     * left with nobody in it and a tournament on it. Nothing above finds it
     * any more: there is no user to find it through.
     *
     * It then poisons every later run. The tournament still has an organizer
     * account under the same address, so the next fresh "Morgan Starter" is
     * its organizer too, `/choose` goes straight to it instead of asking for
     * a first tournament, and each of these specs waits out its whole timeout
     * on a form that never appears — which reads as the app being broken.
     *
     * So the club is also found the way the app would find it: through a
     * tournament this address organizes. The same refusal applies.
     */
    const reached = await prisma.event.findMany({
      where: { accounts: { some: { email: ORGANIZER_EMAIL } } },
      select: { organizationId: true },
    });
    const ids = [...new Set([...owned.map((o) => o.organizationId), ...reached.map((e) => e.organizationId)])];
    {
      for (const organizationId of ids) {
        const others = await prisma.organizationMember.count({
          where: { organizationId, ...(user ? { userId: { not: user.id } } : {}) },
        });
        if (others > 0) throw new Error(`refusing: organization ${organizationId} has other members`);
        await prisma.event.deleteMany({ where: { organizationId } });
        const courses = await prisma.course.findMany({ where: { organizationId }, select: { id: true } });
        await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
        await prisma.course.deleteMany({ where: { organizationId } });
        await prisma.member.deleteMany({ where: { organizationId } });
        await prisma.organization.delete({ where: { id: organizationId } });
      }
    }
    // The field's own sign-in accounts, made as each player is entered.
    await prisma.user.deleteMany({ where: { email: { startsWith: `${MARK}-medal-` } } });
    await prisma.user.deleteMany({ where: { email: ORGANIZER_EMAIL } });
    await prisma.courseCatalog.deleteMany({ where: { id: CATALOGUE_ID } });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * A signed-in session for a member the organizer has entered — their sign-in
 * account, made the way a first sign-in would make it (`organizer-entry.spec`
 * walks that part), so a spec can read the player app as them. Swept by the
 * teardown with the field's other `medal-` addresses.
 */
export async function memberSession(email, name) {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, password: "x:unusable" },
    });
    return sign(signedInNow(user.id));
  } finally {
    await prisma.$disconnect();
  }
}

/** Seed from clean, and return the signed session cookie for the organizer. */
/**
 * THE ORGANIZER'S OWN TOURNAMENT, AS ROWS — for a spec that must put it in a
 * state no screen will make: another tab's change landing under an open
 * dialog, a card returned for one round. Found through the organizer's club,
 * so it can only ever reach the tournament this run built.
 */
export async function organizerEvent(name) {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ORGANIZER_EMAIL }, select: { id: true } });
    const orgs = (await prisma.organizationMember.findMany({ where: { userId: user.id }, select: { organizationId: true } })).map((m) => m.organizationId);
    return await prisma.event.findFirstOrThrow({
      where: { name, organizationId: { in: orgs } },
      select: { id: true, stages: { select: { id: true, position: true, type: true, format: true, scoringBasis: true, holes: true }, orderBy: { position: "asc" } } },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Writes one round's format as another tab would — see `organizerEvent`. */
export async function setRoundFormat(stageId, format) {
  const prisma = new PrismaClient();
  try {
    await prisma.stage.update({ where: { id: stageId }, data: { format } });
  } finally {
    await prisma.$disconnect();
  }
}

/** A card returned for one round, by an invented, marked player — see `organizerEvent`. */
export async function returnACard(eventId, stageId) {
  const prisma = new PrismaClient();
  try {
    const player = await prisma.player.create({
      data: { eventId, name: "Robin Example", email: `${MARK}-card-${Date.now()}@example.invalid`, handicap: 10, seed: 99, status: "confirmed" },
    });
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: player.id, strokes: JSON.stringify([4, 5, 3, ...new Array(15).fill(null)]) } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedOrganizer() {
  await teardownOrganizer();
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.create({
      data: { email: ORGANIZER_EMAIL, name: "Morgan Starter", password: "x:unusable" },
    });
    await prisma.courseCatalog.create({
      data: {
        id: CATALOGUE_ID,
        name: MEDAL_COURSE,
        city: "Dayton",
        state: "OH",
        country: "US",
        par: PARS.reduce((a, b) => a + b, 0),
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(YARDS),
        strokeIndex: JSON.stringify(SI),
        tees: JSON.stringify([
          { name: "White", gender: "any", courseRating: 72, slopeRating: 113, par: 72, yards: YARDS.reduce((a, b) => a + b, 0) },
        ]),
      },
    });
    return { session: sign(signedInNow(user.id)) };
  } finally {
    await prisma.$disconnect();
  }
}
