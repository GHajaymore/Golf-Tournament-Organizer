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

    console.log("Greensomes round — /teams");
    const g = await get(`/teams?round=${greensomes.id}`);
    console.log(`  status ${g.status}`);
    check("split control", g.html, "Handicap split");
    check("recommended split", g.html, "60 / 40");
    check("info button", g.html, "More about the handicap split");
    check("no count control (one ball)", g.html, "Scores that count", false);

    console.log("\nFour-Ball round — /teams");
    const f = await get(`/teams?round=${fourBall.id}`);
    console.log(`  status ${f.status}`);
    check("count control", f.html, "Scores that count");
    check("default count", f.html, "best 1 of 2");
    check("info button", f.html, "More about how many scores count");
    check("no split control (flat allowance)", f.html, "Handicap split", false);

    // /stages is deliberately not asserted for the cut-line info button. That
    // section lives inside the "Customize this round" panel, which is closed
    // until someone opens it, so it is correctly absent from the first render
    // — asserting it here would only encode a misunderstanding. The component
    // itself is covered by the styleguide and by render.test.tsx.
    console.log("\nRounds & format — /stages");
    const s = await get("/stages");
    console.log(`  status ${s.status}`);
    check("round card renders", s.html, "Customize this round");

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
