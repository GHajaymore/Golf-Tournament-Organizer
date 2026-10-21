import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A NASSAU NEEDS A MATCH (2026-09-29).
 *
 * A Nassau is three bets on one match, and "the match" is one; the money
 * engine settles both from the round's MATCHES, and a stroke round has none.
 * The screens never offer either on such a round — `ContestsClient` hides the
 * rows by `isHeadToHead`, and a casual round only on a head-to-head — but
 * `saveSideGame` wrote whatever it was sent. Found when seed data put a Nassau
 * on a medal and on a four-ball stroke round and neither ever settled.
 *
 * Through the real action, with the two controls that keep the rule honest: a
 * head-to-head round takes the bet, and a stake already on a stroke round can
 * still be switched OFF (a format changed after it was staked).
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MATCHBET";

let session: { eventId: string; email: string; viewRole: string; name: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveSideGame } = await import("@/app/actions/side-games");

let eventId = "";
let strokeStage = "";
let matchStage = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "", course: "Home", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  strokeStage = (
    await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Four-Ball", holes: 18 } })
  ).id;
  matchStage = (
    await prisma.stage.create({ data: { eventId, position: 1, type: "Round Robin", format: "Match Play", holes: 18 } })
  ).id;
  session = { eventId, email: "zz-audit-matchbet@example.invalid", viewRole: "admin", name: "organizer" };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const games = (stageId: string, kind: string) => prisma.sideGame.count({ where: { stageId, kind } });

describe("a bet on a match needs a match", () => {
  it("refuses a Nassau, or a bet on the match, on a stroke round — and writes nothing", async () => {
    for (const kind of ["nassau", "match"]) {
      const r = await saveSideGame(strokeStage, kind, 500);
      expect(r.ok, `${kind} was accepted on a stroke round`).toBe(false);
      expect("error" in r && r.error).toMatch(/need a match, and nobody in this round is playing one/);
      expect(await games(strokeStage, kind)).toBe(0);
    }
    // Played for a pint is still a bet on a match that is not there.
    expect((await saveSideGame(strokeStage, "nassau", 0, "", "a pint")).ok).toBe(false);
  });

  it("CONTROL: takes one on a head-to-head round", async () => {
    const r = await saveSideGame(matchStage, "nassau", 500);
    expect(r.ok).toBe(true);
    expect(await games(matchStage, "nassau")).toBe(1);
  });

  it("CONTROL: a stake already on a stroke round can still be switched off", async () => {
    // A round whose format changed after it was staked — the one way such a
    // row exists, and the screen keeps it visible so it can be removed.
    await prisma.sideGame.create({ data: { eventId, stageId: strokeStage, kind: "nassau", buyInCents: 500, groupKey: "" } });
    const r = await saveSideGame(strokeStage, "nassau", 0);
    expect(r.ok, "the stranded stake could not be removed").toBe(true);
    const row = await prisma.sideGame.findFirst({ where: { stageId: strokeStage, kind: "nassau" } });
    expect(row?.buyInCents).toBe(0);
  });

  it("CONTROL: a pot the cards decide is still fine on a stroke round", async () => {
    expect((await saveSideGame(strokeStage, "birdies", 500)).ok).toBe(true);
  });
});

/**
 * AND A FOURSOMES MATCH KEEPS ITS MATCH BETS (sweep 1, a3, 2026-10-10).
 *
 * A round where the side plays one ball has no individual score, so a pot
 * the CARDS decide — birdies, low net, skins — is rightly refused on it. But
 * `saveSideGame` refused every kind there, the two bets between SIDES
 * included, on the stated ground that a Nassau "would survive the question,
 * but it is refused with the rest rather than carved out".
 *
 * The casual-round form carves it out the other way and is right to: it
 * offers "the match" and a Nassau on a foursomes — that is how a foursomes is
 * played for money — and setup writes the bet. So the money screen showed a
 * stake box for a bet that existed, and changing the stake was refused with
 * "there are no individual scores to decide a pot on", about a bet no
 * individual score decides.
 */
describe("a match played with one ball a side", () => {
  let foursomes = "";

  beforeAll(async () => {
    foursomes = (
      await prisma.stage.create({ data: { eventId, position: 2, type: "Round Robin", format: "Foursomes", holes: 18 } })
    ).id;
  });

  for (const kind of ["match", "nassau"]) {
    it(`takes a new price for ${kind === "match" ? "the match" : "a Nassau"}`, async () => {
      expect((await saveSideGame(foursomes, kind, 500)).ok, `${kind} could not be staked on a foursomes match`).toBe(true);
      const again = await saveSideGame(foursomes, kind, 1000);
      expect(again.ok, `${kind} could not be re-priced`).toBe(true);
      const row = await prisma.sideGame.findFirst({ where: { stageId: foursomes, kind } });
      expect(row?.buyInCents).toBe(1000);
    });
  }

  it("CONTROL: a pot the cards decide is still refused there, and says why", async () => {
    for (const kind of ["birdies", "low-net", "low-gross"]) {
      const r = await saveSideGame(foursomes, kind, 500);
      expect(r.ok, `${kind} was accepted on a round with no individual scores`).toBe(false);
      expect("error" in r && r.error).toMatch(/one ball per side/);
    }
  });
});
