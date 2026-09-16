/**
 * Every console screen, at every stage a tournament passes through.
 *
 * `smoke-routes.mjs` walks all 40 routes and proves each renders — against the
 * SEEDED DEMO, which is a fully populated tournament with rounds, a field,
 * flights, cards, a bracket and money. Every screen in the app has been seen
 * in that state and in almost no other.
 *
 * A club is not in that state. They are in this one:
 *
 *     named-only     somebody pressed "Create tournament" and stopped
 *     one-round      a round exists, nobody is entered
 *     round+field    players, no flights
 *     flighted       flights, no scores
 *     scored         cards in
 *     completed      the committee closed it
 *
 * On 2026-09-16 `/entry` returned 500 on the FIRST of those —
 * `rounds[roundIdx] ?? rounds[0]` is undefined on an empty list and the screen
 * read `round.stroke.stageId` off it. Score entry is in the sidebar from the
 * moment a tournament exists, so that is the state every club is in for their
 * first ten minutes. The smoke pass could not see it, the 7,338 unit tests
 * could not see it, and neither could Playwright: all three run against a
 * fixture that has rounds.
 *
 * This is the combination sweep CLAUDE.md asks for on scoring code, pointed at
 * screens instead. Nothing here is wrong on its own; a screen is written
 * against the state its author had in front of them.
 *
 * WHAT IT ASSERTS, per screen per stage:
 *   - no 5xx
 *   - an <h1> (e2e/layout.spec.ts requires exactly one on every route, and
 *     only ever sees the populated case)
 *   - no NaN, undefined, Infinity or [object Object] in the rendered text
 *
 * Everything it creates is named for the mark and deleted in a finally.
 */
import { runMark } from "./run-mark.mjs";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
// Per worktree — a fixed mark lets one run's opening delete reach into a
// concurrent run's rows. See scripts/run-mark.mjs.
const MARK = runMark("zz-verify-lifecycle");
const prisma = new PrismaClient();
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v) => v + "." + createHmac("sha256", secret).update(v).digest("base64url");

let failures = 0;
const made = { orgs: [], users: [] };

/**
 * The sidebar's own links, read from `nav.ts` rather than listed here.
 *
 * A hand list goes stale the day somebody adds a screen — the same reason
 * `e2e/layout.spec.ts` sweeps the filesystem instead of curating routes, and
 * the reason its note says not to reintroduce a hand list.
 */
const HREFS = [...new Set(
  [...readFileSync("src/lib/nav.ts", "utf8").matchAll(/href: "(\/[a-z-]*)"/g)]
    .map((m) => m[1])
    .filter((h) => h !== "/me"),
)].sort();

/**
 * The dev server restarts itself near its heap limit — see CLAUDE.md — and a
 * walk of six tournaments hits that reliably. Retries the TRANSPORT failure
 * only: a 500 is an answer and is kept.
 */
async function get(url, init) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (e) {
      /**
       * PATIENT ON PURPOSE, and the budget is set by the DEV server rather
       * than by CI.
       *
       * In CI this runs against `next start` on a production build: routes are
       * already compiled, nothing restarts, and this loop never runs at all.
       * Locally it runs against `next dev`, which compiles each route on first
       * request and restarts itself near its heap limit — and this walk is
       * eight tournaments across two roles, which is several hundred requests
       * and reliably trips it more than once.
       *
       * Three attempts at 1.5s was not enough for that: a restart plus a cold
       * recompile of a heavy screen outlasts 4.5 seconds, and the script then
       * died on a healthy app. Backs off up to about half a minute, which is
       * still nothing against the walk itself.
       */
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function build(label, steps) {
  const org = await prisma.organization.create({ data: { name: `${MARK}-${label}`, kind: "club" } });
  made.orgs.push(org.id);
  // Held rather than inlined, because the two PUBLIC surfaces are addressed by
  // these tokens and nothing else — there is no session to reach them with.
  const share = randomBytes(12).toString("hex");
  const registration = randomBytes(8).toString("hex");
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK}-${label}-ev`,
      status: steps.status ?? "draft",
      /**
       * The SHAPE, because it is not decoration — `matchEvent` gates whole
       * blocks of the dashboard, renames the sidebar sections and swaps the
       * round card for a casual-round panel. A sweep that only ever built one
       * shape has walked half the app.
       *
       * `match` is the quick round: two people, one round, created from its
       * own screen in a step. It is the free tier whole product, so it is the
       * shape MOST people will ever see.
       */
      shape: steps.shape ?? "series",
      format: steps.shape === "match" ? "match" : "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: share,
      registrationToken: registration,
      /**
       * OR THE PUBLIC BOARD IS NEVER ACTUALLY WALKED.
       *
       * `/live/[token]` calls `notFound()` unless this is "public" — the token
       * is the credential and this setting is the door. The default is
       * "participants", so with it left alone every stage answered 404, the
       * walk skipped it (a non-200 is the console turning somebody away on
       * purpose) and this reported clean having rendered the spectator board
       * exactly zero times.
       *
       * Caught by asking what the two public links actually ANSWER rather than
       * trusting a clean run — the "absence of problems in an absence of
       * content" failure CLAUDE.md describes, in a check written the same hour
       * as that warning was reread.
       */
      leaderboardVisibility: "public",
      // All three or none: `fromEvent` returns null unless pars, yards AND
      // stroke index all parse, and a round with no card is a different test.
      ...(steps.card
        ? {
            customPars: JSON.stringify(new Array(18).fill(4)),
            customYards: JSON.stringify(new Array(18).fill(400)),
            customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
          }
        : {}),
    },
  });

  let stage = null;
  if (steps.rounds) {
    // A quick round is stored as a Round Robin of two, which is what the app
    // own "New match" screen creates — see `tournament-shape.ts` on why being
    // a match is recorded rather than inferred from a two-player field.
    const match = steps.shape === "match";
    stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: match ? "Round Robin" : "Stroke Play Round",
        // A TEAM format when one is asked for. These are not one engine with a
        // label on it: sides are two or four, some share a ball and some
        // aggregate two, and the allowance differs per format — see #381, where
        // Chapman shipped a pre-WHS flat 50% for months because every fixture
        // checking it used evenly-matched pairs.
        format: steps.teamFormat ?? (match ? "Match Play" : "Stroke Play"),
        holes: 18, scoringBasis: "gross", handicapAllowance: 100,
      },
    });
  }
  const flight = steps.flights
    ? (await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } })).id
    : null;

  const players = [];
  for (let i = 0; i < (steps.players ?? 0); i += 1) {
    players.push(await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${MARK} P${i}`,
        email: `${MARK}-p${i}-${randomBytes(2).toString("hex")}@example.invalid`,
        // Spread, not equal: an even field cannot tell a weighted allowance
        // from a flat one, and several screens price a side.
        handicap: 2 + i * 6,
        seed: i + 1,
        status: "confirmed",
        groupId: flight,
      },
    }));
  }
  if (steps.cards && stage && !steps.teamFormat) {
    for (const p of players) {
      await prisma.scorecard.create({
        data: {
          eventId: event.id, stageId: stage.id, playerId: p.id,
          strokes: JSON.stringify(new Array(18).fill(4)),
        },
      });
    }
  }

  /**
   * SIDES, for a team round — which is a whole side of the product with no
   * screen coverage at all.
   *
   * The seeded demo has none: `/teams` there says "No team rounds yet", so
   * `smoke-routes.mjs` has never rendered a single one. Nine formats qualify,
   * and they are structurally two things — a side of TWO that aggregates
   * separate balls, and a side of FOUR that shares one. Both are here; the
   * other seven were walked once and came back clean, and carrying all nine on
   * every push would cost more than it is worth.
   *
   * A team round's scores live in `TeamScorecard`, a different table from
   * `Scorecard` — which is exactly the difference a screen written against a
   * medal round does not know about.
   *
   * Handicaps are spread ACROSS and WITHIN the sides on purpose. An even side
   * cannot tell a weighted allowance from a flat one, which is how Chapman
   * shipped a pre-WHS flat 50% for months.
   */
  if (steps.teamFormat && stage) {
    const sideSize = steps.sideSize ?? 2;
    for (let s = 0; s * sideSize < players.length; s += 1) {
      const members = players.slice(s * sideSize, (s + 1) * sideSize);
      if (members.length < sideSize) break;
      const team = await prisma.team.create({
        data: { eventId: event.id, stageId: stage.id, name: `${MARK} Side ${s + 1}`, seed: s + 1 },
      });
      for (const [i, p] of members.entries()) {
        await prisma.teamMember.create({ data: { teamId: team.id, playerId: p.id, position: i } });
        if (steps.cards) {
          await prisma.teamScorecard.create({
            data: {
              eventId: event.id, stageId: stage.id, teamId: team.id, playerId: p.id,
              strokes: JSON.stringify(new Array(18).fill(4 + i)),
            },
          });
        }
      }
    }
  }

  /**
   * A quick round RESULT lives on the match, not on a card.
   *
   * Without the fixture the screens see a drawn match nobody has played,
   * which is a real state and the only one a match-shaped sweep would
   * otherwise reach. Fourteen holes won by A is 5&4 — decided, with four
   * holes never played, which is also the shape that exercises "the card is
   * short but the result is complete".
   */
  if (steps.shape === "match" && stage && players.length >= 2) {
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: flight ?? "",
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify(
          steps.cards
            ? [...new Array(14).fill("A"), null, null, null, null]
            : new Array(18).fill(null),
        ),
      },
    });
  }

  const user = await prisma.user.create({
    data: {
      email: `${MARK}-${label}@example.invalid`,
      name: "Lifecycle Organizer",
      password: `${randomBytes(8).toString("hex")}:unusable`,
    },
  });
  made.users.push(user.id);
  await prisma.account.create({
    data: { eventId: event.id, name: user.name, email: user.email, role: "admin" },
  });

  /**
   * A PLAYER'S LOGIN, resolved the way the app resolves one: by EMAIL against
   * the Player rows.
   *
   * The player shell is a different set of screens reached down a different
   * path, and on the early stages there is no Player row to match at all —
   * which is the same shape as the `/entry` 500 this script was written for.
   * Two of the defects found the day it was written were role-specific and
   * both were on screens BOTH roles open, which is where a role gate gets
   * forgotten.
   *
   * Takes the first player's address when the stage has a field, so they are
   * somebody IN it; otherwise an address matching nobody, which is the state
   * an early-stage player screen is least likely to have been written against.
   */
  const playerEmail = players[0]?.email ?? `${MARK}-${label}-nobody@example.invalid`;
  const playerUser = await prisma.user.create({
    data: {
      email: playerEmail,
      name: "Lifecycle Player",
      password: `${randomBytes(8).toString("hex")}:unusable`,
    },
  });
  made.users.push(playerUser.id);
  await prisma.account.create({
    data: { eventId: event.id, name: playerUser.name, email: playerEmail, role: "player" },
  });

  return {
    staff: `ng_session=${sign(user.id)}; ng_active_event=${sign(event.id)}`,
    player: `ng_session=${sign(playerUser.id)}; ng_active_event=${sign(event.id)}`,
    /**
     * THE TWO SURFACES WITH NO LOGIN AT ALL.
     *
     * `/live/[token]` is the spectator board — the link a club drops into a
     * WhatsApp group, and the widest audience anything in this app has.
     * `/register/[token]` is the sign-up form a member fills in.
     *
     * Neither is in the sidebar, so `HREFS` cannot reach them and the walk
     * above has never touched either. They are also the two screens where a
     * 500 is seen by people who have no idea who to tell.
     */
    publicPaths: [`/live/${share}`, `/register/${registration}`],
  };
}

/**
 * The player's own shell, which is not in the sidebar's staff list.
 *
 * `nav.ts` filters what a player is OFFERED; these are the screens that answer
 * when they go there. The console routes they may open are already in HREFS
 * and get walked as them too.
 */
const PLAYER_ROUTES = ["/me", "/me/board", "/me/card", "/me/money", "/me/rules", "/me/messages"];

const STAGES = [
  ["named-only", {}],
  ["one-round", { rounds: true, card: true }],
  ["round+field", { rounds: true, card: true, players: 3 }],
  ["flighted", { rounds: true, card: true, players: 3, flights: true }],
  ["scored", { rounds: true, card: true, players: 3, flights: true, cards: true }],
  ["completed", { rounds: true, card: true, players: 3, flights: true, cards: true, status: "completed" }],
  /**
   * A FIELD OF ONE, because CLAUDE.md says to start there and this walk did not.
   *
   * "Field sizes start at ONE. A one-player tournament, a two-player round
   * robin and a three-player knockout are where the off-by-ones live, and the
   * suite went no lower than a comfortable eight for a year."
   *
   * `matrix.test.ts` sweeps the ENGINES down to one. This sweeps the SCREENS,
   * and used three at every stage — which is exactly the comfortable number
   * that note is about. Flighted and scored, so the board has a single row in
   * it and the flight has a single member: "no flight of one" is an invariant
   * the draw enforces, and a screen reading a one-row board is where the
   * `rows[0]` and `length - 1` mistakes live.
   *
   * Clean when added, at one, two and three players, flighted and not. One
   * stage rather than six: the sweep pays for itself on every push and the
   * sharpest of the six is enough to keep the class shut.
   */
  ["field-of-one", { rounds: true, card: true, players: 1, flights: true, cards: true, status: "live" }],
  /**
   * TEAM ROUNDS, in their two structural shapes.
   *
   * Four-Ball is a side of TWO aggregating separate balls; Scramble is a side
   * of FOUR sharing one. The other seven team formats — Best Ball, Shamble,
   * Foursomes, Alternate Shot, Chapman / Pinehurst, Greensomes, Texas
   * Scramble — were walked once across every screen and came back clean, and
   * carrying all nine on every push would cost more than it is worth.
   *
   * Four sides, so a board has something to rank rather than one row.
   */
  ["team-pairs", { rounds: true, card: true, players: 4, flights: true, cards: true, status: "live", teamFormat: "Four-Ball", sideSize: 2 }],
  ["team-fours", { rounds: true, card: true, players: 8, flights: true, cards: true, status: "live", teamFormat: "Scramble", sideSize: 4 }],
  /**
   * THE QUICK ROUND, which is a different SHAPE and not a small tournament.
   *
   * `matchEvent` gates whole blocks of the dashboard, renames the sidebar
   * sections — "Playing" rather than "Manage" — and swaps the round card for
   * a casual-round panel. A sweep that only ever built one shape has walked
   * half the app, and this is the half the free tier lives in, so it is the
   * shape most people will ever see.
   */
  ["match-fresh", { shape: "match", rounds: true, card: true, players: 2, flights: true, status: "live" }],
  ["match-played", { shape: "match", rounds: true, card: true, players: 2, flights: true, cards: true, status: "live" }],
];

const JUNK = ["NaN", "undefined", "Infinity", "[object Object]"];

async function main() {
  try {
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });

    console.log(`Verifying against ${BASE}`);
    console.log(
      `${HREFS.length} screens x ${STAGES.length} stages — as staff, as a player, and the two public links\n`,
    );

    for (const [label, steps] of STAGES) {
      const { staff, player, publicPaths } = await build(label, steps);
      const bad = [];

      /**
       * BOTH ROLES. A player sees a different set of screens down a different
       * path, and the screens they share with staff are where a role gate gets
       * forgotten — both role defects found the day this was written were on
       * shared screens.
       */
      const walk = async (cookie, routes, who) => {
        for (const h of routes) {
          const res = await get(`${BASE}${h}`, { headers: { cookie }, redirect: "manual" });
          if (res.status >= 500) { bad.push(`${who}${h} -> ${res.status}`); continue; }
          // A redirect is the console turning somebody away on purpose.
          if (res.status !== 200) continue;
          const html = await res.text();
          if (!/<h1[^>]*>/.test(html)) bad.push(`${who}${h} -> no h1`);
          const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
          for (const k of JUNK) if (text.includes(k)) bad.push(`${who}${h} -> ${k}`);
        }
      };
      await walk(staff, HREFS, "");
      await walk(player, [...HREFS, ...PLAYER_ROUTES], "as player ");
      // No cookie at all: these answer to a token and to nobody in particular.
      await walk("", publicPaths, "public ");

      /**
       * AND THEY HAVE TO HAVE ANSWERED, or the walk skipped them.
       *
       * `walk` inspects a 200 and passes over anything else, because a
       * redirect is the console turning somebody away on purpose. That makes
       * "every public page was fine" and "no public page was ever rendered"
       * the same output — and the first version of this was the second one:
       * `leaderboardVisibility` defaults to "participants", `/live` answered
       * 404 at every stage, and the spectator board was walked zero times.
       *
       * So require a 200 from each. If a later change closes one of these
       * doors, this says so instead of quietly covering nothing.
       */
      for (const path of publicPaths) {
        const res = await get(`${BASE}${path}`, { redirect: "manual" });
        if (res.status !== 200) {
          bad.push(`public ${path.split("/")[1]} answered ${res.status} — nothing was checked`);
        }
      }

      /**
       * AND A TEAM STAGE HAS TO HAVE BUILT SIDES.
       *
       * `/teams` renders "No team rounds yet" for a round that is not one, and
       * that page is a 200 with a heading — so a team stage whose sides failed
       * to build walks clean past every check above while rendering the empty
       * state. Same shape as the public board answering 404: the output cannot
       * tell covered from skipped.
       */
      if (steps.teamFormat) {
        const teams = await get(`${BASE}/teams`, { headers: { cookie: staff }, redirect: "manual" });
        if (teams.status === 200) {
          const shown = await teams.text();
          if (!shown.includes(`${MARK} Side`)) {
            bad.push("no side ever rendered on /teams — the team round was not built");
          }
        }
      }

      /**
       * AND THE PLAYER HAS TO ACTUALLY BE ONE.
       *
       * If the role did not take — a wrong `role`, a session resolving to the
       * admin — the second walk would repeat the first, every screen would
       * return 200, and this would report clean while covering nothing new.
       * Same quiet failure the shape control below exists for.
       *
       * The organizer's status card is the tell: it is `isStaff` gated, so a
       * real player never sees it and staff on a series event always do.
       */
      if (steps.shape !== "match") {
        const asPlayer = await get(`${BASE}/dashboard`, { headers: { cookie: player }, redirect: "manual" });
        if (asPlayer.status === 200 && (await asPlayer.text()).includes("Tournament status")) {
          bad.push("role did not take: the player sees the organizer's status card");
        }
      }
      const cookie = staff;
      /**
       * THE SHAPE HAS TO HAVE TAKEN EFFECT, or these are the same walk twice.
       *
       * A match-shaped event and a series-shaped one render different
       * dashboards: `matchEvent` calls the round "The match", names the
       * sidebar section "Playing" rather than "Manage", and drops the
       * organizer status card entirely. If a fixture failed to become a match
       * — a wrong `shape`, a missing stage — every screen would still return
       * 200 and this walk would report clean while covering nothing new.
       *
       * Measured rather than assumed: series renders "Tournament status" and
       * not "The match"; match renders "The match" and not "Tournament status".
       */
      const dash = await get(`${BASE}/dashboard`, { headers: { cookie }, redirect: "manual" });
      if (dash.status === 200) {
        const shown = (await dash.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
        const wantMatch = steps.shape === "match";
        const isMatch = shown.includes("The match");
        if (isMatch !== wantMatch) {
          bad.push(`shape did not take: /dashboard ${isMatch ? "is" : "is not"} a match, expected ${wantMatch ? "match" : "series"}`);
        }
      }

      failures += bad.length;
      console.log(`  ${bad.length === 0 ? "ok  " : "FAIL"}  ${label.padEnd(12)} ${bad.join("   ")}`);
    }

    /**
     * THE CONTROL. A walker that cannot see a bad status reports every stage
     * clean, which is the same output as an app with nothing wrong with it.
     * Ask for a route that does not exist and require the walker to notice.
     */
    const cookie = await build("control", {});
    const missing = await get(`${BASE}/zz-no-such-screen`, { headers: { cookie }, redirect: "manual" });
    const seesIt = missing.status === 404;
    if (!seesIt) failures += 1;
    console.log(`  ${seesIt ? "ok  " : "FAIL"}  control       a missing route reads as ${missing.status}, expected 404`);

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  } finally {
    for (const id of made.users) await prisma.user.deleteMany({ where: { id } });
    for (const id of made.orgs) await prisma.organization.deleteMany({ where: { id } });
    await prisma.$disconnect();
    console.log("Fixtures removed.");
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
