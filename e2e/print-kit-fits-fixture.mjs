import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomInt } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { runMark } from "../scripts/run-mark.mjs";

/**
 * THE FITS FIXTURE (panel ruling of 30 Oct 2026, 3.5): every shape a card can be
 * asked to hold, at its hardest, so the browser test measures the worst case.
 *
 *   a 60-character club name with no logo, an 80-character event name;
 *   18 holes and a 9-hole back nine off a shotgun;
 *   groups of 2, 3 and 4 and one of 5 (X2 as a group card);
 *   one, two and three sets of tees in one group;
 *   a 59-character name and a hyphenated double surname, a plus handicap and a
 *   member whose index is "to be confirmed";
 *   individual stroke play, Stableford, four-ball per side, a scramble of four
 *   long names, foursomes, a singles match (the slip), a cup four-ball over all
 *   18, and a cup mixed day (X1) whose signs carry two round codes.
 *
 * Its own mark, `zz-print-fits` (per worktree through `runMark`), invented names,
 * `@example.invalid` addresses. Deleted with `teardownFits`, in the spec's finally.
 */
export const MARK = runMark("zz-print-fits");
/** Sixty characters, no logo. */
export const CLUB = `${MARK} Royal Ancient Rowan Vale & Larchmont Downs Golf and Country Club`.slice(0, 60 + MARK.length + 1);
/** Eighty characters. */
export const EVENT = "The Inaugural Rowan Vale Autumn Foursomes, Four-Ball and Singles Championship Day";
export const LONG_NAME = "Wilhelmina Fotheringay-Pemberton-Ashcombe of Lower Hadleigh";
export const DOUBLE = "Bartholomew Featherstonehaugh-Worthington";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 405];
const PAR = PARS.reduce((a, b) => a + b, 0);
const FIRST = ["Ailsa", "Bram", "Cora", "Dev", "Edda", "Finn", "Gwen", "Hal", "Iona", "Jory", "Kit", "Lark", "Mabel", "Nico", "Orla", "Pip"];
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";

const sign = (v) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const email = (key) => `${MARK}-${key}@example.invalid`;

async function freshCode(prisma) {
  for (;;) {
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if ((await prisma.stage.count({ where: { accessCode: code } })) === 0) return code;
  }
}

export async function teardownFits() {
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

export async function seedFits() {
  await teardownFits();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: CLUB, kind: "club", country: "US", timeZone: "America/New_York" } });
    const course = await prisma.course.create({
      data: { organizationId: org.id, name: `${MARK} Rowan Vale Old`, city: "", pars: JSON.stringify(PARS), yards: JSON.stringify(YARDS), strokeIndex: JSON.stringify(SI) },
    });
    const white = await prisma.tee.create({ data: { courseId: course.id, name: "White", courseRating: 71.3, slopeRating: 128, par: PAR, position: 0 } });
    const red = await prisma.tee.create({ data: { courseId: course.id, name: "Red", gender: "female", courseRating: 73.4, slopeRating: 126, par: PAR + 1, position: 1 } });
    const blue = await prisma.tee.create({ data: { courseId: course.id, name: "Blue", courseRating: 73.9, slopeRating: 134, par: PAR, position: 2 } });
    const organizer = await prisma.user.create({ data: { email: email("secretary"), name: "S. Ecretary", password: "x:unusable", emailVerifiedAt: new Date() } });
    const events = {};
    let codeN = 0;

    const event = async (key, extra = {}) => {
      const e = await prisma.event.create({
        data: {
          // Each its own key at the front, at the same long length: two of one name may not be in
          // play in one club (migration A036, `domain/tournament-name.ts`).
          name: `${MARK} ${key} ${EVENT}`.slice(0, MARK.length + 1 + 80),
          organizationId: org.id, status: "live", dates: "", course: course.name, city: "", address: "", regDeadline: "",
          shareToken: `${MARK}-${key}-${Math.random().toString(36).slice(2, 10)}`,
          leaderboardVisibility: "public", playerAccess: "both", scoreEntryBy: "players",
          courseId: course.id, defaultTeeId: white.id, shape: "series", format: "stroke", ...extra,
        },
      });
      await prisma.eventCourse.create({ data: { eventId: e.id, courseId: course.id } });
      await prisma.account.create({ data: { eventId: e.id, name: "S. Ecretary", email: organizer.email, role: "admin" } });
      events[key] = { eventId: e.id, rounds: {}, cookie: { session: sign(signedInNow(organizer.id)), event: sign(e.id) } };
      return e;
    };
    const people = async (eventId, specs) => {
      const out = [];
      for (const [i, s] of specs.entries()) {
        out.push(await prisma.player.create({ data: { eventId, email: email(`${eventId.slice(-6)}-${i}`), seed: i + 1, status: "confirmed", handicap: 12, ...s } }));
      }
      return out;
    };
    const sheet = (groups, startType = "tee") => JSON.stringify({ savedAt: new Date().toISOString(), startType, groups });
    const groupsOf = (players, sizes, startType = "tee") => {
      const out = [];
      let at = 0;
      sizes.forEach((n, g) => {
        out.push({ name: `Group ${g + 1}`, startHole: startType === "shotgun" ? ((g * 2) % 9) + 1 : 1, time: `8:${String(g * 10).padStart(2, "0")} AM`, playerIds: players.slice(at, at + n).map((p) => p.id) });
        at += n;
      });
      return sheet(out, startType);
    };
    const round = async (eventId, key, data, groups) => {
      const s = await prisma.stage.create({
        data: { eventId, holes: 18, scoringBasis: "net", courseId: course.id, accessCode: await freshCode(prisma), teeSheetPublished: true, teeSheet: groups ?? "", ...data },
      });
      codeN += 1;
      return s;
    };

    /* ── Individual: stroke play 18 and a Stableford back nine off a shotgun ── */
    const ind = await event("individual");
    const field = await people(ind.id, [
      { name: LONG_NAME, handicap: 17.3 },
      { name: DOUBLE, handicap: 8.4, teeId: blue.id },
      { name: "Hettie Marsh", handicap: 22.6, gender: "female" },
      { name: "Ozzie Plus", handicap: -2.1 },
      { name: "Unity Unclaimed", handicap: 0, handicapSource: "none" },
      ...FIRST.slice(0, 9).map((f, i) => ({ name: `${f} Ashdown-Brackley`, handicap: (i * 4.7) % 36 })),
    ]);
    // Groups of 3 (three sets of tees: White, Blue, Red), 2, 4 and 5.
    const sizes = [3, 2, 4, 5];
    const s1 = await round(ind.id, "medal", { position: 0, type: "Stroke Play Round", format: "Stroke Play" }, groupsOf(field, sizes));
    const s2 = await round(ind.id, "stableford", { position: 1, type: "Stroke Play Round", format: "Stableford", holes: 9, nine: "back" }, groupsOf(field, sizes, "shotgun"));
    events.individual.rounds = { medal: s1.id, stableford: s2.id };
    events.individual.groupOfFive = "Group 4";

    /* ── Four-ball, scramble, foursomes: one card per side ── */
    const sides = async (key, format, sideSize, names) => {
      const e = await event(key);
      const ps = await people(e.id, names.map((name, i) => ({ name, handicap: 4 + ((i * 5.3) % 28) })));
      const groups = [];
      for (let i = 0; i < ps.length; i += 4) groups.push(4);
      const s = await round(e.id, key, { position: 0, type: "Stroke Play Round", format }, groupsOf(ps, groups));
      for (let i = 0; i < ps.length; i += sideSize) {
        const members = ps.slice(i, i + sideSize);
        await prisma.team.create({
          data: { eventId: e.id, stageId: s.id, name: members.map((m) => m.name.split(" ")[0]).join(" & "), members: { create: members.map((m, position) => ({ playerId: m.id, position })) } },
        });
      }
      events[key].rounds = { [key]: s.id };
    };
    await sides("fourball", "Four-Ball", 2, [LONG_NAME, "Hal Hope", DOUBLE, "Iona Ince", "Jory Jute", "Kit Kemp", "Lark Lowe", "Mabel Moss"]);
    await sides("scramble", "Scramble", 4, [LONG_NAME, DOUBLE, "Maximiliana Rosencrantz-Guildenstern", "Fitzwilliam Darcy-Pemberley", "Ann A", "Bo B", "Cy C", "Di D"]);
    await sides("foursomes", "Foursomes", 2, ["Ann Avon", "Bo Bure", "Cy Cam", "Di Dee"]);

    /* ── A singles match: the result slip ── */
    {
      const e = await event("singles", { format: "match" });
      const ps = await people(e.id, [{ name: LONG_NAME, handicap: 14 }, { name: DOUBLE, handicap: 6 }, { name: "Ann Avon", handicap: 9 }, { name: "Bo Bure", handicap: 20 }]);
      const s = await round(e.id, "singles", { position: 0, type: "Single Match Stage", format: "Match Play" }, groupsOf(ps, [4]));
      const g = await prisma.group.create({ data: { eventId: e.id, stageId: s.id, isCarrier: true, name: "Singles", position: 10 } });
      await prisma.match.create({ data: { eventId: e.id, stageId: s.id, groupId: g.id, round: 1, playerAId: ps[0].id, playerBId: ps[1].id, teamAId: "", teamBId: "" } });
      await prisma.match.create({ data: { eventId: e.id, stageId: s.id, groupId: g.id, round: 2, playerAId: ps[2].id, playerBId: ps[3].id, teamAId: "", teamBId: "" } });
      events.singles.rounds = { singles: s.id };
    }

    /* ── Cups: four-ball over all 18, and the mixed day (X1) with two codes ── */
    const cup = async (key, sessions) => {
      const e = await event(key, { format: "match" });
      const larches = await prisma.group.create({ data: { eventId: e.id, name: "Larches", position: 0 } });
      const rowans = await prisma.group.create({ data: { eventId: e.id, name: "Rowans", position: 1 } });
      const L = await people(e.id, FIRST.slice(0, 4).map((f, i) => ({ name: i === 0 ? LONG_NAME : `${f} Larch`, handicap: 3 + i * 6, groupId: larches.id })));
      const R = await people(e.id, FIRST.slice(4, 8).map((f, i) => ({ name: i === 0 ? DOUBLE : `${f} Rowan`, handicap: 5 + i * 6, groupId: rowans.id })));
      const groups = [
        { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [L[0].id, R[0].id, L[1].id, R[1].id] },
        { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [L[2].id, R[2].id, L[3].id, R[3].id] },
      ];
      const ids = {};
      for (const [pos, s] of sessions.entries()) {
        const st = await round(e.id, s.key, { position: pos, type: "Team Session", description: s.name, format: s.format, holes: s.holes, nine: s.nine ?? "full", handicapAllowance: s.format === "Four-Ball" ? 90 : 100, lineupPublished: true, playedOn: "2026-11-29" }, sheet(groups));
        const carrier = await prisma.group.create({ data: { eventId: e.id, stageId: st.id, isCarrier: true, name: `${s.format} — cup session`, position: 10 + pos } });
        let n = 0;
        for (let g = 0; g < 2; g++) {
          const [a1, a2, b1, b2] = [L[2 * g], L[2 * g + 1], R[2 * g], R[2 * g + 1]];
          if (s.format === "Four-Ball") {
            const side = (ps, flight) =>
              prisma.team.create({ data: { eventId: e.id, stageId: st.id, name: ps.map((p) => p.name.split(" ")[0]).join(" & "), clubGroupId: flight.id, members: { create: ps.map((p, position) => ({ playerId: p.id, position })) } } });
            const ta = await side([a1, a2], larches);
            const tb = await side([b1, b2], rowans);
            await prisma.match.create({ data: { eventId: e.id, stageId: st.id, groupId: carrier.id, round: ++n, playerAId: "", playerBId: "", teamAId: ta.id, teamBId: tb.id } });
          } else {
            for (const [x, y] of [[a1, b1], [a2, b2]]) {
              await prisma.match.create({ data: { eventId: e.id, stageId: st.id, groupId: carrier.id, round: ++n, playerAId: x.id, playerBId: y.id, teamAId: "", teamBId: "" } });
            }
          }
        }
        ids[s.key] = st.id;
      }
      events[key].rounds = ids;
    };
    await cup("cup18", [{ key: "fourball18", name: "Four-balls", format: "Four-Ball", holes: 18 }]);
    await cup("cupmixed", [
      { key: "singles", name: "Singles — front nine", format: "Match Play", holes: 9, nine: "front" },
      { key: "fourball", name: "Four-balls — back nine", format: "Four-Ball", holes: 9, nine: "back" },
    ]);
    return { orgId: org.id, events };
  } finally {
    await prisma.$disconnect();
  }
}
