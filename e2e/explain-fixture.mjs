import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A NET MEDAL, PART-WAY ROUND, FOR "EVERY FIGURE EXPLAINS ITSELF" (2026-10-24).
 *
 * For `every-figure-explains-itself.spec.ts`. Its own throwaway club and its
 * own mark — not the shared fixture's, so another session's run cannot take it
 * away mid-walk. Invented names, `.invalid` addresses, deleted in a `finally`.
 *
 * One 18-hole net medal at 95% (the recommendation for individual stroke play,
 * Appendix C), every hole a par 4, off tees rated 72.0 / 113 so a course
 * handicap is the index itself. The stroke index is NOT the hole number, so a
 * dot on the wrong hole is a dot on a hole the spec can name.
 *
 *     Morag Example    index 24.6   the member; holes 1–9 in, the rest to play
 *     Ailsa Fernie     scratch      72: out 37, back 35   ┐ level on E; the
 *     Brodie Halkett   scratch      72: out 35, back 37   ┘ last nine decides it
 *     Calum Strachan   scratch      74, card for card     ┐ level at every step
 *     Dougal Pirnie    scratch      74, the same          ┘ of the countback
 *     Euan Lornie      scratch      70, then disqualified
 */
const TAG = "zz-explain";
export const EXPLAIN_ORG = `${TAG} club`;
export const EXPLAIN_EVENT = `${TAG} Spring Net Medal`;
export const EXPLAIN_TOKEN = `${TAG}-board`;
const ORGANIZER = `${TAG}-sec@example.invalid`;
const MEMBER = `${TAG}-morag@example.invalid`;

export const PAR = 4;
export const HOLES = 18;
/** Stroke index by hole, 1 the hardest. */
export const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
export const RATING = { courseRating: 72, slopeRating: 113, par: 72 };
export const MEMBER_INDEX = 24.6;
export const MEMBER_NAME = "Morag Example";
/** The member's front nine; the back is still to play. */
export const MEMBER_STROKES = [5, 6, 4, 5, 5, 6, 5, 4, 5];

const four = new Array(HOLES).fill(4);
/** One over on the 1st, one under on the 17th: out 37, back 35. */
const ailsa = four.map((s, i) => (i === 0 ? 5 : i === 16 ? 3 : s));
/** One under on the 1st, one over on the 17th: out 35, back 37. */
const brodie = four.map((s, i) => (i === 0 ? 3 : i === 16 ? 5 : s));
/** Two over, the same card twice. */
const calum = four.map((s, i) => (i === 4 || i === 13 ? 5 : s));
export const FIELD = [
  { name: "Ailsa Fernie", strokes: ailsa },
  { name: "Brodie Halkett", strokes: brodie },
  { name: "Calum Strachan", strokes: calum },
  { name: "Dougal Pirnie", strokes: [...calum] },
  { name: "Euan Lornie", strokes: four.map((s, i) => (i < 2 ? 3 : s)), status: "disqualified" },
];

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/** Never anywhere but the development database. */
function refuseAnythingButLocal() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* unreadable: refused below */
  }
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`refusing to seed ${TAG} into a database on ${host || "an unknown host"}`);
}

/** Everything a run left. Safe to call when none of it exists. */
export async function teardownExplain() {
  refuseAnythingButLocal();
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    const courses = await prisma.course.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
    const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Hold the results from everybody but the committee — the control. */
export async function holdResults(eventId) {
  const prisma = new PrismaClient();
  try {
    await prisma.event.update({ where: { id: eventId }, data: { leaderboardVisibility: "staff" } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedExplain() {
  await teardownExplain();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: EXPLAIN_ORG, kind: "club" } });
    const sec = await prisma.user.create({
      data: { email: ORGANIZER, name: "Rhona Secretary", password: "x:unusable", emailVerifiedAt: new Date() },
    });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: sec.id, role: "owner" } });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${TAG} Inverbrae Links`,
        city: "Inverbrae",
        pars: JSON.stringify(new Array(HOLES).fill(PAR)),
        yards: JSON.stringify(new Array(HOLES).fill(380)),
        strokeIndex: JSON.stringify(SI),
      },
    });
    const tee = await prisma.tee.create({ data: { courseId: course.id, name: "Yellow", gender: "any", ...RATING } });
    const event = await prisma.event.create({
      data: {
        name: EXPLAIN_EVENT,
        organizationId: org.id,
        status: "live",
        format: "stroke",
        dates: "",
        course: course.name,
        city: "Inverbrae",
        address: "",
        regDeadline: "",
        shareToken: EXPLAIN_TOKEN,
        leaderboardVisibility: "public",
        scoreEntryBy: "players",
        scoreEntryWindow: "during",
        courseId: course.id,
        defaultTeeId: tee.id,
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });
    await prisma.account.create({ data: { eventId: event.id, name: "Rhona Secretary", email: ORGANIZER, role: "admin" } });
    const round = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: "Stroke Play Round",
        format: "Stroke Play",
        description: "Round 1",
        holes: HOLES,
        scoringBasis: "net",
        courseId: course.id,
      },
    });

    const member = await prisma.player.create({
      data: { eventId: event.id, name: MEMBER_NAME, email: MEMBER, seed: 1, status: "confirmed", handicap: MEMBER_INDEX },
    });
    await prisma.scorecard.create({
      data: {
        eventId: event.id,
        stageId: round.id,
        playerId: member.id,
        strokes: JSON.stringify([...MEMBER_STROKES, ...new Array(HOLES - MEMBER_STROKES.length).fill(null)]),
        status: "entered",
      },
    });
    for (const [i, p] of FIELD.entries()) {
      const row = await prisma.player.create({
        data: {
          eventId: event.id,
          name: p.name,
          email: `${TAG}-p${i + 1}@example.invalid`,
          seed: i + 2,
          status: p.status ?? "confirmed",
          handicap: 0,
        },
      });
      await prisma.scorecard.create({
        data: { eventId: event.id, stageId: round.id, playerId: row.id, strokes: JSON.stringify(p.strokes), status: "certified" },
      });
    }
    const me = await prisma.user.create({
      data: { email: MEMBER, name: MEMBER_NAME, password: "x:unusable", emailVerifiedAt: new Date() },
    });
    await prisma.account.create({ data: { eventId: event.id, name: MEMBER_NAME, email: MEMBER, role: "player" } });
    return { eventId: event.id, roundId: round.id, member: sign(signedInNow(me.id)) };
  } finally {
    await prisma.$disconnect();
  }
}
