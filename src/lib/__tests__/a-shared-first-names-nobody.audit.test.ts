import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, computeHighlights } from "@/lib/services/tournament";

/**
 * A SHARED FIRST PLACE NAMES NOBODY (2026-11-07), on real rows.
 *
 * The Leader / Winner card read the top ROW of the board, and the top row of a
 * tie is only first in the list. Once three players who beat each other in a
 * circle share 1st (`level-places.ts`), "Ann won on 4 pts" named the earliest
 * entry champion over a board printing 1, 1, 1 — the entry-order fault back in
 * one card. The committee settles a single title; `suggestChampion` already
 * refuses one while `leaders.length > 1`.
 *
 * Round robin, worked by hand (win 2, halve 1, loss 0; every match 1 up):
 *   Ann b Bea, Bea b Cat, Cat b Ann — each 2 points; mini-league 0, 0, 0; each
 *   won 1 hole and lost 1; holes lost 1 each. They share 1st.
 * Medal: Ann and Bea return identical cards; no countback separates them.
 *
 *   npx vitest run --config vitest.audit.config.ts a-shared-first-names-nobody
 */

const prisma = new PrismaClient();
const TAG = "zz-shared-first";
const PARS = new Array(18).fill(4);
let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function event(name: string, data: Record<string, unknown>) {
  return (
    await prisma.event.create({
      data: {
        name: `${TAG} ${name}`,
        organizationId: orgId,
        status: "live",
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${name.replace(/\W/g, "")}-${Date.now()}`,
        ...data,
      },
    })
  ).id;
}

async function player(eventId: string, who: string, seed: number, groupId?: string) {
  return (
    await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `${TAG}-${eventId.slice(-6)}-${who}@example.invalid`, seed, status: "confirmed", handicap: 10 - seed, groupId },
    })
  ).id;
}

const oneUp = (w: "A" | "B") => JSON.stringify([w, ...new Array(17).fill("H")]);
const trophy = async (eventId: string) => computeHighlights((await loadEventState(eventId))!).find((h) => h.icon === "🏆")!;
const setStatus = (id: string, status: string) => prisma.event.update({ where: { id }, data: { status } });

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the Leader / Winner card over a shared first place", () => {
  it("a round robin cycle: the three share the lead, and on a completed event nobody is named winner", async () => {
    const eventId = await event("Cycle", { format: "match" });
    const flight = (await prisma.group.create({ data: { eventId, name: "Flight A", position: 0 } })).id;
    const stageId = (
      await prisma.stage.create({ data: { eventId, type: "Round Robin", format: "Match Play", holes: 18, position: 0, description: "Round 1" } })
    ).id;
    const id: Record<string, string> = {};
    for (const [i, w] of ["Ann", "Bea", "Cat"].entries()) id[w] = await player(eventId, w, i + 1, flight);
    const meet = (a: string, b: string, holes: string) =>
      prisma.match.create({ data: { eventId, stageId, groupId: flight, round: 1, playerAId: id[a], playerBId: id[b], holes } });
    await meet("Ann", "Bea", oneUp("A"));
    await meet("Bea", "Cat", oneUp("A"));
    const last = await meet("Cat", "Ann", oneUp("A"));

    const state = (await loadEventState(eventId))!;
    expect(state.overall.map((r) => r.rank), "CONTROL: the table shares 1st").toEqual([1, 1, 1]);
    const live = await trophy(eventId);
    expect(live.title).toBe("Leaders");
    for (const w of ["Ann", "Bea", "Cat"]) expect(live.text).toContain(`${TAG} ${w}`);
    expect(live.text).toMatch(/ share the lead on 2 pts\./);

    await setStatus(eventId, "completed");
    const done = await trophy(eventId);
    expect(done.title, "no Winner over a shared first").toBe("Level for first");
    expect(done.text).toMatch(/ share first place on 2 pts\. .*committee decides the title/);
    expect(done.text).not.toMatch(/ won /);

    // CONTROL: Ann beats Cat instead — Ann 4 points, alone on top.
    await prisma.match.update({ where: { id: last.id }, data: { holes: oneUp("B") } });
    const alone = await trophy(eventId);
    expect(alone.title).toBe("Winner");
    expect(alone.text).toBe(`${TAG} Ann won on 4 pts.`);
  });

  it("a medal with two identical cards: they share the lead, and nobody is named winner", async () => {
    const eventId = await event("Medal", {
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    });
    const stageId = (
      await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } })
    ).id;
    const id: Record<string, string> = {};
    for (const [i, w] of ["Ann", "Bea"].entries()) {
      id[w] = await player(eventId, w, i + 1);
      await prisma.scorecard.create({ data: { eventId, stageId, playerId: id[w], strokes: JSON.stringify(PARS), status: "approved" } });
    }
    const live = await trophy(eventId);
    expect(live.title).toBe("Leaders");
    expect(live.text).toBe(`${TAG} Ann and ${TAG} Bea share the lead at level par (72).`);

    await setStatus(eventId, "completed");
    const done = await trophy(eventId);
    expect(done.title).toBe("Level for first");
    expect(done.text).not.toMatch(/ won /);

    // CONTROL: Bea drops a shot — Ann alone.
    await prisma.scorecard.updateMany({ where: { stageId, playerId: id.Bea }, data: { strokes: JSON.stringify([...PARS.slice(0, 17), 5]) } });
    const alone = await trophy(eventId);
    expect(alone.title).toBe("Winner");
    expect(alone.text).toBe(`${TAG} Ann won at level par (72).`);
  });
});
