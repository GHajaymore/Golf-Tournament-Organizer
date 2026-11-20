import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { MARK as BASE } from "./fixture.mjs";

/**
 * A CLUB CHAMPIONSHIP WHOSE TEES ARE SET BY FLIGHT — the third level of the
 * three the organizer decides (tournament, FLIGHT, one player), which no other
 * fixture put on rows. `flight-tees.audit.test.ts` had its own two-flight,
 * whole-index copy inline; this is the shared one, with a flight that claims
 * no set (it falls to the round's), and DECIMAL indexes.
 *
 * Its own mark inside the suite's, so its teardown cannot reach the shared
 * fixture's rows and the shared teardown still sweeps it if a run dies.
 * Invented names, `@example.invalid` addresses, nothing real.
 *
 * NOBODY HERE HAS A `teeId` — the organizer decides at the flight, and nothing
 * creates a player with a tee of their own (docs/claude/handicaps-and-tees.md).
 * Every tee is par 72 so Rule 6.2b (strokes for a difference in par) is not in
 * play; that is its own cell.
 */
export const FLIGHT_TEES = `${BASE}-flighttees`;
export const FLIGHT_TEES_EVENT = `${FLIGHT_TEES}-Club Championship`;
export const PAR = 72;
export const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
export const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

/** The four sets on the one course. `white` is the round's own default. */
export const TEES = {
  blue: { name: "Championship", courseRating: 74.9, slopeRating: 144, par: PAR },
  senior: { name: "Seniors", courseRating: 72.1, slopeRating: 125, par: PAR },
  red: { name: "Forward", courseRating: 69.5, slopeRating: 118, par: PAR },
  white: { name: "White", courseRating: 72.0, slopeRating: 113, par: PAR },
};

/** Three flights claim a set; "Open" claims none and plays the round's. */
export const FLIGHTS = [
  { key: "champ", name: "Championship", tee: "blue" },
  { key: "senior", name: "Seniors", tee: "senior" },
  { key: "ladies", name: "Forward", tee: "red" },
  { key: "open", name: "Open", tee: null },
];

/**
 * The field, with each index a decimal. `expected` is worked BY HAND from
 * Rules of Handicapping 6.2a (Index x Slope / 113 + (CR - Par), unrounded,
 * THEN the 95% allowance, rounded once — Appendix C), not by any helper:
 *   Ines   8.4 x 144/113 = 10.7044 + 2.9  = 13.6044 -> 14; x .95 = 12.92 -> 13
 *   Kofi  14.7 x 144/113 = 18.7328 + 2.9  = 21.6328 -> 22; x .95 = 20.55 -> 21
 *   Lena  11.3 x 125/113 = 12.5    + 0.1  = 12.6    -> 13; x .95 = 11.97 -> 12
 *   Mara  23.0 x 118/113 = 24.0177 - 2.5  = 21.5177 -> 22; x .95 = 20.44 -> 20
 *   Ravi  17.9 x 113/113 = 17.9    + 0    = 17.9    -> 18; x .95 = 17.005 -> 17
 * Mara is the one a double rounding gets wrong (22 x .95 = 20.9 -> 21).
 */
export const PLAYERS = [
  { key: "ines", name: "Ines Ashdown", index: 8.4, flight: "champ", expected: { course: 14, playing: 13 } },
  { key: "kofi", name: "Kofi Brandt", index: 14.7, flight: "champ", expected: { course: 22, playing: 21 } },
  { key: "lena", name: "Lena Oyelaran", index: 11.3, flight: "senior", expected: { course: 13, playing: 12 } },
  { key: "mara", name: "Mara Quill", index: 23.0, flight: "ladies", expected: { course: 22, playing: 20 } },
  { key: "ravi", name: "Ravi Soto", index: 17.9, flight: "open", expected: { course: 18, playing: 17 } },
];
export const flightTeesEmail = (key) => `${FLIGHT_TEES}-${key}@example.invalid`;

export async function teardownFlightTees() {
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: FLIGHT_TEES } } });
    const courses = await prisma.course.findMany({ where: { name: { startsWith: FLIGHT_TEES } }, select: { id: true } });
    await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: FLIGHT_TEES } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: FLIGHT_TEES } } });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Seed from clean. `teePolicy` is "flight" by default (the organizer's
 * decision at the flight is honoured); pass "one" or "own" to read the same
 * rows under another policy. Returns the event, the round, each tee's id,
 * each flight's id and each player's id.
 */
export async function seedFlightTees({ teePolicy = "flight" } = {}) {
  await teardownFlightTees();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: `${FLIGHT_TEES}-Larch Hill Golf Club`, kind: "club" } });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${FLIGHT_TEES}-Larch Hill`,
        city: "",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(SI),
      },
    });
    const tees = {};
    for (const [position, [key, t]] of Object.entries(TEES).entries()) {
      tees[key] = (await prisma.tee.create({ data: { courseId: course.id, ...t, position } })).id;
    }
    const event = await prisma.event.create({
      data: {
        name: FLIGHT_TEES_EVENT,
        organizationId: org.id,
        dates: "",
        course: course.name,
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${FLIGHT_TEES}-token`,
        courseId: course.id,
        defaultTeeId: tees.white,
        teePolicy,
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });
    const stage = await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, courseId: course.id },
    });

    const flights = {};
    for (const [position, f] of FLIGHTS.entries()) {
      flights[f.key] = (
        await prisma.group.create({
          data: { eventId: event.id, name: f.name, position, teeId: f.tee ? tees[f.tee] : null },
        })
      ).id;
    }
    const players = {};
    for (const [i, p] of PLAYERS.entries()) {
      players[p.key] = (
        await prisma.player.create({
          data: {
            eventId: event.id,
            name: p.name,
            email: flightTeesEmail(p.key),
            handicap: p.index,
            seed: i + 1,
            status: "confirmed",
            groupId: flights[p.flight],
          },
        })
      ).id;
    }
    return { eventId: event.id, stageId: stage.id, tees, flights, players };
  } finally {
    await prisma.$disconnect();
  }
}
