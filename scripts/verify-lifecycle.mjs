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
      shape: "series",
      format: "stroke",
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
    stage = await prisma.stage.create({
      data: {
        eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play",
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
