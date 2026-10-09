import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";

/**
 * A KNOCKOUT IS SEEDED FROM THE QUALIFYING COMPETITION BEFORE IT (2026-10-08).
 *
 * The standard: a match-play draw fed by a stroke-play qualifier — a club
 * championship's 36 holes of qualifying, then the knockout — takes its field
 * from the qualifying CARDS, in that competition's own unit. Decided as the
 * golf answer (Ajay delegated the call) to the item `docs/deferred-register.md`
 * measured on 2026-09-12 and left open:
 *
 *   | match event, Stroke Play Round qualifier | picks the four best cards? NO |
 *
 * The qualifier was chosen by the EVENT's format. A match-format event asked
 * its match-points table, nobody had played a match, so the table was its
 * zero initialiser and the top four by SEED went into the draw while six
 * cards sat unread.
 *
 * The cards here run OPPOSITE to the seeds — P6 shot the best round and is
 * seeded last — because a qualifier chosen off seed order looks exactly like
 * one chosen off the cards when the two agree. That is the mistake the
 * register's first fixture made.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BRACKETSEED";
const PARS = new Array(18).fill(4);
const ids: string[] = [];
let matchEvent = "";
let strokeEvent = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A field of six, a medal qualifier (closed), then a bracket for the top four. */
async function build(format: "match" | "stroke") {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${format}`, kind: "club" } });
  const ev = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${format}`,
      format,
      status: "live",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${format}-${process.pid}`,
      qualifyMode: "overall",
      qualifyOverall: 4,
      // One knockout of the four, so the pairings are 1 v 4 and 2 v 3.
      bracketMode: "single",
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  const medal = await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
  });
  await prisma.stage.create({ data: { eventId: ev.id, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  const mine: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const p = await prisma.player.create({
      data: { eventId: ev.id, name: `${TAG} P${i + 1}`, email: `${TAG}.${format}.${i}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed", handicap: 0 },
    });
    mine.push(p.id);
    // P1 shoots 77 … P6 shoots 72: the reverse of the seeds.
    const over = 5 - i;
    await prisma.scorecard.create({
      data: { eventId: ev.id, stageId: medal.id, playerId: p.id, strokes: JSON.stringify(PARS.map((par, h) => par + (h < over ? 1 : 0))), status: "approved" },
    });
  }
  return { id: ev.id, players: mine };
}

beforeAll(async () => {
  await cleanup();
  const m = await build("match");
  matchEvent = m.id;
  ids.push(...m.players);
  strokeEvent = (await build("stroke")).id;
}, 60_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const advancing = async (eventId: string) => {
  const s = await loadEventState(eventId);
  if (!s) throw new Error("the event did not load");
  const players = await prisma.player.findMany({ where: { eventId }, orderBy: { seed: "asc" } });
  return players.filter((p) => s.advancingIds.has(p.id)).map((p) => `P${p.seed}`);
};

describe("a bracket fed by a medal qualifier", () => {
  it("takes the four best cards into the draw, inside a MATCH-format event", async () => {
    expect(await advancing(matchEvent)).toEqual(["P3", "P4", "P5", "P6"]);
  });

  it("and the ordinary stroke-format championship, as before — the control", async () => {
    expect(await advancing(strokeEvent)).toEqual(["P3", "P4", "P5", "P6"]);
  });

  it("seeds the draw in qualifying order: the medallist is the top seed, 1 v 4 and 2 v 3", async () => {
    const s = await loadEventState(matchEvent);
    const players = await prisma.player.findMany({ where: { eventId: matchEvent } });
    const name = new Map(players.map((p) => [p.id, `P${p.seed}`]));
    const first = s!.brackets.winners.rounds[0].matches.map((m) =>
      [m.a, m.b].map((slot) => `${slot.seed}:${name.get(slot.playerId ?? "") ?? "-"}`).sort().join(" v "),
    );
    // P6 (72) is the medallist, P3 (75) the fourth qualifier.
    expect(first.sort()).toEqual(["1:P6 v 4:P3", "2:P5 v 3:P4"]);
  });
});
