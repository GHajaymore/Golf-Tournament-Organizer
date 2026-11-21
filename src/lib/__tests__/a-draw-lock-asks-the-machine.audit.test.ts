import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bracketDraws } from "../domain/my-tie";
import { parseFlightPlan } from "../domain/bracket-flights";
import { loadEventState } from "../services/tournament";

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { clearFlights, divideIntoFlights, moveFlightPlayer, renameFlight, reseedFlight, setBracketMode, setBracketWinner } =
  await import("@/app/actions/tournament");
const { scopeLockFor } = await import("../services/tournament-status");

/**
 * THE DRAW SCOPE ASKS THE MACHINE (PR L2; PE + TD ruling on #1190, ruling B).
 *
 * `flightsOpenForChange` was a hand-spelled twin of the machine's `draw` lock: completed, or `bracketWinner.count > 0`,
 * with its own words. It now asks `refuseIfLocked(eventId, "draw", …)`, so the refusal and the Bracket banner are one
 * answer. This holds, on real rows and a knockout in THREE flights, that:
 *  - every flight action is refused exactly when the machine's `draw` lock is shut, with the machine's own lock and words;
 *  - the machine's "has results" agrees with the `BracketWinner` rows over the whole life of the draw (open, a result in
 *    the LAST flight, the result cleared, completed), so the second reading the twin had is gone for good.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-PR-L2";
let organizationId = "";
let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const asOrganizer = () => {
  session = { eventId, email: `${TAG}-org@example.invalid`.toLowerCase(), viewRole: "admin", name: "Zz Organizer", role: "admin" };
};
const stored = async () => (await prisma.event.findUnique({ where: { id: eventId }, select: { bracketDraw: true } }))!.bracketDraw;
const winners = () => prisma.bracketWinner.count({ where: { eventId } });
const state = async () => (await loadEventState(eventId))!;

beforeAll(async () => {
  await scrub();
  organizationId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId,
        name: `${TAG} matchplay`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${process.pid}`.toLowerCase(),
        shape: "knockout",
        format: "match",
        qualifyMode: "perFlight",
        qualifyPerGroup: 2,
        bracketMode: "single",
      },
      select: { id: true },
    })
  ).id;
  await prisma.stage.create({ data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  for (let i = 1; i <= 12; i++) {
    await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} player ${String(i).padStart(2, "0")}`,
        email: `${TAG}-p${i}@example.invalid`.toLowerCase(),
        handicap: (i * 5) % 17,
        handicapSource: "manual",
        handicapType: "18",
        status: "confirmed",
        seed: i,
      },
    });
  }
  asOrganizer();
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Every flight action, pressed against the division as it stands; each answer, with what it changed. */
async function pressAll() {
  const plan = parseFlightPlan(await stored())!;
  const first = plan.brackets[0].playerIds[0];
  return [
    await divideIntoFlights("handicap", [4, 4, 4]),
    await clearFlights(),
    await moveFlightPlayer(first, 1),
    await reseedFlight(0, plan.brackets[0].playerIds),
    await renameFlight(0, "Scratch"),
  ];
}

describe("the draw scope asks the machine (three flights, real rows)", () => {
  it("while nothing is played, the machine's draw lock is open and the flight actions work", async () => {
    expect(await setBracketMode("flights")).toEqual({ ok: true });
    expect(await divideIntoFlights("handicap", [4, 4, 4])).toEqual({ ok: true });
    const s = await state();
    expect(s.flights!.plan.brackets.length, "THREE flights").toBe(3);
    expect(await scopeLockFor(eventId, "draw")).toBeNull();
    expect(await winners()).toBe(0);
    expect(await renameFlight(2, "Plate")).toEqual({ ok: true });
  });

  it("a result in the LAST flight shuts the draw in the machine and in every flight action, in the machine's words", async () => {
    const s = await state();
    const tie = bracketDraws(s.brackets)[2].view.rounds[0].matches.find((m) => m.a.playerId && m.b.playerId)!;
    expect(await setBracketWinner(tie.key, tie.a.playerId!)).toEqual({ ok: true });

    expect(await winners(), "a BracketWinner row is the result").toBeGreaterThan(0);
    const lock = await scopeLockFor(eventId, "draw");
    expect(lock, "the machine did not see the result").toMatchObject({ scope: "draw", by: "results" });
    const before = await stored();
    const answers = await pressAll();
    for (const a of answers) {
      expect(a).toMatchObject({
        ok: false,
        error: "Locked because this knockout has results. Clear the results on the Bracket to change the flights.",
        lock: { scope: "draw", by: "results" },
      });
    }
    expect(await stored(), "a refused press wrote").toBe(before);
  });

  it("clearing the result opens the draw again, in the machine and in the actions together", async () => {
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
    expect(await scopeLockFor(eventId, "draw")).toBeNull();
    expect(await renameFlight(2, "Plate again")).toEqual({ ok: true });
  });

  it("completed shuts it, and Reopen's words are the machine's", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
    expect(await scopeLockFor(eventId, "draw")).toMatchObject({ scope: "draw", by: "completed" });
    const before = await stored();
    for (const a of await pressAll()) {
      expect(a).toMatchObject({ ok: false, lock: { scope: "draw", by: "completed" } });
      expect((a as { error: string }).error).toMatch(/^Locked because the tournament is completed\. .* to change the flights\.$/);
    }
    expect(await stored()).toBe(before);
    await prisma.event.update({ where: { id: eventId }, data: { status: "draft" } });
  });

  it("CONTROL: a tournament not arranged in flights is refused for that reason, not by the lock", async () => {
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
    expect(await setBracketMode("single")).toEqual({ ok: true });
    expect(await renameFlight(0, "x")).toMatchObject({ ok: false, error: expect.stringMatching(/not arranged in flights/) });
    expect(await scopeLockFor(eventId, "draw")).toBeNull();
  });
});
