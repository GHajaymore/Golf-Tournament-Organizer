import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { modifiedStablefordBoard } from "@/lib/services/points-standings";

/**
 * A MODIFIED STABLEFORD TIE GOES TO COUNTBACK, NOT TO THE LOWER GROSS.
 *
 * The board broke a tie on points by the lower gross score — the low
 * handicapper every time — and its readers shared the place on points. The
 * boards print the place countback decides (Ajay's ruling of 2026-09-26), so
 * since 2026-10-14 the tie goes to the last nine, six, three and one on the
 * card's own points, and the board decides the place (`ModStablefordRow.place`).
 *
 * Worked by hand, every par a 4, stroke index 1 to 18 in hole order, on the
 * modified table (par 0, birdie 2, bogey −1):
 *
 *     Ann, scratch   a birdie on the 1st, pars after             2 points, gross 71
 *     Bob, off 18    net pars out, a net birdie on the 10th,     2 points, gross 88
 *                    net pars home (a 4 on the 18th, where his
 *                    allowance gives him no stroke)
 *
 * Level on 2. The lower gross is Ann; the last nine is Bob, 2 against 0.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MODCOUNTBACK";
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const ANN = [3, ...new Array(17).fill(4)];
const BOB = [...new Array(9).fill(5), 4, ...new Array(7).fill(5), 4];

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
        customPars: JSON.stringify(PARS),
        customYards: JSON.stringify(new Array(18).fill(380)),
        customStrokeIndex: JSON.stringify(SI),
      },
    })
  ).id;
  stageId = (
    await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Modified Stableford", holes: 18, scoringBasis: "stableford" } })
  ).id;
  for (const [who, handicap, card] of [["Ann", 0, ANN], ["Bob", 18, BOB]] as const) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`.toLowerCase(), status: "confirmed", seed: 1, handicap },
    });
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: p.id, strokes: JSON.stringify(card), status: "approved" } });
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("two players level on modified Stableford points", () => {
  it("CONTROL: the fixture is what it says — 2 points each, Ann on the lower gross", async () => {
    const rows = await modifiedStablefordBoard(eventId, stageId, PARS, SI);
    const by = Object.fromEntries(rows.map((r) => [r.name.replace(`${TAG} `, ""), r]));
    expect([by.Ann.points, by.Bob.points]).toEqual([2, 2]);
    expect([by.Ann.gross, by.Bob.gross]).toEqual([71, 88]);
  });

  it("go to the better last nine, and the place is not shared", async () => {
    const rows = await modifiedStablefordBoard(eventId, stageId, PARS, SI);
    expect(rows.map((r) => [r.name.replace(`${TAG} `, ""), r.place])).toEqual([
      ["Bob", 1],
      ["Ann", 2],
    ]);
  });
});
