/**
 * A CLUB TO WALK AROUND IN.
 *
 * Seeds ONE invented club into the DEVELOPMENT database with a full roster and
 * nine tournaments covering as many permutations as the app has: a live net
 * medal with a published draw and a part-finished card, a completed gross
 * championship with a cut and prizes, a live knockout with a drawn bracket, a
 * weekly league with rounds behind and ahead of today, a four-ball and a
 * foursomes round, a nine-hole Stableford on a second course, two tournaments
 * still taking entries, and a draft with nothing in it.
 *
 * WHY IT IS NOT THE E2E FIXTURE. `e2e/fixture.mjs` is shaped for assertions —
 * four players, one round, one of each card state — and every screen the suite
 * renders, it renders in that one state. This is the opposite trade: nothing
 * here is asserted on, so it is free to be BROAD. It exists so the player
 * screens and the money screens can be walked against data that looks like a
 * club's, which is the one instrument CLAUDE.md says finds the class of defect
 * no test can — two screens answering the same question with different numbers.
 *
 * It must never collide with the e2e fixture. That marks its rows `zz-e2e…`
 * and deletes everything with that prefix when it runs; this marks its rows
 * `zz-club` and deletes only those. The two can sit in the same database and
 * neither teardown reaches the other's rows.
 *
 *   PATH="/c/Program Files/nodejs:$PATH"
 *   node --env-file=.env scripts/seed-club.mjs
 *   node --env-file=.env scripts/seed-club.mjs --teardown
 *
 * Seeding TEARS DOWN FIRST, so running it twice is the same as running it once.
 *
 * Invented people only: names that are nobody's, `@example.invalid` addresses,
 * and a club that does not exist. Hard rule 2 — the repository is public.
 */
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { runMark } from "./run-mark.mjs";

/**
 * The mark every row carries. Organization, every event, both courses and
 * every user email begin with it, so teardown can find all of it by prefix and
 * a human reading the database can tell at a glance that none of it is real.
 *
 * PER WORKTREE, like every other fixture in this repo, because `seed()` OPENS
 * by deleting everything that starts with it. A fixed string means two
 * checkouts on one machine wipe each other's rows mid-run, and the resulting
 * cascade reads exactly like the dead-server signature CLAUDE.md documents —
 * see `scripts/run-mark.mjs` for the measurement.
 *
 * This file first carried the bare string on the reasoning that a playground
 * somebody leaves in place has no concurrent RUNS to race. That is wrong in
 * the direction that costs most: the race is not between two seeds, it is
 * between one seed's opening delete and another worktree's data sitting there
 * already. `fixtures-do-not-collide.test.ts` sweeps every seeder in `scripts`
 * and `e2e` for exactly this and is why the argument did not survive.
 *
 * Still begins `zz-club`, so it is recognisable as a fixture at a glance and a
 * deliberate sweep can still find every worktree's rows.
 */
const MARK = runMark("zz-club");

/**
 * THE ONE THING THIS MUST NEVER DO IS WRITE TO PRODUCTION.
 *
 * Hard rule 1: a seed pointed at an event holding real people cannot be undone
 * from here. Checked on the HOST, because a password or a database name may
 * contain the word "localhost" and must not be what satisfies this. Modelled
 * on `scripts/look-at-screens.mjs`, deliberately — one copy of a refusal that
 * two scripts disagree about is worse than two identical ones.
 */
function refuseNonLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("No DATABASE_URL — run with --env-file=.env");

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a URL this script can read the host from. Refusing.");
  }

  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!local) {
    throw new Error(
      `Refusing to touch a database at "${host}". This seeds and deletes rows and is for the ` +
        `development database only — see hard rule 1 in CLAUDE.md.`,
    );
  }
}

/** The same signing scheme `src/lib/auth.ts` uses, so the cookies it prints work. */
const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/**
 * A calendar day N days from today, as the yyyy-mm-dd the app stores.
 *
 * Relative rather than fixed for the same reason the e2e fixture's is: the
 * availability calendar's whole job is to split a season around TODAY, and
 * hard-coded dates stop exercising that split the moment they all fall into
 * the past.
 */
const dayOffset = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/**
 * A seeded generator, so two runs produce the same club.
 *
 * Scores that move between runs make "did that number change because of my
 * edit?" unanswerable, which is the only question this data exists to support.
 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ courses */

/**
 * The 18-hole championship card. Par 71 — two par 3s and two par 5s a side,
 * with the back nine one shot shorter, which is an ordinary parkland routing
 * and not the flat 4s a fixture reaches for. A flat card cannot tell a birdie
 * pot from an eagle pot.
 */
const PARS_18 = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI_18 = [5, 11, 17, 1, 9, 3, 15, 7, 13, 6, 2, 18, 4, 12, 8, 16, 10, 14];
const YARDS_18 = [389, 512, 168, 441, 402, 417, 154, 398, 527, 411, 436, 171, 448, 533, 385, 162, 407, 394];

/**
 * A SECOND COURSE, AND A DIFFERENT SHAPE OF ONE: nine holes, executive length,
 * three par 3s and no par 5 at all. Par 31.
 *
 * Here so a nine-hole round and an away round are both walkable. CLAUDE.md's
 * card rules are explicit that a par range assuming a regulation course makes
 * a real golf course unstorable, and the only way to keep finding that is to
 * hold one that is not regulation.
 */
const PARS_9 = [4, 3, 4, 3, 4, 4, 3, 4, 3];
const SI_9 = [3, 9, 1, 7, 5, 2, 8, 4, 6];
const YARDS_9 = [331, 152, 298, 141, 312, 356, 128, 287, 165];

/* ------------------------------------------------------------------- people */

/**
 * THIRTY-SIX INVENTED MEMBERS, awkward in the ways real rosters are.
 *
 * Two of them are long and carry an accent, a curly apostrophe (U+2019) and a
 * hyphen, for the reason `e2e/fixture.mjs` sets out at length above its own
 * names: a player's name is rendered in the TIGHTEST column in the app, and a
 * roster where every name is ten ASCII characters certifies a layout nobody
 * has stressed and an encoding nobody has exercised. The others stay ordinary
 * on purpose — a field where EVERY name is long tests the wide case and quietly
 * stops testing the common one.
 *
 * `handicapSource: "none"` on three of them is the state `upsertMember` writes
 * for a club playing off association indexes, where the stored 0 must NOT be
 * printed as a scratch handicap. One genuine scratch player sits beside them so
 * "no index" cannot be implemented by hiding every zero.
 *
 * Index 0 is the signed-in player. Everything below refers to members by index.
 */
const ROSTER = [
  ["Séamus O’Halloran-Whyte", 8.4, "male", "White", "manual"],
  ["Bernadette Ní Mhuirthile-Ó Cadhla", 21.7, "female", "Red", "manual"],
  ["Toby Marchetti", 2.1, "male", "Blue", "manual"],
  ["Dilip Ranganathan", 11.3, "male", "White", "manual"],
  ["Hattie Mwangi", 16.8, "female", "Red", "manual"],
  ["Gordon Pyle", 0, "male", "Blue", "manual"],
  ["Nkechi Obioma", 5.6, "female", "Red", "manual"],
  ["Rafe Sandoval", 13.9, "male", "White", "manual"],
  ["Lena Kowalczyk", 19.2, "female", "Red", "manual"],
  ["Desmond Achterberg", 7.5, "male", "White", "manual"],
  ["Marnie Colquhoun", 24.6, "female", "Red", "manual"],
  ["Hiroshi Tanabe", 3.8, "male", "Blue", "manual"],
  ["Padraig Lunt", 9.1, "male", "White", "manual"],
  ["Odette Brissaud", 14.4, "female", "Red", "manual"],
  ["Kwame Asantewaa", 6.2, "male", "Blue", "manual"],
  ["Greta Lindqvist", 17.5, "female", "Red", "manual"],
  ["Wallace Ferrity", 12.0, "male", "White", "manual"],
  ["Noor Al-Rashidi", 10.7, "female", "Red", "manual"],
  ["Elias Wardlow", 1.4, "male", "Blue", "manual"],
  ["Priyanka Venkataraman", 22.9, "female", "Red", "manual"],
  ["Cormac Threlfall", 15.1, "male", "White", "manual"],
  ["Ysabel Montoya", 8.8, "female", "Red", "manual"],
  ["Brendan Quiggin", 18.3, "male", "White", "manual"],
  ["Fumiko Shirakawa", 4.5, "female", "Blue", "manual"],
  ["Angus Petrie", 20.6, "male", "White", "manual"],
  ["Tallulah Ngata", 12.7, "female", "Red", "manual"],
  ["Ivo Dragunov", 6.9, "male", "Blue", "manual"],
  ["Mairead Feeny", 26.4, "female", "Red", "manual"],
  ["Oswin Brackley", 9.7, "male", "White", "manual"],
  ["Chidi Nwachukwu", 3.2, "male", "Blue", "manual"],
  ["Rosalind Vane", 23.1, "female", "Red", "manual"],
  ["Barnaby Illingworth", 14.9, "male", "White", "manual"],
  // A genuine scratch player, so "no index" cannot be implemented by hiding
  // every zero — the direction a careless fix breaks.
  ["Pat Scarth", 0, "male", "Blue", "manual"],
  // Three with no index of their own: the club plays them off an association
  // number and nobody has claimed a figure. The stored 0 must never print.
  ["Wilhelmina Oyelaran", 0, "female", "Red", "none"],
  ["Ruaridh Strachan", 0, "male", "White", "none"],
  ["Jocasta Pemberton-Vale", 0, "female", "Red", "none"],
];

const emailFor = (i) => `${MARK}-m${String(i).padStart(2, "0")}@example.invalid`;

/* ------------------------------------------------------------------- cards  */

/**
 * A card, gross, from a player's handicap.
 *
 * THE HANDICAP SHIFTS THE DISTRIBUTION, NOT EVERY HOLE. The first version of
 * this subtracted a stroke per hole for the better players, and the first
 * screen it was rendered on read "-14" beside a name — a fourteen-under gross
 * round, on a board a person is supposed to look at and believe. A flat offset
 * is not a better golfer, it is a different par.
 *
 * The three rows are birdie / par / bogey thresholds; anything above is a
 * double. They come out at roughly +4, +13 and +20 gross over eighteen, which
 * is what a 5, a 14 and a 22 actually shoot — so the NET board compresses and
 * the GROSS board does not, and the two screens can be read against each
 * other, which is the whole reason this data exists.
 */
function cardFor(pars, rand, handicap) {
  const row = handicap < 8 ? [0.14, 0.72, 0.92] : handicap < 18 ? [0.05, 0.45, 0.8] : [0.02, 0.25, 0.6];
  return pars.map((par) => {
    const r = rand();
    const swing = r < row[0] ? -1 : r < row[1] ? 0 : r < row[2] ? 1 : 2;
    return Math.max(2, par + swing);
  });
}

/**
 * Truncate a match transcript at the hole it was actually decided on.
 *
 * `matrix.test.ts` records two fixtures that encoded matches which cannot
 * happen — five up with four to play, and then four more holes — so a
 * generator that just fills eighteen results produces data the rules forbid.
 * This walks the holes and nulls everything after the match is over, which is
 * what a card of a 5&4 looks like.
 */
function legalMatch(results, total) {
  const out = new Array(total).fill(null);
  let lead = 0;
  for (let i = 0; i < total; i += 1) {
    const r = results[i % results.length];
    out[i] = r;
    if (r === "A") lead += 1;
    else if (r === "B") lead -= 1;
    const remaining = total - (i + 1);
    if (Math.abs(lead) > remaining) break;
  }
  return JSON.stringify(out);
}

/* ----------------------------------------------------------------- teardown */

/**
 * Everything this script made, and nothing else.
 *
 * Organization cascades to its events, courses, roster and threads, and each
 * event cascades to its players, rounds, cards, matches, teams and money — so
 * the organization delete does most of it. Events and courses are still
 * deleted BY NAME first, so a half-finished run whose organization row is
 * already gone still cleans up rather than leaving orphans behind for somebody
 * to mistake for real.
 */
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
    await prisma.course.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
}

/* --------------------------------------------------------------------- seed */

export async function seed() {
  // Always from clean. A half-torn-down run from last time would otherwise
  // make this one fail for reasons that have nothing to do with the data.
  await teardown();

  const prisma = new PrismaClient();
  const built = [];
  try {
    const org = await prisma.organization.create({
      data: {
        name: `${MARK}-Braid Hollow Men’s & Ladies’ Golf Club`,
        kind: "club",
        city: "Kirkintilloch",
        country: "GB",
        currency: "GBP",
        currencySymbol: "£",
        locale: "en-GB",
        themeAppearance: "auto",
        // The club's own default is none; the tournaments that share costs say
        // so themselves, which is what `resolveMoneyMode` is for.
        moneyMode: "none",
      },
    });

    const home = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${MARK}-Braid Hollow — Championship Course`,
        city: "Kirkintilloch",
        address: "Hollow Road",
        pars: JSON.stringify(PARS_18),
        yards: JSON.stringify(YARDS_18),
        strokeIndex: JSON.stringify(SI_18),
        localRules:
          "Internal out of bounds: right of the 13th, defined by white stakes. " +
          "The ditch crossing the 6th and 15th is a red penalty area throughout.",
      },
    });

    const away = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${MARK}-Ardmore Wee Nine`,
        city: "Lenzie",
        pars: JSON.stringify(PARS_9),
        yards: JSON.stringify(YARDS_9),
        strokeIndex: JSON.stringify(SI_9),
        localRules: "Play the nine twice for an eighteen; the second lap plays off the same tees.",
      },
    });

    /**
     * Tees carry EIGHTEEN-hole ratings, including the nine-hole course's.
     *
     * `teeRatingFor` halves a stored rating for a nine-hole round — see
     * `nineHoleTee` in domain/handicap.ts — and `applyNine` doubles a
     * nine-hole card for an eighteen-hole one. Both conventions point the same
     * way: what is STORED describes eighteen. A tee holding a genuine
     * nine-hole rating would be halved again and allocate half the strokes.
     */
    const tees = {};
    for (const [courseId, list] of [
      [home.id, [
        ["Blue", "any", 72.4, 134, 71, 0],
        ["White", "any", 70.8, 129, 71, 1],
        ["Red", "female", 72.9, 127, 72, 2],
      ]],
      [away.id, [["Ardmore", "any", 58.6, 96, 62, 0]]],
    ]) {
      for (const [name, gender, courseRating, slopeRating, par, position] of list) {
        const tee = await prisma.tee.create({
          data: { courseId, name, gender, courseRating, slopeRating, par, position },
        });
        tees[`${courseId}:${name}`] = tee;
      }
    }
    const homeTee = (name) => tees[`${home.id}:${name}`];
    const awayTee = tees[`${away.id}:Ardmore`];

    await prisma.organization.update({
      where: { id: org.id },
      data: { defaultCourseId: home.id },
    });

    /* ----------------------------------------------------------- the roster */

    const members = [];
    for (const [i, [name, handicap, gender, preferredTee, source]] of ROSTER.entries()) {
      members.push(
        await prisma.member.create({
          data: {
            organizationId: org.id,
            name,
            email: emailFor(i),
            phone: "",
            ghin: source === "none" ? String(3200000 + i) : "",
            gender,
            preferredTee,
            memberNumber: String(1000 + i),
            handicap,
            handicapType: "18",
            handicapSource: source,
            status: "active",
          },
        }),
      );
    }

    /* --------------------------------------------------------- the accounts */

    /**
     * ONE SIGNED-IN PLAYER ACROSS SEVERAL TOURNAMENTS, which is the whole
     * point of seeding a club rather than a tournament.
     *
     * The tournament switcher, "which tournament am I scoring", and the events
     * list are all questions about a person who is in MORE THAN ONE thing —
     * and a fixture with one event cannot ask any of them.
     *
     * Access comes from the ORGANIZATION membership, not from an Account row
     * per event: `effectiveAccess` grants a plain member "player" on every
     * event in the club, which is exactly how a real member reaches a
     * tournament they have not entered. Account rows are still written for the
     * tournaments they are actually IN, so both paths are exercised.
     */
    const player = await prisma.user.create({
      data: { email: emailFor(0), name: ROSTER[0][0], password: "x:unusable" },
    });
    const organizer = await prisma.user.create({
      data: { email: `${MARK}-secretary@example.invalid`, name: "R. Ganizer", password: "x:unusable" },
    });
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org.id, userId: organizer.id, role: "owner" },
        { organizationId: org.id, userId: player.id, role: "member" },
      ],
    });

    /* ---------------------------------------------------------- the helpers */

    /** A tournament, with the columns every one of them needs filled in. */
    async function makeEvent(slug, name, extra) {
      const event = await prisma.event.create({
        data: {
          organizationId: org.id,
          name: `${MARK}-${name}`,
          dates: "",
          course: "",
          city: "Kirkintilloch",
          address: "",
          regDeadline: "",
          shareToken: `${MARK}-tok-${slug}`,
          ...extra,
        },
      });
      // The organizer administers every tournament in their own club. Written
      // as an Account as well as the organization role so the console's own
      // staff list has somebody on it.
      await prisma.account.create({
        data: { eventId: event.id, name: organizer.name, email: organizer.email, role: "admin" },
      });
      built.push({ slug, id: event.id, name: event.name, status: extra.status ?? "draft" });
      return event;
    }

    /** Enter the given roster indexes, in order, as this tournament's field. */
    async function enter(event, indexes, { status = "confirmed", teeByPreference = true } = {}) {
      const out = [];
      for (const [seat, i] of indexes.entries()) {
        const m = members[i];
        const tee = teeByPreference ? homeTee(m.preferredTee) : null;
        out.push(
          await prisma.player.create({
            data: {
              eventId: event.id,
              memberId: m.id,
              name: m.name,
              email: m.email,
              handicap: m.handicap,
              handicapType: m.handicapType,
              handicapSource: m.handicapSource,
              gender: m.gender,
              preferredTee: m.preferredTee,
              teeId: tee ? tee.id : null,
              seed: seat + 1,
              status,
            },
          }),
        );
        // A player reaches /me through their email, so the one we sign in as
        // gets an Account row wherever they are entered.
        if (i === 0) {
          await prisma.account.create({
            data: { eventId: event.id, name: m.name, email: m.email, role: "player" },
          });
        }
      }
      return out;
    }

    /** A drawn tee sheet over the given field, in fours, ten minutes apart. */
    function teeSheetFor(field, first = 8 * 60 + 10) {
      const groups = [];
      for (let i = 0; i < field.length; i += 4) {
        const at = first + (i / 4) * 10;
        groups.push({
          name: `Group ${groups.length + 1}`,
          startHole: 1,
          time: `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`,
          playerIds: field.slice(i, i + 4).map((p) => p.id),
        });
      }
      return JSON.stringify({ savedAt: new Date().toISOString(), startType: "tee", groups });
    }

    /* ============================================ 1. the live net medal ==== */

    /**
     * WHAT A CLUB IS DOING ON A SATURDAY. Live, draw published, cards coming
     * in — and the one screen state nothing else here has: a card that is
     * HALF ENTERED, belonging to the person we sign in as.
     */
    const medal = await makeEvent("medal", "April Medal — Men’s & Ladies’ Monthly Stroke Play", {
      status: "live",
      shape: "single",
      format: "stroke",
      sideStyle: "individual",
      dates: dayOffset(0),
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      defaultTeeId: homeTee("White").id,
      teePolicy: "own",
      customPars: JSON.stringify(PARS_18),
      customYards: JSON.stringify(YARDS_18),
      customStrokeIndex: JSON.stringify(SI_18),
      leaderboardVisibility: "public",
      scoreEntryBy: "players",
      scoreApproval: "staff",
      capacity: 40,
      moneyMode: "split",
      launchedAt: new Date(),
      tiebreakers: JSON.stringify(["toughest-6", "toughest-3", "lower-handicap"]),
    });
    await prisma.eventCourse.create({ data: { eventId: medal.id, courseId: home.id } });

    const medalField = await enter(medal, Array.from({ length: 24 }, (_, i) => i));

    // Three flights by handicap, which is what a club medal draws. Flights are
    // Group rows with no stage and no carrier flag.
    const flightNames = ["Division 1 (0–9)", "Division 2 (10–17)", "Division 3 (18+)"];
    const flights = [];
    for (const [i, name] of flightNames.entries()) {
      flights.push(await prisma.group.create({ data: { eventId: medal.id, name, position: i } }));
    }
    for (const p of medalField) {
      const f = p.handicap < 10 ? 0 : p.handicap < 18 ? 1 : 2;
      await prisma.player.update({ where: { id: p.id }, data: { groupId: flights[f].id } });
    }

    const medalRound = await prisma.stage.create({
      data: {
        eventId: medal.id,
        position: 0,
        description: "Round 1",
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        nine: "full",
        courseId: home.id,
        teeId: homeTee("White").id,
        scoringBasis: "net",
        handicapAllowance: 95,
        playedOn: dayOffset(0),
        teeSheet: teeSheetFor(medalField),
        // Published, because the field is on the course. `me.ts` reads a tee
        // sheet only when it is published — a draft draw must not reach a
        // player's phone the moment an organizer saves it.
        teeSheetPublished: true,
      },
    });

    /**
     * A MIX OF CARD STATES, INCLUDING ONE THAT IS NOT FINISHED.
     *
     * The part-finished card is the signed-in player's, so `/me/card` opens on
     * a round in progress rather than on a blank or a completed one — the
     * state a player is actually in when they have the phone in their hand.
     * Four players have no card at all, which is what "still out on the
     * course" looks like to every screen that counts cards in.
     */
    const medalRand = rng(11);
    for (const [i, p] of medalField.entries()) {
      if (i >= 20) continue; // four still out there, no row at all
      const full = cardFor(PARS_18, medalRand, p.handicap);
      const strokes = i === 0 ? full.map((s, h) => (h < 11 ? s : null)) : full;
      const status =
        i === 0 ? "entered" : i % 7 === 3 ? "certified" : i % 7 === 5 ? "disputed" : "approved";
      await prisma.scorecard.create({
        data: {
          eventId: medal.id,
          stageId: medalRound.id,
          playerId: p.id,
          strokes: JSON.stringify(strokes),
          status,
          certifiedBy: status === "approved" || status === "certified" ? medalField[(i + 1) % 20].name : "",
          certifiedAt: status === "approved" || status === "certified" ? new Date() : null,
          approvedBy: status === "approved" ? organizer.name : "",
          approvedAt: status === "approved" ? new Date() : null,
        },
      });
    }

    /**
     * MONEY ON THE MEDAL: a bill that does not divide, a part-payment against
     * it, a skins pot, a derived pot and a closest-to-the-pin.
     *
     * The odd penny is the point. An even split proves nothing about the
     * arithmetic, and every screen that reports it has to agree about where
     * the extra went.
     */
    const bill = await prisma.expense.create({
      data: {
        eventId: medal.id,
        description: `${MARK} buggies and caddie fees`,
        // 8003 across four weights of 2/1/1/1 — nothing here divides.
        amountCents: 8003,
        paidBy: medalField[0].id,
        category: "cart",
        spentOn: dayOffset(0),
        createdBy: organizer.name,
        shares: {
          create: [
            { playerId: medalField[0].id, weight: 2 },
            { playerId: medalField[1].id, weight: 1 },
            { playerId: medalField[2].id, weight: 1 },
            { playerId: medalField[3].id, weight: 1 },
          ],
        },
      },
    });
    // One person has paid PART of their share, so the settle-up shows a
    // remaining balance rather than a clean zero. A screen that only ever
    // renders nothing-owed is a screen whose arithmetic nobody has read.
    await prisma.expensePayment.create({
      data: { expenseId: bill.id, playerId: medalField[1].id, amountCents: 900 },
    });
    await prisma.settlement.create({
      data: {
        eventId: medal.id,
        fromPlayerId: medalField[2].id,
        toPlayerId: medalField[0].id,
        cents: 700,
        owedCents: 1601,
        recordedBy: organizer.name,
      },
    });
    await prisma.expense.create({
      data: {
        eventId: medal.id,
        description: `${MARK} halfway house`,
        amountCents: 2450,
        paidBy: medalField[4].id,
        category: "food",
        spentOn: dayOffset(0),
        createdBy: organizer.name,
        shares: { create: medalField.slice(0, 8).map((p) => ({ playerId: p.id, weight: 1 })) },
      },
    });

    const skins = await prisma.skinsPot.create({
      data: {
        eventId: medal.id,
        stageId: medalRound.id,
        net: true,
        scope: "full",
        groupKey: "",
        buyInCents: 500,
      },
    });
    await prisma.skinsEntry.createMany({
      data: medalField.slice(0, 16).map((p) => ({ potId: skins.id, playerId: p.id, confirmed: true })),
    });

    // A derived pot and a Nassau, which are the two halves of the side-bet
    // rules: a low-net pot may only be reported when the round is FINAL, and a
    // Nassau's completed segments are correctly paid LIVE. Both on one round,
    // so the difference is visible on one screen.
    const lowNet = await prisma.sideGame.create({
      data: {
        eventId: medal.id,
        stageId: medalRound.id,
        kind: "low-net",
        groupKey: "",
        buyInCents: 200,
        createdBy: organizer.name,
      },
    });
    await prisma.sideGameEntry.createMany({
      data: medalField.slice(0, 12).map((p) => ({ sideGameId: lowNet.id, playerId: p.id, confirmed: true })),
    });
    const nassau = await prisma.sideGame.create({
      data: {
        eventId: medal.id,
        stageId: medalRound.id,
        kind: "nassau",
        groupKey: "",
        buyInCents: 1000,
        createdBy: organizer.name,
      },
    });
    await prisma.sideGameEntry.createMany({
      data: medalField.slice(0, 4).map((p) => ({ sideGameId: nassau.id, playerId: p.id, confirmed: true })),
    });

    const ctp = await prisma.contest.create({
      data: {
        eventId: medal.id,
        stageId: medalRound.id,
        kind: "closest-pin",
        name: `${MARK} Closest to the pin — 12th`,
        hole: 12,
        buyInCents: 300,
        entryMode: "opt-in",
        createdBy: organizer.name,
      },
    });
    await prisma.contestEntry.createMany({
      data: medalField.slice(0, 14).map((p, i) => ({
        contestId: ctp.id,
        playerId: p.id,
        won: i === 6,
        confirmed: true,
      })),
    });

    await prisma.announcement.create({
      data: {
        eventId: medal.id,
        title: `${MARK} Preferred lies are in play`,
        body: "Lift, clean and place within six inches, no nearer the hole, on closely mown areas through the green.",
        pinned: true,
      },
    });
    await prisma.announcement.create({
      data: {
        eventId: medal.id,
        title: `${MARK} Cards to the pro shop by 6pm`,
        body: "",
        pinned: false,
      },
    });

    /* ====================================== 2. the completed championship == */

    /**
     * TWO ROUNDS AND A CUT, FINISHED. The only tournament here that is over —
     * which is a different screen everywhere, because money may be reported,
     * prizes are awarded, and the lifecycle offers nothing more to do.
     *
     * Money is OFF on this one, deliberately. Both states have to be walkable,
     * and a club championship where the shop takes the entry and pays the
     * winner is exactly the tournament that should not be offering a settle-up.
     */
    const champs = await makeEvent("champs", "Club Championship — 36 Holes Gross", {
      status: "completed",
      shape: "series",
      format: "stroke",
      sideStyle: "individual",
      dates: `${dayOffset(-35)} to ${dayOffset(-34)}`,
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      defaultTeeId: homeTee("Blue").id,
      teePolicy: "one",
      customPars: JSON.stringify(PARS_18),
      customYards: JSON.stringify(YARDS_18),
      customStrokeIndex: JSON.stringify(SI_18),
      leaderboardVisibility: "public",
      moneyMode: "none",
      capacity: 32,
      launchedAt: new Date(Date.now() - 36 * 864e5),
      completedAt: new Date(Date.now() - 34 * 864e5),
    });
    await prisma.eventCourse.create({ data: { eventId: champs.id, courseId: home.id } });
    const champField = await enter(champs, Array.from({ length: 28 }, (_, i) => i));

    const champR1 = await prisma.stage.create({
      data: {
        eventId: champs.id,
        position: 0,
        description: "Round 1",
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        courseId: home.id,
        teeId: homeTee("Blue").id,
        scoringBasis: "gross",
        handicapAllowance: 100,
        playedOn: dayOffset(-35),
        teeSheet: teeSheetFor(champField),
        teeSheetPublished: true,
      },
    });
    /**
     * THE CUT IS A PROPERTY OF THE ROUND IT FEEDS — see domain/cut.ts. Stage 1
     * carries `cutEnabled`, meaning only the sixteen who survive round one
     * play it. `roundLabel` does not count a cut as a round, which is the thing
     * `round-number-source.test.ts` exists to keep true.
     */
    const champR2 = await prisma.stage.create({
      data: {
        eventId: champs.id,
        position: 1,
        description: "Round 2",
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        courseId: home.id,
        teeId: homeTee("Blue").id,
        scoringBasis: "gross",
        handicapAllowance: 100,
        playedOn: dayOffset(-34),
        cutEnabled: true,
        cutScope: "overall",
        cutMode: "count",
        cutCount: 16,
        teeSheetPublished: true,
      },
    });

    const champRand = rng(29);
    const r1Totals = [];
    for (const [i, p] of champField.entries()) {
      const strokes = cardFor(PARS_18, champRand, p.handicap);
      r1Totals.push({ p, total: strokes.reduce((a, b) => a + b, 0) });
      await prisma.scorecard.create({
        data: {
          eventId: champs.id,
          stageId: champR1.id,
          playerId: p.id,
          strokes: JSON.stringify(strokes),
          status: "approved",
          approvedBy: organizer.name,
          approvedAt: new Date(Date.now() - 35 * 864e5),
        },
      });
    }
    const survived = [...r1Totals].sort((a, b) => a.total - b.total).slice(0, 16);
    for (const { p } of survived) {
      await prisma.scorecard.create({
        data: {
          eventId: champs.id,
          stageId: champR2.id,
          playerId: p.id,
          strokes: JSON.stringify(cardFor(PARS_18, champRand, p.handicap)),
          status: "approved",
          approvedBy: organizer.name,
          approvedAt: new Date(Date.now() - 34 * 864e5),
        },
      });
    }

    await prisma.prize.createMany({
      data: [
        { eventId: champs.id, position: 1, category: `${MARK} Club Champion`, detail: "The Hollow Salver", amount: 250, winnerId: survived[0].p.id },
        { eventId: champs.id, position: 2, category: `${MARK} Runner-up`, amount: 120, winnerId: survived[1].p.id },
        { eventId: champs.id, position: 3, category: `${MARK} Third`, amount: 60, winnerId: survived[2].p.id },
        { eventId: champs.id, position: 0, category: `${MARK} Best gross round`, detail: "Round 2", amount: 40 },
      ],
    });

    /* ============================================== 3. the live knockout === */

    /**
     * A KNOCKOUT WITH A DRAW THAT HAS ALREADY HAPPENED.
     *
     * `bracketDraw` is written once, by the first recorded result, and from
     * then on the draw is what it was on the day — the alternative reshuffles
     * played matches underneath their own results. Written here for the same
     * reason: a bracket seeded live from standings is not a bracket anyone has
     * played.
     *
     * Two rounds are in: the last eight complete (with one upset, so the draw
     * is not simply the seeding read downwards) and one semi-final played. The
     * other semi is empty, which is what LIVE means for a knockout.
     */
    const knockout = await makeEvent("knockout", "Summer Knockout — Match Play Championship", {
      status: "live",
      shape: "knockout",
      format: "match",
      sideStyle: "individual",
      dates: `${dayOffset(-21)} onwards`,
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      defaultTeeId: homeTee("White").id,
      customPars: JSON.stringify(PARS_18),
      customYards: JSON.stringify(YARDS_18),
      customStrokeIndex: JSON.stringify(SI_18),
      bracketMode: "single",
      qualifyMode: "overall",
      qualifyOverall: 8,
      qualifyPerGroup: 2,
      leaderboardVisibility: "participants",
      moneyMode: "none",
      capacity: 16,
      launchedAt: new Date(Date.now() - 22 * 864e5),
      matchTiebreakers: JSON.stringify(["sudden-death"]),
    });
    await prisma.eventCourse.create({ data: { eventId: knockout.id, courseId: home.id } });
    const koField = await enter(knockout, Array.from({ length: 16 }, (_, i) => i));

    // Four flights of four, so the round robin is 6 matches a flight rather
    // than 28 — the size a club actually runs.
    const koFlights = [];
    for (let i = 0; i < 4; i += 1) {
      koFlights.push(
        await prisma.group.create({ data: { eventId: knockout.id, name: `Group ${"ABCD"[i]}`, position: i } }),
      );
    }
    for (const [i, p] of koField.entries()) {
      await prisma.player.update({ where: { id: p.id }, data: { groupId: koFlights[i % 4].id } });
    }

    const koGroupStage = await prisma.stage.create({
      data: {
        eventId: knockout.id,
        position: 0,
        description: "Group stage",
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
        courseId: home.id,
        scoringBasis: "gross",
        handicapAllowance: 100,
        playedOn: dayOffset(-21),
      },
    });
    const koBracketStage = await prisma.stage.create({
      data: {
        eventId: knockout.id,
        position: 1,
        description: "Knockout",
        type: "Bracket Stage",
        format: "Match Play",
        holes: 18,
        courseId: home.id,
        scoringBasis: "gross",
        handicapAllowance: 100,
        playedOn: dayOffset(-7),
      },
    });

    const koRand = rng(53);
    for (const [f, flight] of koFlights.entries()) {
      const inFlight = koField.filter((_, i) => i % 4 === f);
      for (let a = 0; a < inFlight.length; a += 1) {
        for (let b = a + 1; b < inFlight.length; b += 1) {
          const r = koRand();
          // Three shapes of transcript, all truncated at the hole the match
          // was won on, so none of them encodes a match that cannot happen.
          const pattern = r < 0.4 ? ["A", "H", "A", "H"] : r < 0.8 ? ["B", "H", "B", "H", "H"] : ["A", "B", "H"];
          await prisma.match.create({
            data: {
              eventId: knockout.id,
              stageId: koGroupStage.id,
              groupId: flight.id,
              round: 1,
              playerAId: inFlight[a].id,
              playerBId: inFlight[b].id,
              holes: legalMatch(pattern, 18),
              courseId: home.id,
              scoreStatus: "confirmed",
              scoredAt: new Date(Date.now() - 20 * 864e5),
              enteredBy: inFlight[a].name,
              enteredById: inFlight[a].id,
              confirmedBy: inFlight[b].name,
              confirmedById: inFlight[b].id,
            },
          });
        }
      }
    }

    // The eight who qualified, in qualifying order. Seed order for a bracket
    // of eight is [1,8,4,5,3,6,2,7], so match 0 is ids[0] v ids[7].
    const drawn = koField.slice(0, 8).map((p) => p.id);
    await prisma.event.update({
      where: { id: knockout.id },
      data: { bracketDraw: JSON.stringify(drawn) },
    });
    await prisma.bracketWinner.createMany({
      data: [
        { eventId: knockout.id, key: "winners-0-0", winnerId: drawn[0], result: "4&3" },
        { eventId: knockout.id, key: "winners-0-1", winnerId: drawn[3], result: "2&1" },
        // The upset: seed 6 beats seed 3.
        { eventId: knockout.id, key: "winners-0-2", winnerId: drawn[5], result: "1 up" },
        { eventId: knockout.id, key: "winners-0-3", winnerId: drawn[1], result: "5&4" },
        // One semi-final played; the other is still to come.
        { eventId: knockout.id, key: "winners-1-0", winnerId: drawn[3], result: "19th" },
      ],
    });
    await prisma.announcement.create({
      data: {
        eventId: knockout.id,
        title: `${MARK} Second semi-final to be played by Sunday`,
        body: "Arrange your own tee time with the shop and text the result to the secretary.",
        pinned: true,
      },
    });

    /* ============================================== 4. the weekly league === */

    /**
     * A SEASON WITH ROUNDS BEHIND AND AHEAD OF TODAY, and an attendance mode
     * that gives the availability calendar a question to ask.
     *
     * With the default "everyone" there is nothing to answer and the whole
     * feature is invisible. "opt-out" is the regulars' league: you are in
     * unless you say otherwise, which is what a Thursday night roll-up is.
     */
    const league = await makeEvent("league", "Thursday Evening League — Summer Season", {
      status: "live",
      shape: "series",
      format: "stroke",
      sideStyle: "individual",
      dates: "Thursdays, May to August",
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      defaultTeeId: homeTee("White").id,
      customPars: JSON.stringify(PARS_18),
      customYards: JSON.stringify(YARDS_18),
      customStrokeIndex: JSON.stringify(SI_18),
      attendanceMode: "opt-out",
      leaderboardVisibility: "participants",
      moneyMode: "none",
      capacity: 32,
      scoreEntryBy: "players",
      scoreApproval: "players",
      launchedAt: new Date(Date.now() - 30 * 864e5),
    });
    await prisma.eventCourse.create({ data: { eventId: league.id, courseId: home.id } });
    const leagueField = await enter(league, Array.from({ length: 20 }, (_, i) => i));

    const weeks = [];
    for (const [i, offset] of [-28, -21, -14, -7, 3, 10, 17].entries()) {
      weeks.push(
        await prisma.stage.create({
          data: {
            eventId: league.id,
            position: i,
            description: `Week ${i + 1}`,
            type: "Stroke Play Round",
            format: "Stableford",
            holes: 18,
            courseId: home.id,
            teeId: homeTee("White").id,
            scoringBasis: "net",
            handicapAllowance: 95,
            playedOn: dayOffset(offset),
            optDeadline: dayOffset(offset - 1),
            teeSheet: offset < 0 ? teeSheetFor(leagueField, 17 * 60 + 30) : "",
            teeSheetPublished: offset < 0,
          },
        }),
      );
    }

    const leagueRand = rng(71);
    // The four weeks behind us are played; the three ahead are not.
    for (const week of weeks.slice(0, 4)) {
      for (const [i, p] of leagueField.entries()) {
        // Not everybody plays every week — a league where the same twenty
        // return a card every time cannot show an absentee anything.
        if (leagueRand() < 0.22) continue;
        await prisma.scorecard.create({
          data: {
            eventId: league.id,
            stageId: week.id,
            playerId: p.id,
            strokes: JSON.stringify(cardFor(PARS_18, leagueRand, p.handicap)),
            status: "approved",
            approvedBy: organizer.name,
            approvedAt: new Date(),
          },
        });
      }
    }
    // Who has said they are in or out for the weeks still to come. The
    // signed-in player is IN for the next one and OUT for the one after, so
    // both answers are on the calendar they open.
    for (const [w, week] of weeks.slice(4).entries()) {
      for (const [i, p] of leagueField.entries()) {
        const r = leagueRand();
        const status = i === 0 ? (w === 1 ? "out" : "in") : r < 0.2 ? "out" : r < 0.75 ? "in" : null;
        if (!status) continue; // nobody has heard from them yet
        await prisma.roundAttendance.create({
          data: {
            eventId: league.id,
            stageId: week.id,
            playerId: p.id,
            status,
            decidedBy: p.name,
          },
        });
      }
    }

    /* ================================================ 5. the team rounds == */

    /**
     * BOTH STRUCTURAL SHAPES OF TEAM GOLF, in one tournament.
     *
     * Four-Ball is a side of two aggregating SEPARATE balls — every player
     * keeps a card. Foursomes is a side of two sharing ONE. `formats.ts` calls
     * that `ball: "individual"` against `ball: "single"`, and it decides the
     * whole scorecard shape, so a fixture with only one of them has walked half
     * the team code.
     *
     * The second money tournament, so both money screens have two events to
     * disagree about.
     */
    const teamEvent = await makeEvent("fourball", "Members’ Four-Ball & Foursomes Invitational", {
      status: "live",
      shape: "series",
      format: "stroke",
      sideStyle: "pairs",
      dates: dayOffset(-3),
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      defaultTeeId: homeTee("White").id,
      customPars: JSON.stringify(PARS_18),
      customYards: JSON.stringify(YARDS_18),
      customStrokeIndex: JSON.stringify(SI_18),
      leaderboardVisibility: "public",
      moneyMode: "split",
      expenseEntry: "staff",
      capacity: 16,
      launchedAt: new Date(Date.now() - 4 * 864e5),
    });
    await prisma.eventCourse.create({ data: { eventId: teamEvent.id, courseId: home.id } });
    const teamField = await enter(teamEvent, Array.from({ length: 16 }, (_, i) => i));

    const fourBall = await prisma.stage.create({
      data: {
        eventId: teamEvent.id,
        position: 0,
        description: "Morning four-ball",
        type: "Stroke Play Round",
        format: "Four-Ball",
        holes: 18,
        courseId: home.id,
        teeId: homeTee("White").id,
        scoringBasis: "net",
        handicapAllowance: 85,
        playedOn: dayOffset(-3),
        teeSheet: teeSheetFor(teamField),
        teeSheetPublished: true,
      },
    });
    const foursomes = await prisma.stage.create({
      data: {
        eventId: teamEvent.id,
        position: 1,
        description: "Afternoon foursomes",
        type: "Stroke Play Round",
        format: "Foursomes",
        holes: 18,
        courseId: home.id,
        teeId: homeTee("White").id,
        scoringBasis: "net",
        handicapAllowance: 50,
        playedOn: dayOffset(-3),
      },
    });

    const teamRand = rng(97);
    for (const stage of [fourBall, foursomes]) {
      const single = stage.format === "Foursomes";
      for (let i = 0; i < teamField.length; i += 2) {
        const a = teamField[i];
        const b = teamField[i + 1];
        const side = await prisma.team.create({
          data: {
            eventId: teamEvent.id,
            stageId: stage.id,
            name: `${a.name.split(" ")[0]} & ${b.name.split(" ")[0]}`,
            seed: i / 2 + 1,
          },
        });
        await prisma.teamMember.createMany({
          data: [
            { teamId: side.id, playerId: a.id, position: 0 },
            { teamId: side.id, playerId: b.id, position: 1 },
          ],
        });
        if (single) {
          // One ball, one card for the side: playerId stays empty.
          await prisma.teamScorecard.create({
            data: {
              eventId: teamEvent.id,
              stageId: stage.id,
              teamId: side.id,
              playerId: "",
              // A shared ball plays off the better of the two, roughly.
              strokes: JSON.stringify(cardFor(PARS_18, teamRand, Math.min(a.handicap, b.handicap))),
            },
          });
        } else {
          for (const p of [a, b]) {
            await prisma.teamScorecard.create({
              data: {
                eventId: teamEvent.id,
                stageId: stage.id,
                teamId: side.id,
                playerId: p.id,
                strokes: JSON.stringify(cardFor(PARS_18, teamRand, p.handicap)),
              },
            });
          }
        }
      }
    }

    const dinner = await prisma.expense.create({
      data: {
        eventId: teamEvent.id,
        description: `${MARK} dinner and prize table`,
        // 41 across 16 does not divide either.
        amountCents: 41005,
        paidBy: teamField[0].id,
        category: "food",
        spentOn: dayOffset(-3),
        createdBy: organizer.name,
        shares: { create: teamField.map((p) => ({ playerId: p.id, weight: 1 })) },
      },
    });
    await prisma.expensePayment.createMany({
      data: teamField.slice(1, 6).map((p) => ({ expenseId: dinner.id, playerId: p.id, amountCents: 2000 })),
    });
    await prisma.settlement.create({
      data: {
        eventId: teamEvent.id,
        fromPlayerId: teamField[7].id,
        toPlayerId: teamField[0].id,
        cents: 2563,
        owedCents: 2563,
        recordedBy: organizer.name,
      },
    });
    const teamSkins = await prisma.skinsPot.create({
      data: {
        eventId: teamEvent.id,
        stageId: fourBall.id,
        net: false,
        scope: "front",
        groupKey: "",
        buyInCents: 0,
        stakeNote: "a pint in the Hollow bar",
      },
    });
    await prisma.skinsEntry.createMany({
      data: teamField.map((p) => ({ potId: teamSkins.id, playerId: p.id, confirmed: true })),
    });

    /* ============================ 6. nine holes, Stableford, away course == */

    /**
     * NINE HOLES ON THE OTHER COURSE, which is a SECOND SET OF ARITHMETIC and
     * not a smaller loop — `indexForHoles` halves the index, `allocationHoles`
     * spreads strokes over the holes actually played, and `cardForStage`
     * narrows par and stroke index to the nine. `verify-lifecycle.mjs` says
     * this path had never been rendered by anything before it walked it.
     *
     * Cards are stored at NINE entries, aligned to the narrowed card — which
     * is what `skins-nine-card.audit.test.ts` writes and what a nine-hole
     * course's own card is.
     */
    const twilight = await makeEvent("twilight", "Twilight Nine — Midweek Stableford at Ardmore", {
      status: "live",
      shape: "single",
      format: "stroke",
      sideStyle: "individual",
      dates: dayOffset(-1),
      course: `${MARK}-Ardmore Wee Nine`,
      courseId: away.id,
      defaultTeeId: awayTee.id,
      customPars: JSON.stringify(PARS_9),
      customYards: JSON.stringify(YARDS_9),
      customStrokeIndex: JSON.stringify(SI_9),
      leaderboardVisibility: "public",
      moneyMode: "none",
      capacity: 24,
      launchedAt: new Date(Date.now() - 2 * 864e5),
    });
    await prisma.eventCourse.create({ data: { eventId: twilight.id, courseId: away.id } });
    const twilightField = await enter(twilight, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], {
      teeByPreference: false,
    });
    for (const p of twilightField) {
      await prisma.player.update({ where: { id: p.id }, data: { teeId: awayTee.id } });
    }

    const twilightRound = await prisma.stage.create({
      data: {
        eventId: twilight.id,
        position: 0,
        description: "Nine holes",
        type: "Stroke Play Round",
        format: "Stableford",
        holes: 9,
        nine: "full",
        courseId: away.id,
        teeId: awayTee.id,
        scoringBasis: "net",
        handicapAllowance: 95,
        playedOn: dayOffset(-1),
        teeSheet: teeSheetFor(twilightField, 18 * 60),
        teeSheetPublished: true,
      },
    });
    const twiRand = rng(131);
    for (const [i, p] of twilightField.entries()) {
      if (i === 11) continue; // one no-return, which is an ordinary thing
      await prisma.scorecard.create({
        data: {
          eventId: twilight.id,
          stageId: twilightRound.id,
          playerId: p.id,
          strokes: JSON.stringify(cardFor(PARS_9, twiRand, p.handicap)),
          status: i === 0 ? "certified" : "approved",
          certifiedBy: twilightField[(i + 1) % 11].name,
          certifiedAt: new Date(),
          approvedBy: i === 0 ? "" : organizer.name,
          approvedAt: i === 0 ? null : new Date(),
        },
      });
    }

    /* ======================================= 7. two still taking entries == */

    /**
     * REGISTRATION, IN ITS TWO STATES, and the signed-in player is in a
     * DIFFERENT one in each.
     *
     * Open with room, where they have not entered — the row on `/me/events`
     * that carries an Enter button. And full, where they are on the waiting
     * list — the row that carries a place in a queue. Neither is reachable from
     * a fixture where the one player is confirmed in the one tournament.
     */
    const captains = await makeEvent("captains", "Captain’s Day — Open Entry", {
      status: "registration",
      shape: "single",
      format: "stroke",
      dates: dayOffset(28),
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      regOpens: dayOffset(-7),
      regDeadline: dayOffset(21),
      registrationOpen: true,
      registrationToken: `${MARK}reg1`,
      registrationApproval: "auto",
      capacity: 40,
      moneyMode: "",
      leaderboardVisibility: "participants",
    });
    await prisma.eventCourse.create({ data: { eventId: captains.id, courseId: home.id } });
    // Eighteen in, and the signed-in player is NOT one of them.
    await enter(captains, Array.from({ length: 18 }, (_, i) => i + 6));

    const scramble = await makeEvent("scramble", "Autumn Am-Am Scramble — Waiting List", {
      status: "registration",
      shape: "single",
      format: "stroke",
      sideStyle: "teams",
      dates: dayOffset(45),
      course: `${MARK}-Braid Hollow — Championship Course`,
      courseId: home.id,
      regOpens: dayOffset(-21),
      regDeadline: dayOffset(38),
      registrationOpen: true,
      registrationToken: `${MARK}reg2`,
      registrationApproval: "approve",
      capacity: 12,
      moneyMode: "",
      leaderboardVisibility: "participants",
    });
    await prisma.eventCourse.create({ data: { eventId: scramble.id, courseId: home.id } });
    await enter(scramble, Array.from({ length: 12 }, (_, i) => i + 10));
    // Full, so the next three are on the list — ours first.
    await enter(scramble, [0, 1, 2], { status: "waitlisted" });

    /* ================================================== 8. a bare draft === */

    /**
     * A NAME AND NOTHING ELSE, which is the state every club is in for their
     * first ten minutes — and the state `verify-lifecycle.mjs` exists because
     * nothing else renders. `/entry` returned 500 on a tournament with no
     * rounds for exactly this reason.
     */
    await makeEvent("draft", "Winter Series — Not Yet Planned", {
      status: "draft",
      shape: "series",
      format: "stroke",
    });

    /* ------------------------------------------------------- club messages */

    /**
     * Two threads: one on the CLUB, which outlives every tournament, and one
     * on the medal. `scopeKey` is `kind:id` — see domain/messaging.ts — and the
     * club and event scopes carry no id of their own because the row already
     * says which club or event it hangs off.
     */
    const clubThread = await prisma.thread.create({
      data: {
        organizationId: org.id,
        eventId: null,
        scopeKey: "club:",
        title: `${MARK} Course news`,
        createdByEmail: organizer.email,
        createdByName: organizer.name,
      },
    });
    await prisma.threadParticipant.createMany({
      data: [
        { threadId: clubThread.id, email: organizer.email },
        { threadId: clubThread.id, email: player.email },
      ],
    });
    await prisma.message.createMany({
      data: [
        {
          threadId: clubThread.id,
          authorEmail: organizer.email,
          authorName: organizer.name,
          body: "Greens are being hollow-tined on Monday and Tuesday. Temporary greens on the 4th and the 13th.",
        },
        {
          threadId: clubThread.id,
          authorEmail: player.email,
          authorName: player.name,
          body: "Is the Thursday league still on that week?",
        },
        {
          threadId: clubThread.id,
          authorEmail: organizer.email,
          authorName: organizer.name,
          body: "It is — the two temporaries are both par 3s, so the card stands.",
        },
      ],
    });

    const medalThread = await prisma.thread.create({
      data: {
        organizationId: org.id,
        eventId: medal.id,
        scopeKey: "event:",
        title: `${MARK} Medal day`,
        createdByEmail: organizer.email,
        createdByName: organizer.name,
      },
    });
    await prisma.threadParticipant.createMany({
      data: [
        { threadId: medalThread.id, email: organizer.email },
        { threadId: medalThread.id, email: player.email },
      ],
    });
    await prisma.message.create({
      data: {
        threadId: medalThread.id,
        authorEmail: organizer.email,
        authorName: organizer.name,
        body: "First tee at 08:10. Please return your card to the shop, signed by your marker.",
      },
    });

    return {
      org,
      organizer: { session: sign(organizer.id), email: organizer.email },
      player: { session: sign(player.id), email: player.email, name: player.name },
      events: built,
      /** The tournament both cookies open on: the live medal. */
      landing: medal,
      shareTokens: {
        medal: medal.shareToken,
        champs: champs.shareToken,
        twilight: twilight.shareToken,
        team: teamEvent.shareToken,
      },
      counts: { members: members.length, events: built.length },
    };
  } finally {
    await prisma.$disconnect();
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  refuseNonLocal();

  if (process.argv.includes("--teardown")) {
    await teardown();
    console.log(`Removed everything marked "${MARK}".`);
    return;
  }

  const data = await seed();

  const lines = [
    "",
    `Seeded ${data.org.name}`,
    `  ${data.counts.members} members, ${data.counts.events} tournaments, 2 courses.`,
    "",
    ...data.events.map((e) => `  ${e.status.padEnd(13)} ${e.name}`),
    "",
    "Paste these into the browser console at http://localhost:3100, then reload.",
    "",
    `The club secretary (admin on every tournament):`,
    "",
    `  document.cookie='ng_session=${data.organizer.session}; path=/'`,
    `  document.cookie='ng_active_event=${sign(data.landing.id)}; path=/'`,
    "",
    /**
     * A PLAYER IS A DIFFERENT APP, not a narrower console — and this one is in
     * SIX of the nine tournaments, waitlisted in a seventh and merely able to
     * see an eighth. That is the whole reason this fixture exists: the class of
     * defect a test suite is blind to is two screens answering one question
     * differently, and it is sharpest between what the organizer sees and what
     * the player in the same tournament sees.
     */
    `${data.player.name} — /me and the play shell:`,
    "",
    `  document.cookie='ng_session=${data.player.session}; path=/'`,
    `  document.cookie='ng_active_event=${sign(data.landing.id)}; path=/'`,
    "",
    "Public boards, signed out:",
    ...Object.entries(data.shareTokens).map(([k, t]) => `  /live/${t}   (${k})`),
    "",
    `Remove it all with:  node --env-file=.env scripts/seed-club.mjs --teardown`,
    "",
  ];
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(String(e?.stack ?? e?.message ?? e));
  process.exitCode = 1;
});
