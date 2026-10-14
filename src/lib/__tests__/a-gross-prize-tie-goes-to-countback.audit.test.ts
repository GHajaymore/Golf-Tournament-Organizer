import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { loadEventState } from "@/lib/services/tournament";

/**
 * A TIE FOR BEST GROSS IN A NET MEDAL IS BROKEN BY COUNTBACK ON THE GROSS CARDS.
 *
 * The prize pickers ordered the field by gross and by net with tied places
 * SHARED, while the board broke its ties by countback — last nine, six, three,
 * then the last hole, on the basis it ranks on. So in a net medal the Best gross
 * picker said T1 where a committee says one name. Since 2026-10-14 both pickers
 * ask the board's own sort on their basis (`strokeStandingsOn`).
 *
 * Worked by hand, every par a 4:
 *
 *     Ainsley, scratch   out 45 (nine 5s)   home 35 (a 3 and eight 4s)   gross 80   net 80
 *     Brody, off 10      out 36 (nine 4s)   home 44 (a 4 and eight 5s)   gross 80   net 70
 *     Cassidy, scratch   all 5s, 90
 *
 * Gross: level on 80, and the last nine is 35 against 44 — Ainsley first,
 * Brody second, not T1. Net: Brody first. And the board, a net medal, is the
 * net order exactly.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-GROSSPRIZE";
const ids: Record<string, string> = {};
let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const AINSLEY = [...new Array(9).fill(5), 3, ...new Array(8).fill(4)];
const BRODY = [...new Array(9).fill(4), 4, ...new Array(8).fill(5)];
const CASSIDY = new Array(18).fill(5);

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} medal`,
        status: "live",
        format: "stroke",
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${process.pid}`,
        customPars: JSON.stringify(new Array(18).fill(4)),
        customYards: JSON.stringify(new Array(18).fill(380)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net" },
  });
  for (const [who, handicap, card] of [["Ainsley", 0, AINSLEY], ["Brody", 10, BRODY], ["Cassidy", 0, CASSIDY]] as const) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`.toLowerCase(), status: "confirmed", seed: 1, handicap },
    });
    ids[who] = p.id;
    await prisma.scorecard.create({ data: { eventId, stageId: stage.id, playerId: p.id, strokes: JSON.stringify(card), status: "approved" } });
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const placesOf = (rows: { player: { id: string }; rank: number; ranked: boolean }[]) =>
  rows.map((r) => [Object.keys(ids).find((k) => ids[k] === r.player.id), r.ranked ? r.rank : null]);

describe("a net medal with a tie on gross", () => {
  it("CONTROL: the fixture is what it says — level on gross 80, apart on net", async () => {
    const state = (await loadEventState(eventId))!;
    const by = Object.fromEntries(state.strokeStandings.map((s) => [s.player.id, s]));
    expect([by[ids.Ainsley].gross, by[ids.Brody].gross, by[ids.Cassidy].gross]).toEqual([80, 80, 90]);
    expect(by[ids.Brody].net).toBeLessThan(by[ids.Ainsley].net);
  });

  it("Best gross goes to Ainsley on the last nine, and Brody is second, not tied", async () => {
    const state = (await loadEventState(eventId))!;
    expect(placesOf(state.strokeStandingsOn("gross"))).toEqual([["Ainsley", 1], ["Brody", 2], ["Cassidy", 3]]);
  });

  it("Best net goes to Brody, and the board of a net medal is that order exactly", async () => {
    const state = (await loadEventState(eventId))!;
    expect(placesOf(state.strokeStandingsOn("net"))[0]).toEqual(["Brody", 1]);
    expect(placesOf(state.strokeStandings)).toEqual(placesOf(state.strokeStandingsOn("net")));
  });
});
