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
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function build(label, steps) {
  const org = await prisma.organization.create({ data: { name: `${MARK}-${label}`, kind: "club" } });
  made.orgs.push(org.id);
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
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
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
        format: match ? "Match Play" : "Stroke Play",
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
  if (steps.cards && stage) {
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
  return `ng_session=${sign(user.id)}; ng_active_event=${sign(event.id)}`;
}

const STAGES = [
  ["named-only", {}],
  ["one-round", { rounds: true, card: true }],
  ["round+field", { rounds: true, card: true, players: 3 }],
  ["flighted", { rounds: true, card: true, players: 3, flights: true }],
  ["scored", { rounds: true, card: true, players: 3, flights: true, cards: true }],
  ["completed", { rounds: true, card: true, players: 3, flights: true, cards: true, status: "completed" }],
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
    console.log(`${HREFS.length} screens x ${STAGES.length} stages\n`);

    for (const [label, steps] of STAGES) {
      const cookie = await build(label, steps);
      const bad = [];
      for (const h of HREFS) {
        const res = await get(`${BASE}${h}`, { headers: { cookie }, redirect: "manual" });
        if (res.status >= 500) { bad.push(`${h} -> ${res.status}`); continue; }
        // A redirect is the console turning somebody away on purpose.
        if (res.status !== 200) continue;
        const html = await res.text();
        if (!/<h1[^>]*>/.test(html)) bad.push(`${h} -> no h1`);
        const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
        for (const k of JUNK) if (text.includes(k)) bad.push(`${h} -> ${k}`);
      }
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
        const shown = (await dash.text()).replace(/<[^>]*>/g, " ").replace(/s+/g, " ");
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
