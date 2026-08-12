import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

/**
 * The tournament the end-to-end tests run against.
 *
 * Marked `zz-e2e` and torn down in global teardown, following the same rule as
 * every other fixture in this repo: invented names, `@example.invalid`
 * addresses, and never a row that could be mistaken for a real member. The
 * suite must be safe to run against a developer database that also holds real
 * tournaments.
 *
 * Shaped to exercise the things that keep breaking rather than a happy path:
 * a drawn tee sheet, a part-finished card, a card in each approval state, and
 * a course with local rules.
 */

export const MARK = "zz-e2e";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 405];

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/**
 * A calendar day N days from today, as the yyyy-mm-dd the app stores.
 *
 * Relative rather than fixed, because the availability card's whole job is to
 * split the season around *today*: hard-coded dates would quietly stop
 * exercising the split the moment they all fell into the past.
 */
const dayOffset = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export async function teardown() {
  const prisma = new PrismaClient();
  try {
    const events = await prisma.event.findMany({
      where: { name: { startsWith: MARK } },
      select: { id: true },
    });
    const ids = events.map((e) => e.id);
    if (ids.length) {
      for (const model of ["scorecard", "match", "player", "stage", "account", "eventCourse"]) {
        await prisma[model].deleteMany({ where: { eventId: { in: ids } } }).catch(() => {});
      }
    }
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seed() {
  // Always from clean: a half-torn-down run from last time would otherwise
  // make the next one fail for reasons that have nothing to do with the code.
  await teardown();

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({
      data: { name: `${MARK}-GC`, kind: "club", themeAppearance: "auto" },
    });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${MARK}-Bushwood`,
        city: "Cincinnati, OH",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(YARDS),
        strokeIndex: JSON.stringify(SI),
        localRules: "Internal out of bounds: left of the 4th, defined by white stakes.",
      },
    });
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-Championship`,
        organizationId: org.id,
        status: "active",
        shape: "single",
        format: "stroke",
        dates: "May 2026",
        course: "Bushwood",
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        sideStyle: "individual",
        shareToken: `${MARK}-token`,
        // Published, so the /live page renders a board rather than a 404. The
        // first run of this suite missed it, and the spec that checks the
        // public leaderboard "passed" against a not-found page — a 404 has no
        // horizontal overflow either.
        leaderboardVisibility: "public",
        customPars: JSON.stringify(PARS),
        customYards: JSON.stringify(YARDS),
        customStrokeIndex: JSON.stringify(SI),
        tiebreakers: JSON.stringify(["toughest-6", "toughest-3", "lower-handicap"]),
        // A weekly league, so the availability card renders at all. With the
        // default "everyone" there is no question to ask and the whole feature
        // is invisible to the suite.
        attendanceMode: "opt-out",
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });

    const names = ["Aj Moore", "Marcus Webb", "Priya Nair", "Sang-woo Kim"];
    const players = [];
    for (const [i, name] of names.entries()) {
      players.push(
        await prisma.player.create({
          data: {
            eventId: event.id,
            name,
            email: `${MARK}-${i}@example.invalid`,
            handicap: 4 + i * 4,
            seed: i + 1,
            status: "confirmed",
          },
        }),
      );
    }

    const teeSheet = JSON.stringify({
      savedAt: new Date().toISOString(),
      startType: "tee",
      groups: [{ name: "Group 1", startHole: 1, time: "08:10", playerIds: players.map((p) => p.id) }],
    });
    // Three earlier weeks, straddling today: one already played, one imminent
    // (the "next round" the availability card must lift out and emphasise) and
    // one beyond it. Dates are relative to the day the suite runs, so the split
    // around today stays real however long this fixture lives.
    for (const [i, offset] of [-7, 3, 10].entries()) {
      await prisma.stage.create({
        data: {
          eventId: event.id,
          position: i,
          description: `Round ${i + 1}`,
          type: "Stroke Play Round",
          format: "Individual Stroke Play",
          holes: 18,
          scoringBasis: "net",
          handicapAllowance: 95,
          playedOn: dayOffset(offset),
          optDeadline: dayOffset(offset - 1),
        },
      });
    }

    /**
     * The round the play screens open on — deliberately LAST.
     *
     * loadEventState picks the active stage as the final playing round when a
     * tournament has no Round Robin stages, so the round carrying the tee sheet
     * and the part-finished card has to be the last one or /me opens on an
     * empty week. Adding league rounds after it is what broke the card specs
     * the first time.
     *
     * (That rule is worth revisiting on its own: for a multi-week league the
     * round being played is the next unplayed one, not the last on the
     * calendar. Out of scope here, and it needs its own change.)
     */
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 3,
        description: "Round 4",
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        holes: 18,
        scoringBasis: "net",
        handicapAllowance: 95,
        teeSheet,
        playedOn: dayOffset(17),
        optDeadline: dayOffset(16),
      },
    });

    // One card per approval state, plus the part-finished one that the card
    // screen must open on rather than blanking.
    const full = PARS.map((p) => p);
    const partial = PARS.map((p, i) => (i < 9 ? p : null));
    const states = [
      { player: players[0], strokes: partial, status: "entered" },
      { player: players[1], strokes: full, status: "certified" },
      { player: players[2], strokes: full, status: "approved" },
      { player: players[3], strokes: full, status: "disputed" },
    ];
    for (const s of states) {
      await prisma.scorecard.create({
        data: {
          eventId: event.id,
          stageId: stage.id,
          playerId: s.player.id,
          strokes: JSON.stringify(s.strokes),
          status: s.status,
        },
      });
    }

    // Two accounts: the organizer, and a player who is players[0] — matched by
    // email, which is how the app resolves "me".
    const organizer = await prisma.user.create({
      data: { email: `${MARK}-organizer@example.invalid`, name: "O. Ganizer", password: "x:unusable" },
    });
    await prisma.account.create({
      data: { eventId: event.id, name: "O. Ganizer", email: organizer.email, role: "admin" },
    });
    const player = await prisma.user.create({
      data: { email: `${MARK}-0@example.invalid`, name: "Aj Moore", password: "x:unusable" },
    });
    await prisma.account.create({
      data: { eventId: event.id, name: "Aj Moore", email: player.email, role: "player" },
    });

    return {
      eventId: event.id,
      shareToken: event.shareToken,
      organizer: { session: sign(organizer.id), event: sign(event.id) },
      player: { session: sign(player.id), event: sign(event.id) },
      partialHolesFilled: partial.filter((s) => s != null).length,
    };
  } finally {
    await prisma.$disconnect();
  }
}
