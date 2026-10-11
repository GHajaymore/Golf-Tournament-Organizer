import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A NINE-HOLE ROUND HAS ONE SKINS GAME, WHATEVER "HOLES" SAYS (sweep 1, d8,
 * 2026-10-10).
 *
 * A skins pot is keyed on (round, net, HOLES, group), because a league
 * playing eighteen runs a front-nine game and a back-nine game on one round.
 * On a nine-hole round there is only the nine: `scopeRange` plays the card it
 * has whichever of "All 18", "Front 9" and "Back 9" is chosen. But the picker
 * still offered all three, and each one saved a SEPARATE pot — the same nine
 * holes, three games, three sets of entrants. Changing "Holes" and pressing
 * Save looked like an edit and left the first pot, and everybody's stake in
 * it, behind under the old choice.
 *
 * The write now treats the three as what they are on such a round — one game
 * — and the card does not ask. An eighteen-hole round is untouched.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NINESKINS";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { saveSkinsPot } = await import("@/app/actions/skins");
const { readSource } = await import("./source");

let eventId = "";
const stage: Record<string, string> = {};

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} twilight`, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${process.pid}`, format: "stroke", moneyMode: "split", status: "live",
    },
  });
  eventId = event.id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  const round = async (key: string, position: number, holes: number, nine: string) => {
    stage[key] = (
      await prisma.stage.create({ data: { eventId, position, type: "Stroke Play Round", format: "Stroke Play", holes, nine, scoringBasis: "gross" } })
    ).id;
  };
  await round("back", 0, 9, "back");
  await round("open", 1, 9, "full");
  await round("eighteen", 2, 18, "full");
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const pots = (stageId: string) =>
  prisma.skinsPot.findMany({ where: { stageId }, select: { scope: true, net: true, buyInCents: true }, orderBy: { scope: "asc" } });

describe("skins on a nine-hole round", () => {
  for (const key of ["back", "open"] as const) {
    it(`is one game however "Holes" is set — a ${key === "back" ? "back-nine" : "nine-hole"} round`, async () => {
      expect((await saveSkinsPot(stage[key], { buyInCents: 200, net: false, scope: "full" })).ok).toBe(true);
      expect((await saveSkinsPot(stage[key], { buyInCents: 300, net: false, scope: "front" })).ok).toBe(true);
      expect((await saveSkinsPot(stage[key], { buyInCents: 500, net: false, scope: "back" })).ok).toBe(true);
      const found = await pots(stage[key]);
      expect(found, "the same nine holes, saved as three separate games").toHaveLength(1);
      // The last save is an edit of the one game, not a new one beside it.
      expect(found[0].buyInCents).toBe(500);
    });
  }

  it("still keeps gross and net apart — those are different games on the same nine", async () => {
    await saveSkinsPot(stage.back, { buyInCents: 100, net: true, scope: "front" });
    const found = await pots(stage.back);
    expect(found.map((p) => p.net).sort()).toEqual([false, true]);
  });

  it("CONTROL: an eighteen-hole round keeps a game for each set of holes", async () => {
    for (const scope of ["full", "front", "back"]) await saveSkinsPot(stage.eighteen, { buyInCents: 200, net: false, scope });
    expect((await pots(stage.eighteen)).map((p) => p.scope)).toEqual(["back", "front", "full"]);
  });

  it("and the card does not ask which holes when the round is only nine", () => {
    const src = readSource("src/components/SkinsPotClient.tsx");
    expect(src).toContain("view.roundHoles !== 9");
  });
});
