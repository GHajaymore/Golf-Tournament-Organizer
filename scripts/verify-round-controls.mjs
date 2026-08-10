/**
 * Prove the new round-configuration controls actually reach the screen.
 *
 * The unit tests pin the components' contract and the smoke test proves every
 * route returns 200, but neither asks the real question: with a real
 * greensomes round in a real database, does the split control render, and does
 * it say 60 / 40? This seeds exactly that, reads the HTML the server sends,
 * and deletes its fixtures in a finally.
 *
 * Everything it creates is named for the mark, so the cleanup can only ever
 * remove its own rows — never the demo data and never a real event.
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const MARK = "zz-verify-round-controls";
const prisma = new PrismaClient();

const made = {};
let failures = 0;

/**
 * React splits interpolated text with HTML comments during server rendering,
 * so `best {n} of {max}` arrives as `best <!-- -->1<!-- --> of <!-- -->2`.
 * A reader sees the joined sentence, so match against that.
 */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function check(label, html, needle, shouldContain = true) {
  const found = stripComments(html).includes(needle);
  const ok = found === shouldContain;
  if (!ok) failures += 1;
  const verb = shouldContain ? "contains" : "omits";
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}: ${verb} "${needle}"`);
}

async function main() {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });

    const org = await prisma.organization.create({ data: { name: `${MARK}-club`, kind: "club" } });
    made.orgId = org.id;
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-event`,
        organizationId: org.id,
        status: "active",
        shape: "series",
        dates: "May 1, 2026",
        course: "",
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        shareToken: randomBytes(12).toString("hex"),
      },
    });
    made.eventId = event.id;

    // Two team rounds, chosen because they exercise opposite branches:
    // greensomes is scored by a per-player split and shares one ball;
    // four-ball aggregates two separate balls and takes a flat allowance.
    const greensomes = await prisma.stage.create({
      data: {
        eventId: event.id, position: 0, description: "",
        type: "Round Robin", format: "Greensomes", holes: 18,
      },
    });
    const fourBall = await prisma.stage.create({
      data: {
        eventId: event.id, position: 1, description: "",
        type: "Round Robin", format: "Four-Ball", holes: 18,
      },
    });

    // A side needs real members for the screen to price it.
    const players = [];
    for (const [i, name] of ["Verify One", "Verify Two"].entries()) {
      players.push(
        await prisma.player.create({
          data: {
            eventId: event.id, name, email: `${MARK}-p${i}@example.invalid`,
            handicap: 10 + i * 10, seed: i + 1, status: "confirmed",
          },
        }),
      );
    }
    for (const stageId of [greensomes.id, fourBall.id]) {
      const team = await prisma.team.create({
        data: { eventId: event.id, stageId, name: "Side A", seed: 1 },
      });
      await prisma.teamMember.createMany({
        data: players.map((p, pos) => ({ teamId: team.id, playerId: p.id, position: pos })),
      });
    }

    const user = await prisma.user.create({
      data: {
        email: `${MARK}@example.invalid`,
        name: "Verify Organizer",
        password: `${randomBytes(8).toString("hex")}:unusable`,
      },
    });
    made.userId = user.id;
    await prisma.account.create({
      data: { eventId: event.id, name: user.name, email: user.email, role: "admin" },
    });

    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const mac = createHmac("sha256", secret).update(user.id).digest("base64url");
    const cookie = `ng_session=${user.id}.${mac}`;

    const get = async (path) => {
      const res = await fetch(BASE + path, { headers: { cookie }, redirect: "follow" });
      return { status: res.status, html: await res.text() };
    };

    console.log(`Verifying against ${BASE}\n`);

    // Both rounds render as cards on the SAME page now. These settings used to
    // live on /teams, which had its own round selector — so a round's format
    // was chosen in one place and priced in another, with neither screen
    // mentioning the other. One page, one round selector, one home.
    console.log("Rounds & formats — /stages (both rounds on one page)");
    const s = await get("/stages");
    console.log(`  status ${s.status}`);

    // Greensomes: scored by a per-player split, one ball.
    check("split control", s.html, "Handicap split");
    check("recommended split", s.html, "60 / 40");
    check("split info button", s.html, "More about the handicap split");

    // Four-Ball: flat allowance, two balls aggregated.
    check("count control", s.html, "Scores that count");
    check("default count", s.html, "best 1 of 2");
    check("count info button", s.html, "More about how many scores count");

    // Every team round is priced somehow, so the allowance is never hidden.
    check("allowance", s.html, "Handicap allowance");
    // On the card face, not behind "Customize this round" — that panel is
    // closed until opened, and what a round plays off is not an advanced tweak.
    check("round card renders", s.html, "Customize this round");

    // Teams keeps who-is-on-which-side, and points at where the terms are set
    // rather than pretending they are not set anywhere.
    console.log("\nTeams & pairs — /teams (no longer edits round settings)");
    const t = await get(`/teams?round=${fourBall.id}`);
    console.log(`  status ${t.status}`);
    check("summary of the terms", t.html, "Handicap allowance");
    check("points at the round", t.html, 'href="/stages"');
    check("no editing here", t.html, 'aria-label="Handicap allowance percent"', false);

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  } finally {
    if (made.eventId) await prisma.event.deleteMany({ where: { id: made.eventId } });
    if (made.userId) await prisma.user.deleteMany({ where: { id: made.userId } });
    if (made.orgId) await prisma.organization.deleteMany({ where: { id: made.orgId } });
    await prisma.$disconnect();
    console.log("Fixtures removed.");
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
