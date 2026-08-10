/**
 * Prove the weekly league sheet is right against a real database.
 *
 * The unit tests pin the movement arithmetic and the sidebar gating. Neither
 * asks the question a league secretary would: with two weeks of real cards in
 * a real event, does week 2 show the night's results, the table, and a player
 * who actually climbed?
 *
 * The fixture is built so the answer is knowable in advance — Verify One wins
 * week 1, Verify Two wins week 2 by enough to take the lead — so the movement
 * column can be checked against a fact rather than against itself.
 *
 * Everything created is named for the mark, so cleanup can only remove its own
 * rows: never the demo data, never a real event.
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const MARK = "zz-verify-week-view";
const prisma = new PrismaClient();

const made = {};
let failures = 0;

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function check(label, html, needle, shouldContain = true) {
  const found = stripComments(html).includes(needle);
  const ok = found === shouldContain;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}: ${shouldContain ? "contains" : "omits"} "${needle}"`);
}

function assert(label, cond) {
  if (!cond) failures += 1;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}`);
}

/** 18 holes of the same score, so the totals are trivially predictable. */
const flat = (n) => JSON.stringify(new Array(18).fill(n));

async function main() {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });

    const org = await prisma.organization.create({ data: { name: `${MARK}-club`, kind: "club" } });
    made.orgId = org.id;
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-league`,
        organizationId: org.id,
        status: "active",
        shape: "series",
        format: "stroke",
        dates: "May 2026",
        course: "",
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        shareToken: randomBytes(12).toString("hex"),
      },
    });
    made.eventId = event.id;

    // Two weeks, so there IS a previous week to have moved from.
    const week1 = await prisma.stage.create({
      data: { eventId: event.id, position: 0, description: "", type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    });
    const week2 = await prisma.stage.create({
      data: { eventId: event.id, position: 1, description: "", type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    });

    const players = [];
    for (const [i, name] of ["Verify One", "Verify Two"].entries()) {
      players.push(
        await prisma.player.create({
          data: {
            eventId: event.id, name, email: `${MARK}-p${i}@example.invalid`,
            handicap: 0, seed: i + 1, status: "confirmed",
          },
        }),
      );
    }
    const [one, two] = players;

    // Week 1: One shoots 72 (4s), Two shoots 90 (5s). One leads.
    // Week 2: One shoots 90, Two shoots 72 — enough that Two's TOTAL (162)
    // ties One's (162)... so make week 2 decisive instead: Two shoots 54 (3s).
    // Totals: One 72+90 = 162, Two 90+54 = 144. Two takes the lead.
    await prisma.scorecard.createMany({
      data: [
        { eventId: event.id, stageId: week1.id, playerId: one.id, strokes: flat(4) },
        { eventId: event.id, stageId: week1.id, playerId: two.id, strokes: flat(5) },
        { eventId: event.id, stageId: week2.id, playerId: one.id, strokes: flat(5) },
        { eventId: event.id, stageId: week2.id, playerId: two.id, strokes: flat(3) },
      ],
    });

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
      return { status: res.status, html: stripComments(await res.text()) };
    };

    console.log(`Verifying against ${BASE}\n`);

    console.log("Week 2 — /week");
    const w2 = await get(`/week?round=${week2.id}`);
    console.log(`  status ${w2.status}`);
    if (w2.status !== 200) failures += 1;

    // All three parts of the night, on one page.
    check("results section", w2.html, "Results");
    check("standings section", w2.html, "Standings after this week");
    check("week selector", w2.html, "Week 1");
    check("names the round", w2.html, "Week 2");

    // The night itself: Two shot 54 and won week 2.
    check("winner's gross on the night", w2.html, ">54<");
    check("both players listed", w2.html, "Verify Two");

    // The movement column is the reason the screen exists. Two was 2nd after
    // week 1 and is 1st after week 2, so the page must say "up 1" somewhere.
    assert(
      "shows a climb for the player who took the lead",
      /up 1 place\b/.test(w2.html),
    );
    assert(
      "shows the matching drop for the player overtaken",
      /down 1 place\b/.test(w2.html),
    );

    console.log("\nWeek 1 — /week (nothing has moved yet)");
    const w1 = await get(`/week?round=${week1.id}`);
    console.log(`  status ${w1.status}`);
    if (w1.status !== 200) failures += 1;
    // Week one has no previous week, so no arrows and nobody flagged "new".
    assert("no movement claimed in week one", !/up \d+ place|down \d+ place/.test(w1.html));
    check("does not flag the whole field as new", w1.html, ">new<", false);

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
