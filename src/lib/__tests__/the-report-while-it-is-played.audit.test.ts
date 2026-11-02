import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The board is `unstable_cache`d, which throws outside a Next request; the
// identity runs the real builder, which is the code the report reads.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
import { PrismaClient } from "@prisma/client";
import { eventReport } from "@/lib/services/event-report";
import { seedReport, teardownReport } from "../../../e2e/report-fixture.mjs";

/**
 * THE REPORT OF A TOURNAMENT STILL BEING PLAYED (walked 2026-10-23).
 *
 * The final report is also "the results so far", and every one of these was
 * on the seeded club's reports the day after it shipped — while the finished
 * tournaments it was walked on before shipping were all correct:
 *
 *   the live medal     "Marnie leads on net 30 … Nkechi is next, on net 67":
 *                      six under through eight above four under through
 *                      eighteen, said as a thirty-seven-shot lead. And no Thru
 *                      column, so a 44 sat above a 75 with nothing to say why
 *   the live medal     "No return" beside four players who had not teed off
 *   the league         "stayed top after Round 5 … Round 6 … Round 7" with
 *                      those three weeks still on the calendar; and
 *                      "0 played every round", charging everybody the weeks
 *                      nobody has reached
 *   taking entries     the whole field listed as "No return" under "The
 *                      leaderboard", with no round played
 *
 * On the two-round medal of `e2e/report-fixture.mjs` (worked by hand in its
 * header): round 2 is reopened with Bob's card stopped after the front nine,
 * a third round is put on the calendar with nothing played, and a fifth
 * player is entered with no card. Then a tournament taking entries.
 *
 *   npx vitest run --config vitest.audit.config.ts the-report-while-it-is-played
 */

const MARK = "zz-audit-report-live";
type Seeded = {
  eventId: string;
  nextEventId: string;
  stageIds: string[];
  players: Record<string, { id: string; name: string; email: string }>;
  organizerEmail: string;
};
let seeded: Seeded;
const prisma = new PrismaClient();
const staffCopy = (eventId: string) => eventReport(eventId, { kind: "staff", email: seeded.organizerEmail });

beforeAll(async () => {
  seeded = (await seedReport(MARK)) as Seeded;
  // Still being played: the event live, both rounds open again.
  await prisma.event.update({ where: { id: seeded.eventId }, data: { status: "live" } });
  await prisma.stage.updateMany({ where: { eventId: seeded.eventId }, data: { closedAt: null } });
  // Bob has played the front nine of round 2 — an eagle on 5 and a birdie on 6,
  // so 33, three under — and nothing after it.
  const bob = await prisma.scorecard.findFirstOrThrow({ where: { stageId: seeded.stageIds[1], playerId: seeded.players.Bob.id } });
  const front = (JSON.parse(bob.strokes) as number[]).map((s, i) => (i < 9 ? s : null));
  await prisma.scorecard.update({ where: { id: bob.id }, data: { strokes: JSON.stringify(front) } });
  // A third round next week, which nobody has played.
  const r2 = await prisma.stage.findUniqueOrThrow({ where: { id: seeded.stageIds[1] } });
  const later = new Date();
  later.setDate(later.getDate() + 7);
  await prisma.stage.create({
    data: {
      eventId: seeded.eventId,
      position: 2,
      description: "Round 3",
      type: r2.type,
      format: r2.format,
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
      playedOn: later.toISOString().slice(0, 10),
    },
  });
  // Eve is entered and has not teed off.
  await prisma.player.create({
    data: { eventId: seeded.eventId, name: "Eve Example", email: `${MARK}-eve@example.invalid`, handicap: 0, seed: 5, status: "confirmed" },
  });
}, 60_000);

afterAll(async () => {
  await teardownReport(MARK);
  await prisma.$disconnect();
});

describe("the report of a tournament still being played", () => {
  it("names the leader on the figure the board ranks a part-played card on, with how far round", async () => {
    const r = (await staffCopy(seeded.eventId))!;
    expect(r.completed).toBe(false);
    // Bob: level after round 1 (72) and three under through the front nine of
    // round 2 — three under through 27. Cat is level through 36 (73, 71).
    expect(r.first?.names).toEqual([seeded.players.Bob.name]);
    expect(r.first?.figure).toBe("-3 through 27");
    // Never his total, which is a 105 and would read as a thirty-nine-shot lead.
    expect(r.story[0]).not.toContain("105");
  });

  it("prints how far round each card is, as the board does", async () => {
    const r = (await staffCopy(seeded.eventId))!;
    expect(r.columns).toEqual(["Gross", "Net", "To par", "Thru"]);
    const bob = r.rows.find((x) => x.name === seeded.players.Bob.name)!;
    expect(bob.cells).toEqual(["105", "105", "-3", "27"]);
    // Cat has returned every card she owes — the board's "Final" for her.
    const cat = r.rows.find((x) => x.name === seeded.players.Cat.name)!;
    expect(cat.cells[3]).toBe("F");
  });

  it("somebody who has not teed off has not failed to return a card", async () => {
    const r = (await staffCopy(seeded.eventId))!;
    const eve = r.rows.find((x) => x.name === "Eve Example")!;
    expect(eve.note).toBe("Not started");
    expect(r.rows.some((x) => x.note === "No return")).toBe(false);
  });

  it("a round on the calendar that nobody has played is in no table and charges nobody", async () => {
    const r = (await staffCopy(seeded.eventId))!;
    // The board's own places now — not "Final", and no column for Round 3.
    expect(r.movement?.columns).toEqual(["R1", "Now"]);
    expect(r.movement?.story.map((s) => s.label)).toEqual(["Round 1", "Round 2"]);
    expect(JSON.stringify(r.movement)).not.toContain("Round 3");
    // Ann, Cat and Dan have complete cards in both rounds played; Bob's second is open.
    expect(r.numbers).toContainEqual({ figure: "3", label: "played every round" });
  });

  it("a tournament nobody has played yet prints no leaderboard at all", async () => {
    for (const [i, name] of ["Fay", "Gus"].entries()) {
      await prisma.player.create({
        data: { eventId: seeded.nextEventId, name: `${name} Example`, email: `${MARK}-${name.toLowerCase()}@example.invalid`, handicap: 0, seed: i + 1, status: "confirmed" },
      });
    }
    const r = (await staffCopy(seeded.nextEventId))!;
    expect(r.rows).toEqual([]);
    expect(r.rankedBy).toBe("");
    expect(r.numbers).toEqual([]);
  });
});
