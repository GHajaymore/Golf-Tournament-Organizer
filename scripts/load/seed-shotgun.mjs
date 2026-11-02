#!/usr/bin/env node
/**
 * THE FIELD FOR THE SHOTGUN LOAD TEST — made, and taken away again.
 *
 *     node --env-file=.env scripts/load/seed-shotgun.mjs              # make it (local database)
 *     node --env-file=.env scripts/load/seed-shotgun.mjs --teardown   # take every zz-load row away
 *     PLAYERS=24 node --env-file=.env scripts/load/seed-shotgun.mjs   # a smaller field
 *
 * One throwaway club, one live nine-hole medal scored by round code with a
 * public board, and 144 invented players (`zz-load` on every row,
 * `@example.invalid` addresses, names from a list of nobody). Writes the plan
 * the k6 script reads to `.qa/load/shotgun-plan.json`: the round code, the
 * board's token, the players' ids and the pars. No secret is in it.
 *
 * WHICH DATABASE: the one DATABASE_URL names, and ONLY if it is this machine's
 * (localhost) or the caller has named its host in LOAD_DATABASE_HOST — so a
 * preview's database is a deliberate act, typed out, and production cannot be
 * reached by a variable left over in a shell. It refuses on Vercel's
 * production environment outright. A load test writes 144 cards; production
 * holds real members, and nothing written there can be undone from here
 * (CLAUDE.md, hard rule 1).
 *
 * Run --teardown when the test is done, every time: a field left in a database
 * is a field somebody later mistakes for a real one.
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARK = "zz-load";
const TEARDOWN = process.argv.includes("--teardown");
const PLAYERS = Math.max(1, Math.min(Number(process.env.PLAYERS || 144), 400));
const HOLES = 9;
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";

// ── Which database ─────────────────────────────────────────────────────────
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  console.error("seed-shotgun: DATABASE_URL is not set or not a URL. Run it as: node --env-file=.env scripts/load/seed-shotgun.mjs");
  process.exit(2);
}
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
if (process.env.VERCEL_ENV === "production") {
  console.error("seed-shotgun: refusing — this is Vercel's production environment.");
  process.exit(2);
}
if (!local && process.env.LOAD_DATABASE_HOST !== host) {
  console.error(`seed-shotgun: refusing to write to ${host}. A database that is not this machine's is used only when its host is typed out: LOAD_DATABASE_HOST=${host} — and only for a PREVIEW's copy, never production (README.md).`);
  process.exit(2);
}

const prisma = new PrismaClient();
const FIRST = ["Ailsa", "Brodie", "Calum", "Effie", "Fergus", "Greer", "Hamish", "Isla", "Jock", "Kirsty", "Lachlan", "Morag", "Niall", "Oona", "Ruaridh", "Seona"];
const LAST = ["Abernethy", "Balfour", "Cairney", "Dalgleish", "Elphin", "Forsyth", "Gilmour", "Halkett", "Inglis"];

async function teardown() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  const events = await prisma.event.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
  await prisma.event.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${MARK}-` } } });
  return { clubs: ids.length, tournaments: events.length };
}

try {
  const gone = await teardown();
  if (TEARDOWN) {
    console.log(`seed-shotgun: took away ${gone.clubs} club(s) and ${gone.tournaments} tournament(s) marked ${MARK}.`);
  } else {
    const run = Date.now().toString(36);
    const code = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
    const org = await prisma.organization.create({ data: { name: `${MARK} ${run} Golf Society`, kind: "society" } });
    const sec = await prisma.user.create({ data: { email: `${MARK}-${run}-secretary@example.invalid`, name: "Zz Load Secretary", password: "x:unusable" } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: sec.id, role: "owner" } });
    const today = new Date().toISOString().slice(0, 10);
    const event = await prisma.event.create({
      data: {
        name: `${MARK} ${run} Saturday Shotgun`,
        organizationId: org.id,
        status: "live",
        format: "stroke",
        dates: "",
        startOn: today,
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${MARK}-${run}-board`,
        capacity: PLAYERS,
        playerAccess: "code",
        scoreEntryBy: "players",
        scoreEntryWindow: "during",
        leaderboardVisibility: "public",
        customPars: JSON.stringify([...PARS, ...PARS]),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    await prisma.account.create({ data: { eventId: event.id, name: "Zz Load Secretary", email: sec.email, role: "admin" } });
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: HOLES, scoringBasis: "gross", description: "Shotgun", accessCode: code, playedOn: today },
    });
    const players = [];
    for (let i = 0; i < PLAYERS; i += 1) {
      const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${i + 1}`;
      const p = await prisma.player.create({ data: { eventId: event.id, name, email: `${MARK}-${run}-p${i + 1}@example.invalid`, seed: i + 1, status: "confirmed", handicap: (i * 7) % 28 } });
      players.push({ id: p.id });
    }
    const out = join(".qa", "load");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "shotgun-plan.json"), JSON.stringify({ made: new Date().toISOString(), database: host, code, shareToken: event.shareToken, holes: HOLES, pars: PARS, players }, null, 1));
    console.log(`seed-shotgun: ${PLAYERS} players in "${event.name}" on ${host}; round code ${code}; board /live/${event.shareToken}.`);
    console.log(`seed-shotgun: plan written to ${join(out, "shotgun-plan.json")}. Take it away afterwards: --teardown`);
  }
} finally {
  await prisma.$disconnect();
}
