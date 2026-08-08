/**
 * Ask every screen to render, and fail on the ones that don't.
 *
 * The gap this closes: nothing in the test suite renders a server component.
 * tsc doesn't either — it happily accepts a `const` read above its own
 * declaration when the read sits inside a closure, because a closure *might*
 * run later. A callback passed to .map() runs immediately. That is how Rounds
 * & formats shipped throwing "Cannot access 'attendanceMode' before
 * initialization" on every render, with 985 green tests and a clean build.
 *
 * It was not a quiet failure either. Saving a score revalidates the whole
 * layout, so the router refetched that broken route after every keystroke and
 * no score could be entered anywhere in the app. A single GET would have
 * caught it.
 *
 * So: seed the smallest tournament that exercises the real code paths, sign in
 * as its organizer, and GET every route the app defines. A 5xx fails the run.
 * 3xx is fine — a guard redirecting is a screen doing its job.
 *
 * The route list is read off the filesystem rather than typed out here, so a
 * screen added tomorrow is covered without anyone remembering to add it.
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const APP_DIR = "src/app";
const MARK = "ci-smoke";

// Local .env for developer runs; in CI the variables are already exported.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}

/** Every directory holding a page.tsx, as a URL path. */
function routesUnder(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // Route groups like (app) organise files without appearing in the URL.
    const isGroup = name.startsWith("(") && name.endsWith(")");
    const segment = isGroup ? prefix : `${prefix}/${name}`;
    const full = join(dir, name);
    if (existsSync(join(full, "page.tsx"))) out.push(segment || "/");
    out.push(...routesUnder(full, segment));
  }
  return out;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const made = { orgId: null, eventId: null, userId: null, token: null };

  try {
    // ── Seed ────────────────────────────────────────────────────────────
    // Enough tournament that the screens have something to render: a field,
    // a round, flights and a match. Screens that divide by a player count or
    // read rows[0] need rows to exist for this to prove anything.
    const org = await prisma.organization.create({
      data: { name: `${MARK}-club`, kind: "club" },
    });
    made.orgId = org.id;
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-event`,
        organizationId: org.id,
        status: "active",
        shape: "single",
        dates: "May 1, 2026",
        course: "",
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        shareToken: randomBytes(12).toString("hex"),
      },
    });
    made.eventId = event.id;
    made.token = event.shareToken;
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        description: "",
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
      },
    });
    const group = await prisma.group.create({
      data: { eventId: event.id, name: "Flight 1", position: 0 },
    });
    const players = [];
    for (const [i, name] of ["Smoke One", "Smoke Two"].entries()) {
      players.push(
        await prisma.player.create({
          data: {
            eventId: event.id,
            name,
            email: `${MARK}-p${i}@example.invalid`,
            handicap: 10 + i,
            seed: i + 1,
            status: "confirmed",
            groupId: group.id,
          },
        }),
      );
    }
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: group.id,
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `${MARK}@example.invalid`,
        name: "Smoke Organizer",
        // Never signed in with — the session cookie is minted directly below.
        password: `${randomBytes(8).toString("hex")}:unusable`,
      },
    });
    made.userId = user.id;
    await prisma.account.create({
      data: { eventId: event.id, name: user.name, email: user.email, role: "admin" },
    });

    // Same scheme as src/lib/auth.ts — a signed user id, nothing more.
    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const mac = createHmac("sha256", secret).update(user.id).digest("base64url");
    const cookie = `ng_session=${user.id}.${mac}`;

    // ── Walk ────────────────────────────────────────────────────────────
    // "/" lives at src/app/page.tsx, which the directory walk never visits.
    const routes = [...new Set(["/", ...routesUnder(APP_DIR)])]
      .map((r) => (r.includes("[token]") ? r.replace("[token]", made.token) : r))
      // Remaining dynamic segments have no meaningful value to supply.
      .filter((r) => !r.includes("["))
      .sort();

    console.log(`Smoke-testing ${routes.length} routes against ${BASE}\n`);
    const failures = [];
    for (const route of routes) {
      let status = 0;
      let detail = "";
      try {
        const res = await fetch(BASE + route, {
          headers: { Cookie: cookie },
          redirect: "manual",
        });
        status = res.status;
        // A server component that throws renders the error page, so the body
        // carries the reason where the status alone would just say 500.
        if (status >= 500) detail = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
      } catch (err) {
        detail = err.message;
      }
      const ok = status > 0 && status < 500;
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${String(status).padEnd(4)} ${route}`);
      if (!ok) failures.push({ route, status, detail });
    }

    if (failures.length) {
      console.error(`\n${failures.length} route(s) failed to render:\n`);
      for (const f of failures) console.error(`  ${f.route} → ${f.status}\n    ${f.detail}\n`);
      process.exitCode = 1;
    } else {
      console.log(`\nAll ${routes.length} routes rendered.`);
    }
  } finally {
    // Always, even on failure — a half-seeded database poisons the next run,
    // and on a developer's machine this is their real data directory.
    if (made.eventId) {
      await prisma.match.deleteMany({ where: { eventId: made.eventId } });
      await prisma.player.deleteMany({ where: { eventId: made.eventId } });
      await prisma.group.deleteMany({ where: { eventId: made.eventId } });
      await prisma.stage.deleteMany({ where: { eventId: made.eventId } });
      await prisma.account.deleteMany({ where: { eventId: made.eventId } });
      await prisma.event.delete({ where: { id: made.eventId } });
    }
    if (made.orgId) await prisma.organization.delete({ where: { id: made.orgId } });
    if (made.userId) await prisma.user.delete({ where: { id: made.userId } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
