/**
 * Throwaway QA harness — seeds an isolated org/user/event, prints a session
 * cookie, and tears everything down on `down`. Never touches existing rows.
 *
 *   node .qa-tmp.mjs up      → seed, print cookie + ids
 *   node .qa-tmp.mjs down    → delete everything marked qa-flow
 *   node .qa-tmp.mjs cookie  → reprint the cookie for the seeded user
 *   node .qa-tmp.mjs dump <eventId>  → dump event state as JSON
 */
import { existsSync, readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const MARK = "qa-flow";
const cmd = process.argv[2] ?? "up";

const cookieFor = (userId) =>
  `ng_session=${userId}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(userId).digest("base64url")}`;

async function down() {
  const events = await prisma.event.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true },
  });
  // Every child row cascades from Event in the schema, so one delete is enough.
  for (const e of events) {
    try {
      await prisma.event.delete({ where: { id: e.id } });
    } catch (err) {
      console.error(`could not delete event ${e.id}: ${err.message}`);
    }
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  console.log(`cleaned ${events.length} event(s)`);
}

async function up() {
  await down();
  const org = await prisma.organization.create({ data: { name: `${MARK}-club`, kind: "club" } });
  const user = await prisma.user.create({
    data: {
      email: `${MARK}@example.invalid`,
      name: "QA Organizer",
      password: `${randomBytes(8).toString("hex")}:unusable`,
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });
  console.log(JSON.stringify({ orgId: org.id, userId: user.id, cookie: cookieFor(user.id) }, null, 1));
}

async function dump(eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  const stages = await prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } });
  const groups = await prisma.group.findMany({ where: { eventId }, orderBy: { position: "asc" } });
  const players = await prisma.player.findMany({ where: { eventId }, orderBy: { seed: "asc" } });
  const matches = await prisma.match.findMany({ where: { eventId } });
  console.log(JSON.stringify({ event, stages, groups, players, matches }, null, 1));
}

try {
  if (cmd === "up") await up();
  else if (cmd === "down") await down();
  else if (cmd === "cookie") {
    const u = await prisma.user.findUnique({ where: { email: `${MARK}@example.invalid` } });
    console.log(u ? cookieFor(u.id) : "no qa user");
  } else if (cmd === "dump") await dump(process.argv[3]);
  else console.error("unknown command");
} finally {
  await prisma.$disconnect();
}
