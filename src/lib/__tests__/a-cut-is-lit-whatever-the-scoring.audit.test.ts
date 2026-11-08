import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WHO THE BOARD LIGHTS AT A CUT IS WHO THE CUT TAKES, WHATEVER THE TOURNAMENT'S
 * SCORING SAYS (J31, 2026-11-07), on real rows.
 *
 * `event.format` ("Scoring" on Tournament details) is one value for a whole
 * tournament, and a mixed one is correct under either (`scoringMismatch`). The
 * engines never read it: a cut between two medals is made on the cards
 * (`applyStrokeCut` → `strokeCutOutcomeOf`), a round robin's on the table
 * (`generateCutRound`). The board read it twice, and lit the wrong people:
 *
 *   medal → medal → round robin, Scoring "Match play"
 *       the cut into the second medal fell through to the front of the match
 *       table — nobody has played a match, so ENTRY ORDER — while the cut
 *       itself was to be taken on the cards. Worked by hand (gross, cut to 2,
 *       ties by play-off, Committee Procedures 5A(6)):
 *
 *         Ann 70 · Bea 72 · Cat 72 · Dot 75
 *         Ann through; Bea and Cat level for the second place, owing a
 *         play-off; Dot out. Entry order would have lit Ann and Bea.
 *
 *   two round robins, nothing played yet, Scoring "Match play"
 *       the cut lit the front of a table level on nought — entry order again,
 *       shown as if it were a result — and nobody under "Stroke play". A tie of
 *       the whole field is nobody's play-off and nobody's place: nobody, under
 *       either.
 *
 *   npx vitest run --config vitest.audit.config.ts a-cut-is-lit-whatever-the-scoring
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { loadEventState } from "@/lib/services/tournament";
import { strokeCutOutcomeOf } from "@/lib/services/stroke-cut";

const prisma = new PrismaClient();
const TAG = "zz-cut-lit-scoring";
const PARS = new Array(18).fill(4);
const card = (total: number) => {
  const c = [...PARS];
  let diff = total - 72;
  for (let i = 0; diff < 0; i += 1, diff += 1) c[i] = 3;
  for (let i = 17; diff > 0; i -= 1, diff -= 1) c[i] = 5;
  return c;
};

let orgId = "";
const medal = { eventId: "", r1: "", id: {} as Record<string, string> };
const table = { eventId: "", id: {} as Record<string, string> };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(name: string, format: string) {
  return (
    await prisma.event.create({
      data: {
        name: `${TAG} ${name}`,
        organizationId: orgId,
        status: "live",
        format,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${name}-${Date.now()}`,
        customPars: JSON.stringify(PARS),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
}

async function makeField(eventId: string, groupId: string | null, into: Record<string, string>) {
  for (const [i, who] of ["ann", "bea", "cat", "dot"].entries()) {
    into[who] = (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${who}`,
          email: `${TAG}-${eventId.slice(-6)}-${who}@example.invalid`,
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
          ...(groupId ? { groupId } : {}),
        },
      })
    ).id;
  }
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;

  // ── medal → medal (cut to 2, ties by play-off) → round robin, Scoring Match play ──
  medal.eventId = await makeEvent("Summer Medals", "match");
  const stroke = { eventId: medal.eventId, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" };
  medal.r1 = (await prisma.stage.create({ data: { ...stroke, position: 0, description: "Round 1" } })).id;
  await prisma.stage.create({
    data: { ...stroke, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 2, cutTies: "playoff" },
  });
  await prisma.stage.create({ data: { eventId: medal.eventId, type: "Round Robin", format: "Match Play", holes: 18, position: 2, description: "Round 3" } });
  await makeField(medal.eventId, null, medal.id);
  const totals: Record<string, number> = { ann: 70, bea: 72, cat: 72, dot: 75 };
  for (const who of Object.keys(totals)) {
    await prisma.scorecard.create({
      data: { eventId: medal.eventId, stageId: medal.r1, playerId: medal.id[who], strokes: JSON.stringify(card(totals[who])), status: "approved" },
    });
  }

  // ── two round robins, round 2 a cut to 2; round 1 drawn, nothing played ──
  table.eventId = await makeEvent("Spring Groups", "match");
  const rr = { eventId: table.eventId, type: "Round Robin", format: "Match Play", holes: 18 };
  const t1 = (await prisma.stage.create({ data: { ...rr, position: 0, description: "Round 1" } })).id;
  await prisma.stage.create({
    data: { ...rr, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 2, cutTies: "playoff" },
  });
  const flight = (await prisma.group.create({ data: { eventId: table.eventId, name: "Flight A", position: 0 } })).id;
  await makeField(table.eventId, flight, table.id);
  const who = Object.keys(table.id);
  const unplayed = JSON.stringify(new Array(18).fill(null));
  for (let a = 0; a < who.length; a += 1) {
    for (let b = a + 1; b < who.length; b += 1) {
      await prisma.match.create({
        data: { eventId: table.eventId, stageId: t1, groupId: flight, round: 1, playerAId: table.id[who[a]], playerBId: table.id[who[b]], holes: unplayed },
      });
    }
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const tieOf = (ties: { playerIds: string[]; places: number; by: string }[]) => ties.map((t) => [[...t.playerIds].sort(), t.places, t.by]);

describe("the board lights a cut the way it is made, whatever the tournament's Scoring", () => {
  for (const scoring of ["match", "stroke"] as const) {
    it(`medal → medal → round robin, Scoring ${scoring}: the board and the cut agree on the cards`, async () => {
      await prisma.event.update({ where: { id: medal.eventId }, data: { format: scoring } });
      const state = (await loadEventState(medal.eventId))!;
      expect(state.isStroke, "the fixture is what it says").toBe(scoring === "stroke");
      expect(state.activeStage?.id, "Round 1 is the round being played").toBe(medal.r1);

      // The engine's answer — the one `applyStrokeCut` makes the cut with.
      const made = (await strokeCutOutcomeOf(medal.eventId, medal.r1))!;
      expect([...made.outcome.through], "worked by hand: Ann alone").toEqual([medal.id.ann]);
      expect(tieOf(made.outcome.undecided), "Bea and Cat owe a play-off").toEqual([[[medal.id.bea, medal.id.cat].sort(), 1, "playoff"]]);

      // The board's — the same, and never entry order (Ann and Bea).
      expect(state.qualifying).toBe(true);
      expect([...state.advancingIds].sort()).toEqual([...made.outcome.through].sort());
      expect(tieOf(state.cutTiesUndecided)).toEqual(tieOf(made.outcome.undecided));
    });

    it(`two round robins, nothing played, Scoring ${scoring}: the cut lights nobody`, async () => {
      await prisma.event.update({ where: { id: table.eventId }, data: { format: scoring } });
      const state = (await loadEventState(table.eventId))!;
      expect(state.isStroke, "the fixture is what it says").toBe(scoring === "stroke");
      expect(state.qualifying, "a cut is still being played for").toBe(true);
      expect([...state.advancingIds], "a table level on nought is nobody's place").toEqual([]);
      expect(state.cutTiesUndecided, "and nobody's play-off").toEqual([]);
    });
  }

  it("CONTROL: one match played, and the round robin's cut lights from the table", async () => {
    // Ann beats Bea 1 up: the table now has a result, so the cut is lit off it —
    // proving the "nobody" above is the empty table and not a cut that is never lit.
    await prisma.event.update({ where: { id: table.eventId }, data: { format: "match" } });
    const m = await prisma.match.findFirstOrThrow({ where: { eventId: table.eventId, playerAId: table.id.ann, playerBId: table.id.bea } });
    await prisma.match.update({ where: { id: m.id }, data: { holes: JSON.stringify(["A", ...new Array(17).fill("H")]) } });
    const state = (await loadEventState(table.eventId))!;
    const lit = state.advancingIds.size + state.cutTiesUndecided.flatMap((t) => t.playerIds).length;
    expect(lit, "somebody is through or in a tie for the line").toBeGreaterThan(0);
    expect(state.advancingIds.has(table.id.ann), "Ann, the only winner, is through").toBe(true);
  });
});
