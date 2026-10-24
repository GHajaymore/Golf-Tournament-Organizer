import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * ONE MEMBER'S SEASON, WITH EVERY STATE THE PAGE HAS TO SAY (2026-10-24) — read
 * by `e2e/my-season.spec.ts` in a browser and by
 * `src/lib/__tests__/my-season-reads-the-boards.audit.test.ts` against the
 * database. A fixture that cannot reach a state checks nothing, so it holds
 * them all.
 *
 * The club's season is a window around today — opened sixty days ago, closing
 * in sixty — so the same fixture is "this season" on any day of the year, and
 * a tournament ninety days back is LAST season.
 *
 * Fenella is the member whose season is read. Oswin plays beside her and is the
 * control: none of his places, figures or prizes may reach her page.
 *
 *   course    par 4 at every hole (72), stroke index 1..18
 *
 *   Spring Medal       net medal, done, public. Oswin 70 (h/c 4); Fenella and
 *                      Pip 78 off 10, the same card, so they SHARE second; Rook
 *                      80 off 2. Fenella wins "Best net" ($25); Oswin "Winner"
 *                      ($50) and the nearest the pin — neither is hers.
 *   Summer Stableford  Stableford, done, public. Fenella 76 (bogeys 1–4), Oswin
 *                      80. Fenella is the confirmed champion and won the longest
 *                      drive. Pip MISSED it — not entered.
 *   Pairs Better Ball  best ball, gross, done, public. Fenella & Ula against
 *                      Oswin & Rook: Ula's birdies on 1–6 make their side 66,
 *                      lower than any card of Fenella's own, so a side's figure
 *                      leaking into her bests would show.
 *   Committee Shield   scored by hand: she has a card, and no place.
 *   Autumn Open        done, results HELD from the players (staff only). Her
 *                      best card of all, 70, and a $40 prize: both must stay hidden.
 *   Winter Cup         entered, a round set, nothing played yet.
 *   Members' Foursomes on the waiting list.
 *   Captain's Prize    she did not enter; Oswin did, and won it.
 *   Last Season Medal  ninety days ago: last season, so not on this one.
 *
 * Invented names, `@example.invalid` addresses, every row under `mark`; the
 * teardown takes all of it.
 */

const PARS = new Array(18).fill(4);

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/** Today at the club, yyyy-mm-dd — the club's zone when the run gives one (`E2E_TZ`). */
function clubToday(zone) {
  if (!zone) {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A day `n` days from `today`, yyyy-mm-dd, counted on the calendar alone. */
function dayFrom(today, n) {
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Eighteen 4s with some holes changed: `{ 1: 3 }` is a birdie on the 1st. */
const card = (changes = {}) => JSON.stringify(PARS.map((p, i) => changes[i + 1] ?? p));
const bogeys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 5]));
const birdies = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 3]));

export const PEOPLE = {
  fenella: "Fenella Quist",
  oswin: "Oswin Brack",
  pip: "Pip Harrow",
  rook: "Rook Tallis",
  ula: "Ula Penrose",
  stranger: "Thaddeus Vole",
};

export async function teardownMySeason(mark) {
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany({ where: { name: { startsWith: mark } }, select: { id: true } });
    const orgIds = orgs.map((o) => o.id);
    await prisma.honoursEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.event.deleteMany({ where: { name: { startsWith: mark } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedMySeason(mark) {
  await teardownMySeason(mark);
  const prisma = new PrismaClient();
  try {
    const zone = process.env.E2E_TZ ?? "";
    const today = clubToday(zone);
    const mmdd = (iso) => iso.slice(5);
    const opened = dayFrom(today, -60);
    const org = await prisma.organization.create({
      data: {
        name: `${mark} Golf Club`,
        kind: "club",
        timeZone: zone,
        seasonStartsOn: mmdd(opened),
        seasonEndsOn: mmdd(dayFrom(today, 60)),
      },
    });

    const email = (who) => `${mark}-${who}@example.invalid`;
    const users = {};
    for (const who of ["fenella", "oswin", "stranger"]) {
      users[who] = await prisma.user.create({ data: { email: email(who), name: PEOPLE[who], password: "x:unusable" } });
      await prisma.organizationMember.create({ data: { organizationId: org.id, userId: users[who].id, role: "member" } });
    }

    const events = {};
    const players = {};
    const stages = {};

    async function event(key, title, { offset, status = "completed", visibility = "public", sideStyle } = {}) {
      events[key] = await prisma.event.create({
        data: {
          organizationId: org.id,
          name: `${mark} ${title}`,
          status,
          shape: "single",
          format: "stroke",
          ...(sideStyle ? { sideStyle } : {}),
          dates: "",
          startOn: dayFrom(today, offset),
          course: `${mark} Heath`,
          city: "",
          address: "",
          regDeadline: "",
          leaderboardVisibility: visibility,
          customPars: JSON.stringify(PARS),
          customYards: JSON.stringify(new Array(18).fill(380)),
          customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
          shareToken: `${mark}-${randomBytes(6).toString("hex")}`,
          registrationToken: randomBytes(8).toString("hex"),
        },
      });
      players[key] = {};
      return events[key];
    }
    async function round(key, { format = "Individual Stroke Play", basis = "net", closed = true, offset } = {}) {
      stages[key] = await prisma.stage.create({
        data: {
          eventId: events[key].id,
          position: 0,
          description: "Round 1",
          type: "Stroke Play Round",
          format,
          holes: 18,
          scoringBasis: basis,
          handicapAllowance: 100,
          playedOn: dayFrom(today, offset),
          closedAt: closed ? new Date() : null,
        },
      });
      return stages[key];
    }
    async function enter(key, who, { handicap = 0, status = "confirmed" } = {}) {
      const seed = Object.keys(players[key]).length + 1;
      players[key][who] = await prisma.player.create({
        data: { eventId: events[key].id, name: PEOPLE[who], email: email(who), handicap, seed, status },
      });
      return players[key][who];
    }
    const returns = (key, who, strokes) =>
      prisma.scorecard.create({
        data: { eventId: events[key].id, stageId: stages[key].id, playerId: players[key][who].id, strokes, status: "approved" },
      });

    // ── Spring Medal: a shared second place, and a prize that is hers ──────────
    await event("spring", "Spring Medal", { offset: -30 });
    await round("spring", { offset: -30 });
    await enter("spring", "oswin", { handicap: 4 });
    await enter("spring", "fenella", { handicap: 10 });
    await enter("spring", "pip", { handicap: 10 });
    await enter("spring", "rook", { handicap: 2 });
    await returns("spring", "oswin", card(birdies(2)));
    await returns("spring", "fenella", card(bogeys(6)));
    await returns("spring", "pip", card(bogeys(6)));
    await returns("spring", "rook", card(bogeys(8)));
    await prisma.prize.create({ data: { eventId: events.spring.id, position: 1, category: "Winner", amount: 50, winnerId: players.spring.oswin.id } });
    await prisma.prize.create({ data: { eventId: events.spring.id, position: 2, category: "Best net", amount: 25, winnerId: players.spring.fenella.id } });
    const pin = await prisma.contest.create({
      data: { eventId: events.spring.id, stageId: stages.spring.id, kind: "closest-pin", name: "Nearest the pin, 7th", hole: 7, entryMode: "opt-in" },
    });
    await prisma.contestEntry.create({ data: { contestId: pin.id, playerId: players.spring.oswin.id, won: true } });
    await prisma.contestEntry.create({ data: { contestId: pin.id, playerId: players.spring.fenella.id, won: false } });

    // ── Summer Stableford: her points, her title, a contest; Pip missed it ─────
    await event("summer", "Summer Stableford", { offset: -20 });
    await round("summer", { format: "Stableford", basis: "net", offset: -20 });
    await enter("summer", "fenella", { handicap: 10 });
    await enter("summer", "oswin", { handicap: 4 });
    await enter("summer", "rook", { handicap: 2 });
    await returns("summer", "fenella", card(bogeys(4)));
    await returns("summer", "oswin", card(bogeys(8)));
    await returns("summer", "rook", card(bogeys(10)));
    const drive = await prisma.contest.create({
      data: { eventId: events.summer.id, stageId: stages.summer.id, kind: "long-drive", name: "Longest drive, 12th", hole: 12, entryMode: "opt-in" },
    });
    await prisma.contestEntry.create({ data: { contestId: drive.id, playerId: players.summer.fenella.id, won: true } });
    await prisma.honoursEntry.create({
      data: {
        organizationId: org.id,
        eventId: events.summer.id,
        eventName: events.summer.name,
        year: Number(today.slice(0, 4)),
        playerId: players.summer.fenella.id,
        championName: PEOPLE.fenella,
        confirmedBy: "Committee Example",
      },
    });

    // ── Pairs Better Ball: her SIDE's place ────────────────────────────────────
    await event("pairs", "Pairs Better Ball", { offset: -15, sideStyle: "pairs" });
    await round("pairs", { format: "Best Ball", basis: "gross", offset: -15 });
    for (const who of ["fenella", "ula", "oswin", "rook"]) await enter("pairs", who, { handicap: 6 });
    const sides = [
      { name: `${PEOPLE.fenella} & ${PEOPLE.ula}`, members: ["fenella", "ula"], cards: { fenella: card(bogeys(3)), ula: card(birdies(6)) } },
      { name: `${PEOPLE.oswin} & ${PEOPLE.rook}`, members: ["oswin", "rook"], cards: { oswin: card(), rook: card(bogeys(2)) } },
    ];
    for (const [i, s] of sides.entries()) {
      const team = await prisma.team.create({ data: { eventId: events.pairs.id, stageId: stages.pairs.id, name: s.name, seed: i + 1 } });
      for (const [pos, who] of s.members.entries()) {
        await prisma.teamMember.create({ data: { teamId: team.id, playerId: players.pairs[who].id, position: pos } });
        await prisma.teamScorecard.create({
          data: { eventId: events.pairs.id, stageId: stages.pairs.id, teamId: team.id, playerId: players.pairs[who].id, strokes: s.cards[who] },
        });
      }
    }

    // ── Committee Shield: scored by hand, so no place ─────────────────────────
    await event("shield", "Committee Shield", { offset: -12 });
    await round("shield", { format: "Other (scored by hand)", basis: "gross", offset: -12 });
    await enter("shield", "fenella");
    await enter("shield", "oswin");
    await returns("shield", "fenella", card(bogeys(1)));
    await returns("shield", "oswin", card());

    // ── Autumn Open: results held from the players ────────────────────────────
    await event("autumn", "Autumn Open", { offset: -8, visibility: "staff" });
    await round("autumn", { basis: "gross", offset: -8 });
    await enter("autumn", "fenella");
    await enter("autumn", "oswin");
    await returns("autumn", "fenella", card(birdies(2)));
    await returns("autumn", "oswin", card());
    await prisma.prize.create({ data: { eventId: events.autumn.id, position: 1, category: "Autumn champion", amount: 40, winnerId: players.autumn.fenella.id } });

    // ── Winter Cup: entered, nothing played yet ───────────────────────────────
    await event("winter", "Winter Cup", { offset: 10, status: "registration" });
    await round("winter", { closed: false, offset: 10 });
    await enter("winter", "fenella", { handicap: 10 });
    await enter("winter", "oswin", { handicap: 4 });

    // ── Members' Foursomes: on the waiting list ───────────────────────────────
    await event("foursomes", "Members Foursomes", { offset: 20, status: "registration" });
    await round("foursomes", { closed: false, offset: 20 });
    await enter("foursomes", "oswin");
    await enter("foursomes", "fenella", { status: "waitlisted" });

    // ── Captain's Prize: she did not enter it ─────────────────────────────────
    await event("captain", "Captains Prize", { offset: -5 });
    await round("captain", { basis: "gross", offset: -5 });
    await enter("captain", "oswin");
    await enter("captain", "rook");
    await returns("captain", "oswin", card(birdies(3)));
    await returns("captain", "rook", card());
    await prisma.prize.create({ data: { eventId: events.captain.id, position: 1, category: "Captains prize", amount: 60, winnerId: players.captain.oswin.id } });

    // ── Last Season Medal: ninety days back, before this season opened ────────
    await event("last", "Last Season Medal", { offset: -90 });
    await round("last", { basis: "gross", offset: -90 });
    await enter("last", "fenella");
    await enter("last", "oswin");
    await returns("last", "fenella", card(birdies(4)));
    await returns("last", "oswin", card());

    const cookie = (who, eventKey = "spring") => ({ session: sign(signedInNow(users[who].id)), event: sign(events[eventKey].id) });
    return {
      today,
      seasonOpened: opened,
      seasonStartsOn: org.seasonStartsOn,
      seasonEndsOn: org.seasonEndsOn,
      organizationId: org.id,
      events: Object.fromEntries(Object.entries(events).map(([k, e]) => [k, { id: e.id, name: e.name, shareToken: e.shareToken }])),
      players: Object.fromEntries(Object.entries(players).map(([k, byWho]) => [k, Object.fromEntries(Object.entries(byWho).map(([w, p]) => [w, p.id]))])),
      emails: { fenella: email("fenella"), oswin: email("oswin"), stranger: email("stranger") },
      cookies: { fenella: cookie("fenella"), oswin: cookie("oswin"), stranger: cookie("stranger") },
    };
  } finally {
    await prisma.$disconnect();
  }
}
