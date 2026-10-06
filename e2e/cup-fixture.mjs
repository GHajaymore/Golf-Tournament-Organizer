import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { MARK as BASE } from "./fixture.mjs";

/**
 * A TEAM CUP, LINED UP AND NOT YET PLAYED — the Ryder Cup shape a golf trip or
 * a club v club day runs, walked by `team-cup.spec.ts` as the players play it.
 *
 * Its own mark, inside the suite's, so its teardown cannot reach the shared
 * fixture's rows and the shared teardown still sweeps it if a run dies.
 * Invented names, `@example.invalid` addresses, nothing real.
 *
 * THE COURSE IS RATED SO A COURSE HANDICAP IS THE INDEX — 71.0 / 113 over par
 * 71 — so every stroke on the board can be worked out by hand in the spec.
 */
export const CUP = `${BASE}-cup`;
export const CUP_EVENT = `${CUP}-Autumn Cup — Blues v Whites`;
export const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
export const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const PAR = PARS.reduce((a, b) => a + b, 0);

/** The two teams, in board order, and the eight players with their indexes. */
export const TEAMS = [
  {
    name: "Blues",
    players: [
      { key: "a1", name: "Ailsa Blue", index: 2 },
      { key: "a2", name: "Bram Blue", index: 4 },
      { key: "a3", name: "Cora Blue", index: 6 },
      { key: "a4", name: "Dev Blue", index: 10 },
    ],
  },
  {
    name: "Whites",
    players: [
      { key: "b1", name: "Edda White", index: 8 },
      { key: "b2", name: "Finn White", index: 12 },
      { key: "b3", name: "Gwen White", index: 14 },
      { key: "b4", name: "Hal White", index: 18 },
    ],
  },
];
export const SESSIONS = [
  { key: "fourball", description: "Saturday four-balls", format: "Four-Ball" },
  { key: "foursomes", description: "Saturday foursomes", format: "Foursomes" },
  { key: "singles", description: "Sunday singles", format: "Match Play" },
];
export const cupEmail = (key) => `${CUP}-${key}@example.invalid`;

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

export async function teardownCup() {
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: CUP } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: CUP } } });
    const courses = await prisma.course.findMany({ where: { name: { startsWith: CUP } }, select: { id: true } });
    await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: CUP } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: CUP } } });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Seed from clean. Returns the share token, each session's id, each player's
 * id, and a signed session for the organizer and for every player — the
 * cookie pair the app reads (`ng_session`, `ng_active_event`).
 */
export async function seedCup() {
  await teardownCup();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: `${CUP}-Blue Ash Golf Society`, kind: "society" } });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${CUP}-Château Bushwood — Old Course`,
        city: "Cincinnati, OH",
        pars: JSON.stringify(PARS),
        yards: "[]",
        strokeIndex: JSON.stringify(SI),
      },
    });
    await prisma.tee.create({
      data: { courseId: course.id, name: "White", courseRating: PAR, slopeRating: 113, par: PAR },
    });
    const event = await prisma.event.create({
      data: {
        name: CUP_EVENT,
        organizationId: org.id,
        status: "live",
        shape: "single",
        format: "match",
        dates: "October 2026",
        course: course.name,
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        shareToken: `${CUP}-token`,
        leaderboardVisibility: "public",
        // The template's own settings: the players keep their own scores.
        scoreEntryBy: "players",
        scoreEntryWindow: "during",
        scoreApproval: "players",
        courseId: course.id,
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });

    const sessions = {};
    for (const [position, s] of SESSIONS.entries()) {
      const stage = await prisma.stage.create({
        data: {
          eventId: event.id,
          position,
          type: "Team Session",
          format: s.format,
          description: s.description,
          holes: 18,
          scoringBasis: "net",
          courseId: course.id,
        },
      });
      sessions[s.key] = stage.id;
    }

    const players = {};
    const cookies = {};
    let seed = 0;
    for (const [position, team] of TEAMS.entries()) {
      const flight = await prisma.group.create({ data: { eventId: event.id, name: team.name, position } });
      for (const p of team.players) {
        const row = await prisma.player.create({
          data: {
            eventId: event.id,
            name: p.name,
            email: cupEmail(p.key),
            handicap: p.index,
            seed: ++seed,
            status: "confirmed",
            groupId: flight.id,
          },
        });
        players[p.key] = row.id;
        const user = await prisma.user.create({ data: { email: cupEmail(p.key), name: p.name, password: "x:unusable" } });
        await prisma.account.create({ data: { eventId: event.id, name: p.name, email: user.email, role: "player" } });
        cookies[p.key] = { session: sign(user.id), event: sign(event.id) };
      }
      if (position === 0) await prisma.group.update({ where: { id: flight.id }, data: { captainId: players.a1 } });
      else await prisma.group.update({ where: { id: flight.id }, data: { captainId: players.b1 } });
    }

    const organizer = await prisma.user.create({
      data: { email: cupEmail("organizer"), name: "O. Ganizer", password: "x:unusable" },
    });
    await prisma.account.create({ data: { eventId: event.id, name: "O. Ganizer", email: organizer.email, role: "admin" } });
    cookies.organizer = { session: sign(organizer.id), event: sign(event.id) };

    return { eventId: event.id, shareToken: event.shareToken, sessions, players, cookies };
  } finally {
    await prisma.$disconnect();
  }
}
