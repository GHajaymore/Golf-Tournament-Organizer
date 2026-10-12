import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parseBracketDraw } from "../domain/bracket";
import { parseFlightPlan } from "../domain/bracket-flights";
import { bracketDraws } from "../domain/my-tie";
import { finishingPositions } from "../services/finish-order";
import { loadEventState } from "../services/tournament";

/**
 * A real session, so the flights are divided, adjusted and played through the
 * same actions the organizer's screen calls. The rules under test live in
 * those actions — who may change a division, and until when — so a test that
 * wrote the plan itself would be asserting its own arithmetic.
 */
let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { clearFlights, divideIntoFlights, moveFlightPlayer, renameFlight, reseedFlight, setBracketMode, setBracketWinner, setThirdPlace } =
  await import("@/app/actions/tournament");

/**
 * A KNOCKOUT IN SEVERAL FLIGHTS, ON REAL ROWS.
 *
 * A club match play with more entries than one bracket should hold is divided
 * into flights, each its own straight knockout (Ajay, 2026-10-11). The
 * arithmetic of dividing a field is swept in `bracket-flights.test.ts`. This
 * file is what only rows can show:
 *
 *  - the division is KEPT — the players an organizer moved are still where
 *    they put them on the next read — and it is not mistaken for one bracket's
 *    flat draw, nor wiped by clearing a result (which is what un-freezes one);
 *  - a result in one flight is filed under that flight's own key and moves
 *    nobody in another;
 *  - the division can be changed until the first result in ANY flight and not
 *    after (the draw is fixed once play in it has begun, Committee Procedures
 *    5F(1)), by the primary organizer only — and NOT shut by launching, which
 *    locks setup: the division is the draw, and a qualifying knockout can
 *    only make it after launch. A completed tournament is shut;
 *  - a late entrant is in no flight until put in one, and a player who
 *    withdraws stays in theirs;
 *  - the tournament's finishing order runs flight by flight.
 *
 * The field is built so a wrong answer looks different: twenty-one players
 * whose handicaps are NOT in entry order, two of them with no handicap at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FLIGHTS";

let organizationId = "";
let eventId = "";
let stageId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const asOrganizer = () => {
  session = { eventId, email: `${TAG}-org@example.invalid`.toLowerCase(), viewRole: "admin", name: "Zz Organizer", role: "admin" };
};
const state = async () => (await loadEventState(eventId))!;
const stored = async () => (await prisma.event.findUnique({ where: { id: eventId }, select: { bracketDraw: true, bracketMode: true } }))!;
const idOf = async (n: number) => (await prisma.player.findFirst({ where: { eventId, name: `${TAG} player ${String(n).padStart(2, "0")}` }, select: { id: true } }))!.id;
const handicapOf = (i: number) => ((i * 8) % 21) + i / 100;

beforeAll(async () => {
  await scrub();
  organizationId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  const event = await prisma.event.create({
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
  });
  eventId = event.id;
  stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 }, select: { id: true } })).id;
  for (let i = 1; i <= 21; i++) {
    await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} player ${String(i).padStart(2, "0")}`,
        email: `${TAG}-p${i}@example.invalid`.toLowerCase(),
        // Players 20 and 21 have no handicap at all: a stored 0 that nobody claimed.
        handicap: i >= 20 ? 0 : handicapOf(i),
        handicapSource: i >= 20 ? "none" : "manual",
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

/** Record the higher seed as the winner of every tie that can be played, until none is left. */
async function playOut(label?: string) {
  for (let guard = 0; guard < 8; guard += 1) {
    const s = await state();
    const open = bracketDraws(s.brackets)
      .filter((d) => !label || d.label === label)
      .flatMap((d) => d.view.rounds.flatMap((r) => r.matches))
      .filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);
    if (open.length === 0) return;
    for (const m of open) {
      const res = await setBracketWinner(m.key, (m.a.seed ?? 99) < (m.b.seed ?? 99) ? m.a.playerId! : m.b.playerId!);
      expect(res, `recording ${m.key}`).toEqual({ ok: true });
    }
  }
}

describe("a knockout in several flights", () => {
  it("is not divided until the organizer divides it: one field, nothing drawn", async () => {
    expect(await setBracketMode("flights")).toEqual({ ok: true });
    const s = await state();
    expect(s.qualifiers.length, "the whole field is in the knockout").toBe(21);
    expect(s.brackets.draws, "a draw exists before anybody made one").toBeUndefined();
    expect(s.flights ?? null).toBeNull();
    expect(s.brackets.winners.rounds.flatMap((r) => r.matches).some((m) => m.a.playerId || m.b.playerId), "somebody is in a tie").toBe(false);
    expect(s.drawFrozen).toBe(false);
  });

  it("refuses a division that does not hold the field, and keeps nothing", async () => {
    expect(await divideIntoFlights("handicap", [16, 4])).toMatchObject({ ok: false, error: expect.stringMatching(/hold 20 and the field is 21/) });
    expect(await divideIntoFlights("handicap", [20, 1])).toMatchObject({ ok: false, error: expect.stringMatching(/bracket of one/) });
    expect(await divideIntoFlights("alphabetical", [16, 5])).toMatchObject({ ok: false });
    expect(await divideIntoFlights("handicap", "16,5")).toMatchObject({ ok: false });
    expect(await divideIntoFlights("handicap", [16, 5.5])).toMatchObject({ ok: false });
    expect(await divideIntoFlights("qualifying", [16, 5]), "nothing was played to qualify on").toMatchObject({ ok: false, error: expect.stringMatching(/qualifying place/) });
    expect(await divideIntoFlights("flights", []), "the tournament has no flights").toMatchObject({ ok: false, error: expect.stringMatching(/no flights/) });
    expect((await stored()).bracketDraw).toBe("");
  });

  it("by handicap: the sixteen best in the Championship flight, the rest below, nobody without a handicap ahead of anybody with one", async () => {
    expect(await divideIntoFlights("handicap", [16, 5])).toEqual({ ok: true });
    const s = await state();
    const draws = s.brackets.draws!;
    expect(draws.map((d) => d.label)).toEqual(["Championship flight", "First flight"]);
    expect(s.flights!.plan.brackets.map((b) => [b.playerIds.length, b.size, b.byes, b.rounds])).toEqual([[16, 16, 0, 4], [5, 8, 3, 3]]);

    const rows = new Map((await prisma.player.findMany({ where: { eventId } })).map((p) => [p.id, p]));
    const [top, next] = s.flights!.plan.brackets;
    const topHandicaps = top.playerIds.map((id) => rows.get(id)!.handicap);
    expect(topHandicaps, "seeded best first").toEqual([...topHandicaps].sort((a, b) => a - b));
    const withOne = next.playerIds.filter((id) => rows.get(id)!.handicapSource !== "none");
    expect(Math.max(...topHandicaps), "somebody in the First flight is better than somebody in the Championship flight").toBeLessThan(
      Math.min(...withOne.map((id) => rows.get(id)!.handicap)),
    );
    expect(next.playerIds.slice(-2).map((id) => rows.get(id)!.handicapSource), "the two with no handicap are at the foot, not at the top as scratch").toEqual(["none", "none"]);

    // What is kept is the division, and neither reader mistakes it for the other's value.
    const kept = (await stored()).bracketDraw;
    expect(parseFlightPlan(kept)?.brackets.map((b) => b.playerIds)).toEqual([top.playerIds, next.playerIds]);
    expect(parseBracketDraw(kept), "read as one bracket's flat draw").toBeNull();

    // The Championship flight is a full bracket; the First flight's three byes are its top three seeds'.
    expect(draws[0].view.rounds[0].matches.every((m) => m.a.playerId && m.b.playerId)).toBe(true);
    const byes = draws[1].view.rounds[0].matches.filter((m) => !m.a.playerId || !m.b.playerId).map((m) => m.a.seed ?? m.b.seed);
    expect(byes.sort()).toEqual([1, 2, 3]);
    expect(draws.map((d) => d.view.rounds[0].matches[0].key), "each flight files its ties under its own word").toEqual(["winners-0-0", "consolation-0-0"]);

    const line = await prisma.auditLog.findFirst({ where: { eventId, action: "knockout.flights" }, orderBy: { createdAt: "desc" } });
    expect(line?.detail).toMatch(/2 flights \(handicap\): Championship flight 16, First flight 5/);
  });

  it("is the organizer's to adjust: a move, a seeding and a name are all still there on the next read", async () => {
    const before = (await state()).flights!.plan;
    const mover = before.brackets[0].playerIds[15];
    expect(await moveFlightPlayer(mover, 1)).toEqual({ ok: true });
    expect(await renameFlight(1, "  Handicap flight ")).toEqual({ ok: true });
    const mid = (await state()).flights!.plan;
    expect(mid.brackets.map((b) => [b.name, b.playerIds.length, b.size, b.byes])).toEqual([
      ["Championship flight", 15, 16, 1],
      ["Handicap flight", 6, 8, 2],
    ]);
    expect(mid.brackets[1].playerIds.at(-1), "a moved player joins at the foot").toBe(mover);

    const order = [...mid.brackets[1].playerIds].reverse();
    expect(await reseedFlight(1, order)).toEqual({ ok: true });
    expect((await state()).flights!.plan.brackets[1].playerIds).toEqual(order);
    expect((await state()).brackets.draws!.map((d) => d.label)).toEqual(["Championship flight", "Handicap flight"]);
  });

  it("takes only what belongs to this tournament, whatever it is handed", async () => {
    const other = await prisma.event.create({
      data: { organizationId, name: `${TAG} other`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-other-${process.pid}`.toLowerCase() },
    });
    const outsider = await prisma.player.create({
      data: { eventId: other.id, name: `${TAG} outsider`, email: `${TAG}-outsider@example.invalid`.toLowerCase(), handicap: 1, handicapType: "18", status: "confirmed", seed: 1 },
    });
    const before = (await stored()).bracketDraw;
    expect(await moveFlightPlayer(outsider.id, 0), "a player from another tournament").toMatchObject({ ok: false, error: expect.stringMatching(/not in this tournament/) });
    expect(await moveFlightPlayer(await idOf(1), 7), "a flight that does not exist").toMatchObject({ ok: false });
    expect(await moveFlightPlayer({ id: "x" }, "1")).toMatchObject({ ok: false });
    expect(await reseedFlight(1, [outsider.id]), "a seeding that is not the flight's own players").toMatchObject({ ok: false });
    expect(await reseedFlight("1", null)).toMatchObject({ ok: false });
    expect(await renameFlight(1, "championship FLIGHT"), "two flights, one name").toMatchObject({ ok: false });
    expect(await renameFlight(1, 42)).toMatchObject({ ok: false });
    expect((await stored()).bracketDraw, "a refused change changed something").toBe(before);
  });

  it("is the primary organizer's alone; launching does not shut it, completing does", async () => {
    const before = (await stored()).bracketDraw;
    session = { ...session!, role: "assistant", viewRole: "assistant" };
    await expect(divideIntoFlights("handicap", [16, 5])).rejects.toThrow(/Organizer access required/);
    await expect(moveFlightPlayer(await idOf(1), 1)).rejects.toThrow(/Organizer access required/);
    await expect(reseedFlight(1, [])).rejects.toThrow(/Organizer access required/);
    await expect(renameFlight(0, "Anything")).rejects.toThrow(/Organizer access required/);
    await expect(clearFlights()).rejects.toThrow(/Organizer access required/);
    session = null;
    await expect(clearFlights()).rejects.toThrow(/Not authenticated/);
    asOrganizer();

    expect((await stored()).bracketDraw, "a refused caller changed the division").toBe(before);

    // LAUNCHED, SETUP LOCKED. The arrangement is setup and is locked with it; the division is the
    // draw and is not — a qualifying round is played after launch, and the field is divided after
    // that. Renamed and renamed back, so the division is left exactly as it was found.
    await prisma.event.update({ where: { id: eventId }, data: { status: "live", configUnlocked: false } });
    await expect(setBracketMode("single"), "the arrangement is setup").rejects.toThrow(/locked/i);
    const name = parseFlightPlan(before)!.brackets[0].name;
    expect(await renameFlight(0, "After launch"), "the draw was shut by launching").toEqual({ ok: true });
    expect(parseFlightPlan((await stored()).bracketDraw)!.brackets[0].name).toBe("After launch");
    expect(await renameFlight(0, name)).toEqual({ ok: true });
    expect((await stored()).bracketDraw).toBe(before);

    // COMPLETED. The flights are as they finished.
    await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
    const shut = /completed/;
    expect(await clearFlights()).toMatchObject({ ok: false, error: expect.stringMatching(shut) });
    expect(await divideIntoFlights("handicap", [16, 5])).toMatchObject({ ok: false, error: expect.stringMatching(shut) });
    expect(await moveFlightPlayer(await idOf(1), 1)).toMatchObject({ ok: false, error: expect.stringMatching(shut) });
    expect(await renameFlight(0, "Anything")).toMatchObject({ ok: false, error: expect.stringMatching(shut) });
    expect(await reseedFlight(0, parseFlightPlan(before)!.brackets[0].playerIds)).toMatchObject({ ok: false, error: expect.stringMatching(shut) });
    await prisma.event.update({ where: { id: eventId }, data: { status: "draft" } });
    expect((await stored()).bracketDraw, "a completed tournament's division was changed").toBe(before);
  });

  it("a late entrant is in no flight until put in one; a player who withdraws stays in theirs", async () => {
    const late = await prisma.player.create({
      data: { eventId, name: `${TAG} player 22`, email: `${TAG}-p22@example.invalid`.toLowerCase(), handicap: 9, handicapType: "18", status: "confirmed", seed: 22 },
    });
    let s = await state();
    expect(s.flights!.unplaced.map((p) => p.id), "entered after the division").toEqual([late.id]);
    expect(bracketDraws(s.brackets).flatMap((d) => d.view.rounds[0].matches).some((m) => m.a.playerId === late.id || m.b.playerId === late.id), "drawn without being put anywhere").toBe(false);

    expect(await moveFlightPlayer(late.id, 0)).toEqual({ ok: true });
    s = await state();
    expect(s.flights!.unplaced).toEqual([]);
    expect(s.flights!.plan.brackets[0].playerIds.at(-1)).toBe(late.id);

    const gone = s.flights!.plan.brackets[0].playerIds[2];
    await prisma.player.update({ where: { id: gone }, data: { status: "withdrawn" } });
    s = await state();
    expect(s.flights!.departedIds, "left the field after the draw").toEqual([gone]);
    expect(s.flights!.plan.brackets[0].playerIds, "taken out of a draw already made").toContain(gone);
    expect(s.brackets.draws![0].view.rounds[0].matches.some((m) => m.a.playerId === gone || m.b.playerId === gone), "their tie has lost them").toBe(true);
    await prisma.player.update({ where: { id: gone }, data: { status: "confirmed" } });
  });

  it("a result in one flight moves nobody in another, and fixes the division for every flight", async () => {
    const s = await state();
    const tie = s.brackets.draws![1].view.rounds[0].matches.find((m) => m.a.playerId && m.b.playerId)!;
    expect(tie.key.startsWith("consolation-"), "the second flight's ties are filed under its own word").toBe(true);
    expect(await setBracketWinner(tie.key, tie.a.playerId!)).toEqual({ ok: true });

    const after = await state();
    expect(after.brackets.draws![1].view.rounds[0].matches.find((m) => m.key === tie.key)?.winnerId).toBe(tie.a.playerId);
    expect(after.brackets.draws![0].view.rounds.flatMap((r) => r.matches).some((m) => m.winnerId && m.a.playerId && m.b.playerId), "the Championship flight has a result nobody recorded").toBe(false);
    expect(after.drawFrozen, "play has begun").toBe(true);

    const kept = (await stored()).bracketDraw;
    const fixed = /has results/;
    expect(await divideIntoFlights("handicap", [16, 6])).toMatchObject({ ok: false, error: expect.stringMatching(fixed) });
    expect(await moveFlightPlayer(after.flights!.plan.brackets[0].playerIds[0], 1)).toMatchObject({ ok: false, error: expect.stringMatching(fixed) });
    expect(await reseedFlight(0, after.flights!.plan.brackets[0].playerIds)).toMatchObject({ ok: false, error: expect.stringMatching(fixed) });
    expect(await renameFlight(0, "Scratch")).toMatchObject({ ok: false, error: expect.stringMatching(fixed) });
    expect(await clearFlights()).toMatchObject({ ok: false, error: expect.stringMatching(fixed) });
    expect(await setBracketMode("single"), "out of flights with a result on the board").toMatchObject({ ok: false, error: expect.stringMatching(/has results/) });
    expect((await stored()).bracketDraw).toBe(kept);
    expect((await stored()).bracketMode).toBe("flights");

    // Clearing the last result un-freezes ONE bracket's draw by deleting it. A division is not a
    // by-product of a result: it must still be there, exactly as arranged.
    expect(await setBracketWinner(tie.key, tie.a.playerId!), "the same winner again clears the result").toEqual({ ok: true });
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
    expect((await stored()).bracketDraw, "clearing a result wiped the organizer's division").toBe(kept);
    expect((await state()).drawFrozen).toBe(false);
    expect(await renameFlight(0, "Scratch"), "with no result left, it can change again").toEqual({ ok: true });
  });

  it("has no play-off for third", async () => {
    expect(await setThirdPlace(stageId, true)).toMatchObject({ ok: false, error: expect.stringMatching(/no play-off for third/) });
    expect((await prisma.stage.findUnique({ where: { id: stageId }, select: { thirdPlace: true } }))?.thirdPlace).toBe(false);
  });

  it("a THIRD flight is a draw like the first two: its own key word, its ties counted, its results kept", async () => {
    // Two flights are the two draws the app has always had ("winners", "consolation"). Everything
    // that read exactly those two would pass every other test in this file, so this one is three.
    const arranged = (await stored()).bracketDraw;
    try {
      expect(await divideIntoFlights("handicap", [8, 8, 6])).toEqual({ ok: true });
      let s = await state();
      expect(s.brackets.draws!.map((d) => d.label)).toEqual(["Championship flight", "First flight", "Second flight"]);
      const third = s.brackets.draws![2].view;
      expect(third.rounds[0].matches.every((m) => m.key.startsWith("flight3-")), "the third flight's ties are filed under its own word").toBe(true);
      // A draw of n is n − 1 ties: 7 + 7 + 5.
      expect(s.boardProgress, "before anybody has played").toMatchObject({ unit: "ties", approved: 0, total: 19 });

      await playOut("Second flight");
      s = await state();
      expect(s.brackets.draws![2].view.champion?.playerId, "the third flight's results were not read back").toBe(s.flights!.plan.brackets[2].playerIds[0]);
      expect(s.boardProgress, "the third flight's five ties are not counted").toMatchObject({ unit: "ties", approved: 5, total: 19 });
      expect(s.brackets.draws!.slice(0, 2).flatMap((d) => d.view.rounds.flatMap((r) => r.matches)).some((m) => m.winnerId && m.a.playerId && m.b.playerId), "a result in the third flight landed in another").toBe(false);
      expect(s.drawFrozen, "play in the third flight fixes the division").toBe(true);
      expect(finishingPositions(s), "the top flight has not finished").toEqual([]);
    } finally {
      await prisma.bracketWinner.deleteMany({ where: { eventId } });
      await prisma.event.update({ where: { id: eventId }, data: { bracketDraw: arranged } });
    }
  });

  it("counts its progress in ties across every flight, and finishes flight by flight", async () => {
    let s = await state();
    const sizes = s.flights!.plan.brackets.map((b) => b.playerIds.length);
    // A draw of n players is n − 1 ties: 16 and 6 here.
    expect(s.boardProgress, "before anybody has played").toMatchObject({ unit: "ties", approved: 0, total: sizes[0] - 1 + (sizes[1] - 1) });
    expect(finishingPositions(s), "an unfinished knockout has no finishing order").toEqual([]);

    await playOut("Handicap flight");
    s = await state();
    expect(s.boardProgress).toMatchObject({ unit: "ties", approved: sizes[1] - 1 });
    expect(finishingPositions(s), "the lower flight has finished and the top one has not: there is no winner yet").toEqual([]);

    await playOut();
    s = await state();
    expect(s.boardProgress).toMatchObject({ unit: "ties", approved: sizes[0] - 1 + (sizes[1] - 1), total: sizes[0] - 1 + (sizes[1] - 1) });
    const order = finishingPositions(s);
    expect(order.length, "everybody in the draw is placed").toBe(sizes[0] + sizes[1]);
    const flightOf = new Map(s.flights!.plan.brackets.flatMap((b, i) => b.playerIds.map((id) => [id, i] as const)));
    const ranks = (i: number) => order.filter((p) => flightOf.get(p.playerId) === i).map((p) => p.rank);
    expect(Math.min(...ranks(0))).toBe(1);
    expect(Math.max(...ranks(0)), "somebody in the lower flight finished above somebody in the Championship flight").toBeLessThan(Math.min(...ranks(1)));
    expect(Math.min(...ranks(1)), "the lower flight starts where the upper one ends").toBe(sizes[0] + 1);
    expect(order[0].playerId, "the champion is the Championship flight's top seed, who won every tie").toBe(s.flights!.plan.brackets[0].playerIds[0]);
  });

  it("CONTROL: one bracket is still one bracket — a flat draw, written by the first result and cleared with the last", async () => {
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
    expect(await setBracketMode("single")).toEqual({ ok: true });
    expect((await stored()).bracketDraw, "a division means nothing to one bracket").toBe("");
    // And one bracket cannot be handed a division: the column is its own flat draw's.
    for (const refused of [await divideIntoFlights("handicap", [16, 6]), await clearFlights(), await renameFlight(0, "Anything")]) {
      expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/not arranged in flights/) });
    }
    expect((await stored()).bracketDraw, "a division was written onto a single bracket").toBe("");
    let s = await state();
    expect(s.brackets.draws).toBeUndefined();
    expect(bracketDraws(s.brackets).length).toBe(1);
    const tie = s.brackets.winners.rounds[0].matches.find((m) => m.a.playerId && m.b.playerId)!;
    expect(await setBracketWinner(tie.key, tie.a.playerId!)).toEqual({ ok: true });
    expect(parseBracketDraw((await stored()).bracketDraw)?.length, "the first result writes the draw down").toBe(22);
    expect(await setBracketWinner(tie.key, tie.a.playerId!)).toEqual({ ok: true });
    expect((await stored()).bracketDraw, "the last result cleared, the draw is live again").toBe("");
    s = await state();
    expect(s.drawFrozen).toBe(false);
  });
});
