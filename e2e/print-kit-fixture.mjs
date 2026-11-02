import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomInt } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { runMark } from "../scripts/run-mark.mjs";

/**
 * THE PRINT KIT'S OWN CLUB (2026-10-23): two invented tournaments shaped like
 * the paper a secretary actually prints.
 *
 *   a team cup of twenty — ten a side, singles on the front nine and four-balls
 *     on the back, both sessions on one day, the shape of the owner's own cup;
 *   a Stableford of twelve off a SHOTGUN, so every group starts on a different
 *     hole: with a lady on the red tees, a plus handicap, a 54, a member whose
 *     index nobody has claimed, and a name of fifty-nine characters.
 *
 * Its own mark (`zz-print`, per worktree through `runMark`), outside the shared
 * e2e fixture's, so its teardown cannot reach another run's rows. Invented
 * names, `@example.invalid` addresses, nothing real. Delete with `teardownPrint`.
 */
export const MARK = runMark("zz-print");
export const CLUB = `${MARK}-Rowan Vale Golf Club`;
export const CUP_EVENT = `${MARK}-Autumn Cup — Larches v Rowans`;
export const SF_EVENT = `${MARK}-Captain’s Stableford`;
/** Fifty-nine characters, and a hyphen to break at. */
export const LONG_NAME = "Wilhelmina Fotheringay-Pemberton-Ashcombe of Lower Hadleigh";

export const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
export const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
export const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 405];
const PAR = PARS.reduce((a, b) => a + b, 0);

const FIRST = ["Ailsa", "Bram", "Cora", "Dev", "Edda", "Finn", "Gwen", "Hal", "Iona", "Jory", "Kit", "Lark", "Mabel", "Nico", "Orla", "Pip", "Quill", "Rory", "Sable", "Tam"];
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};
const email = (key) => `${MARK}-${key}@example.invalid`;

/** Today at the club, as the yyyy-mm-dd a round stores. */
function clubToday(zone) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}

async function freshCode(prisma) {
  for (;;) {
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if ((await prisma.stage.count({ where: { accessCode: code } })) === 0) return code;
  }
}

export async function teardownPrint() {
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    const courses = await prisma.course.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
    await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Seed from clean. `sfField` sizes the Stableford (12 by default; the browser
 * spec walks other sizes with it). Returns ids, the round codes and a signed
 * organizer session for each tournament.
 */
export async function seedPrint({ sfField = 12, zone = process.env.E2E_TZ || "Europe/London" } = {}) {
  await teardownPrint();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: CLUB, kind: "club", country: "GB", timeZone: zone } });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${MARK}-Rowan Vale — Old Course`,
        city: "",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(YARDS),
        strokeIndex: JSON.stringify(SI),
      },
    });
    const white = await prisma.tee.create({ data: { courseId: course.id, name: "White", courseRating: 71.3, slopeRating: 128, par: PAR, position: 0 } });
    const red = await prisma.tee.create({
      data: { courseId: course.id, name: "Red", gender: "female", courseRating: 73.4, slopeRating: 126, par: PAR + 1, position: 1 },
    });
    const organizer = await prisma.user.create({ data: { email: email("secretary"), name: "S. Ecretary", password: "x:unusable" } });
    const today = clubToday(zone);

    const event = async (name, extra) => {
      const e = await prisma.event.create({
        data: {
          name,
          organizationId: org.id,
          status: "live",
          dates: "",
          course: course.name,
          city: "",
          address: "",
          regDeadline: "",
          shareToken: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
          leaderboardVisibility: "public",
          playerAccess: "both",
          scoreEntryBy: "players",
          courseId: course.id,
          defaultTeeId: white.id,
          ...extra,
        },
      });
      await prisma.eventCourse.create({ data: { eventId: e.id, courseId: course.id } });
      await prisma.account.create({ data: { eventId: e.id, name: "S. Ecretary", email: organizer.email, role: "admin" } });
      return e;
    };
    const player = (eventId, i, data) =>
      prisma.player.create({ data: { eventId, email: email(`${eventId.slice(-5)}-${i}`), seed: i + 1, status: "confirmed", ...data } });
    const sheet = (groups, startType = "tee") => JSON.stringify({ savedAt: new Date().toISOString(), startType, groups });

    /* ── The cup ──────────────────────────────────────────────────────── */
    const cup = await event(CUP_EVENT, { shape: "series", format: "match" });
    const larches = await prisma.group.create({ data: { eventId: cup.id, name: "Larches", position: 0 } });
    const rowans = await prisma.group.create({ data: { eventId: cup.id, name: "Rowans", position: 1 } });
    const L = [];
    const R = [];
    for (let i = 0; i < 20; i++) {
      const left = i < 10;
      const p = await player(cup.id, i, {
        name: `${FIRST[i]} ${left ? "Larch" : "Rowan"}`,
        handicap: [2.4, 5.1, 8.7, 11.2, 13.9, 16.3, 18.8, 21.4, 24.0, 27.6][i % 10] + (left ? 0 : 0.6),
        groupId: left ? larches.id : rowans.id,
      });
      (left ? L : R).push(p);
    }
    const singles = await prisma.stage.create({
      data: {
        eventId: cup.id, position: 0, type: "Team Session", format: "Match Play", description: "Singles — front nine",
        holes: 9, nine: "front", scoringBasis: "net", courseId: course.id, playedOn: today, accessCode: await freshCode(prisma), lineupPublished: true,
      },
    });
    const fourball = await prisma.stage.create({
      data: {
        eventId: cup.id, position: 1, type: "Team Session", format: "Four-Ball", description: "Four-balls — back nine",
        holes: 9, nine: "back", scoringBasis: "net", handicapAllowance: 90, courseId: course.id, playedOn: today, accessCode: await freshCode(prisma), lineupPublished: true,
      },
    });
    const carrier = async (stage) =>
      prisma.group.create({ data: { eventId: cup.id, stageId: stage.id, isCarrier: true, name: `${stage.format} — cup session`, position: 10 + stage.position } });
    const cs = await carrier(singles);
    const cf = await carrier(fourball);
    let round = 0;
    const groups = [];
    for (let g = 0; g < 5; g++) {
      const [a1, a2, b1, b2] = [L[2 * g], L[2 * g + 1], R[2 * g], R[2 * g + 1]];
      const side = (ps, flight) =>
        prisma.team.create({
          data: { eventId: cup.id, stageId: fourball.id, name: ps.map((p) => p.name.split(" ")[0]).join(" & "), clubGroupId: flight.id, members: { create: ps.map((p, position) => ({ playerId: p.id, position })) } },
        });
      const ta = await side([a1, a2], larches);
      const tb = await side([b1, b2], rowans);
      await prisma.match.create({ data: { eventId: cup.id, stageId: fourball.id, groupId: cf.id, round: ++round, playerAId: "", playerBId: "", teamAId: ta.id, teamBId: tb.id } });
      for (const [x, y] of [[a1, b1], [a2, b2]]) {
        await prisma.match.create({ data: { eventId: cup.id, stageId: singles.id, groupId: cs.id, round: ++round, playerAId: x.id, playerBId: y.id } });
      }
      groups.push({ name: `Group ${g + 1}`, startHole: 1, time: `8:${String(g * 10).padStart(2, "0")} AM`, playerIds: [a1.id, b1.id, a2.id, b2.id] });
    }
    for (const s of [singles, fourball]) {
      await prisma.stage.update({ where: { id: s.id }, data: { teeSheet: sheet(groups), teeSheetPublished: true } });
    }

    /* ── The Stableford, off a shotgun ───────────────────────────────── */
    const sf = await event(SF_EVENT, { shape: "single", format: "stroke" });
    const stage = await prisma.stage.create({
      data: {
        eventId: sf.id, position: 0, type: "Stroke Play Round", format: "Stableford", holes: 18, scoringBasis: "net",
        courseId: course.id, playedOn: today, accessCode: await freshCode(prisma),
      },
    });
    const sfPlayers = [];
    for (let i = 0; i < sfField; i++) {
      const special =
        i === 0 ? { name: LONG_NAME, handicap: 17.3 }
        : i === 1 ? { name: "Hettie Marsh", handicap: 22.6, gender: "female" }
        : i === 2 ? { name: "Ozzie Plus", handicap: -2.1 }
        : i === 3 ? { name: "Bertie Fiftyfour", handicap: 54 }
        : i === 4 ? { name: "Unity Unclaimed", handicap: 0, handicapSource: "none" }
        : { name: `${FIRST[i % FIRST.length]} ${["Ashdown", "Brackley", "Cowdray", "Denholm", "Elstree"][i % 5]}${i >= 20 ? ` ${i}` : ""}`, handicap: (i * 3.7) % 36 };
      sfPlayers.push(await player(sf.id, i, special));
    }
    // A shotgun: every group off a different hole, all at nine o'clock, in threes.
    const shotgun = [];
    for (let i = 0, g = 0; i < sfPlayers.length; i += 3, g++) {
      shotgun.push({ name: `Group ${g + 1}`, startHole: ((g * 2) % 18) + 1, half: g >= 9 ? (g % 2 ? "B" : "A") : undefined, time: "9:00 AM", playerIds: sfPlayers.slice(i, i + 3).map((p) => p.id) });
    }
    await prisma.stage.update({ where: { id: stage.id }, data: { teeSheet: sheet(shotgun, "shotgun"), teeSheetPublished: true } });

    return {
      zone,
      orgId: org.id,
      cup: { eventId: cup.id, singles: singles.id, fourball: fourball.id, codes: [singles.accessCode, fourball.accessCode], players: [...L, ...R].map((p) => ({ id: p.id, name: p.name })) },
      sf: { eventId: sf.id, stageId: stage.id, code: stage.accessCode, groups: shotgun.length, players: sfPlayers.map((p) => ({ id: p.id, name: p.name })) },
      cookies: {
        cup: { session: sign(signedInNow(organizer.id)), event: sign(cup.id) },
        sf: { session: sign(signedInNow(organizer.id)), event: sign(sf.id) },
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}
