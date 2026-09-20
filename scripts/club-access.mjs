/**
 * HOW TO GET INTO THE SEEDED CLUB, without reseeding it.
 *
 * `seed-club.mjs` prints sign-in cookies when it builds the club — and then
 * they go stale the moment anything reseeds, and the only way to get them back
 * was to reseed again, which rebuilds the very fixture you were about to walk.
 * This reads the rows that are already there and prints the way in.
 *
 * READ-ONLY. It creates nothing, changes nothing and deletes nothing, and it
 * refuses any database whose host is not localhost — checked on the host,
 * because a password can contain the word.
 *
 *   node --env-file=.env scripts/club-access.mjs
 *
 * THE SEEDED ACCOUNTS HAVE NO PASSWORD. `seed-club.mjs` gives them
 * `password: "x:unusable"` deliberately, so there is nothing to type into a
 * sign-in form — the way in is a signed session cookie, which is what this
 * prints.
 *
 * AND BOTH COOKIES ARE HttpOnly WHEN THE SERVER SETS THEM (`COOKIE_OPTS` in
 * `lib/auth.ts`). That has one consequence worth knowing before you paste
 * anything: `document.cookie` can create these names in a browser that does
 * not have them yet, and CANNOT overwrite one the server has already set. So
 * clear the site's cookies first, and switch tournaments with the app's own
 * switcher rather than by pasting a second time — see the note in CLAUDE.md
 * about the fifteen tool calls that went into a defect that did not exist,
 * because the tab was holding somebody else's session.
 */
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

const url = process.env.DATABASE_URL || "";
const host = url.replace(/^[a-z]+:\/\//, "").split("@").pop().split("/")[0].split(":")[0];
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.log(`REFUSED: DATABASE_URL points at ${host}, not localhost.`);
  process.exit(1);
}

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const prisma = new PrismaClient();

const events = await prisma.event.findMany({
  where: { name: { startsWith: "zz-club-" } },
  select: {
    id: true,
    name: true,
    status: true,
    shareToken: true,
    _count: { select: { stages: true, players: true } },
  },
  orderBy: { createdAt: "asc" },
});

if (events.length === 0) {
  console.log("No seeded club in this database. Build one with:");
  console.log("  node --env-file=.env scripts/seed-club.mjs");
  await prisma.$disconnect();
  process.exit(0);
}

const short = (n) => n.replace(/^zz-club-[0-9a-f]+-/, "");
const organizer = await prisma.user.findFirst({
  where: { email: { contains: "secretary@example.invalid" } },
  select: { id: true, name: true, email: true },
});
const player = await prisma.user.findFirst({
  where: { email: { contains: "m00@example.invalid" } },
  select: { id: true, name: true, email: true },
});
// The one to land on: a live tournament with a round actually in progress.
const landing = events.find((e) => e.name.includes("April Medal")) ?? events[0];

console.log(`\n${events.length} tournaments in the seeded club, at ${BASE}\n`);
for (const e of events) {
  console.log(
    "  " +
      short(e.name).slice(0, 44).padEnd(46) +
      e.status.padEnd(14) +
      `${e._count.stages} rounds`.padEnd(11) +
      `${e._count.players} entrants`,
  );
}

console.log("\n── PUBLIC BOARDS — no sign-in at all, just open the link ──────────────\n");
for (const e of events.filter((x) => x.shareToken)) {
  console.log(`  ${BASE}/live/${e.shareToken}`);
  console.log(`      ${short(e.name)}`);
}

console.log("\n── SIGNING IN ─────────────────────────────────────────────────────────");
console.log("\n  1. Open the browser console on " + BASE);
console.log("  2. CLEAR this site's cookies first — the server sets these names HttpOnly,");
console.log("     and document.cookie cannot overwrite one that is already there.");
console.log("  3. Paste BOTH lines for whichever of the two you want to be, then reload.\n");

for (const [who, user, start] of [
  ["ORGANIZER — the console", organizer, "/dashboard"],
  ["PLAYER — the player app", player, "/me"],
]) {
  if (!user) continue;
  console.log(`  ${who}   ${user.name} <${user.email}>`);
  console.log(`    document.cookie='ng_session=${sign(user.id)}; path=/'`);
  console.log(`    document.cookie='ng_active_event=${sign(landing.id)}; path=/'`);
  console.log(`    then reload and go to ${start}\n`);
}

console.log("  SWITCH TOURNAMENTS with the app's own switcher, not by pasting again:");
console.log("    player    /me/events");
console.log("    organizer /tournaments, then Manage\n");

await prisma.$disconnect();
