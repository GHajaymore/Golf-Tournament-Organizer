import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

let session: { email: string; name: string; eventId: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createEvent, regenGroups } = await import("@/app/actions/tournament");
const { scoringMismatch } = await import("@/lib/domain/scoring-mismatch");
const { isHeadToHead } = await import("@/lib/stage-types");

/**
 * A charity day, built from its own template, plays as a charity day.
 *
 * WALKED, not reasoned about. On 2026-09-10 the flow was driven through the
 * browser as a new society secretary: create from the "Charity or company
 * day" template, eight players, generate flights. The app drew TWELVE
 * head-to-head matches for a Stableford outing, and every player who opened
 * their own card was told "Round Robin is match play, so your score is
 * recorded against your opponent rather than as your own card" — on a
 * template whose whole point is that the players score themselves.
 *
 * All of it came from one wrong word in the template: `type: "Round Robin"`
 * on a round nobody plays head to head. `stage-types.ts` has described that
 * failure since the medal round was added, and `createEvent` quotes it back
 * when explaining why "Start from scratch" no longer defaults a round. The
 * type was added; the two templates that needed it were never changed.
 *
 * WHY AN AUDIT TEST AND NOT THE CATALOGUE SWEEP NEXT DOOR. The sweep asserts
 * the template says the right thing. This asserts what the DATABASE ends up
 * holding after the real action runs — no matches, and an event whose Scoring
 * can rank what the round returns. Those are two different claims and only
 * the second one is what a player meets.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CHARITY";
const EMAIL = `${TAG}-secretary@example.invalid`.toLowerCase();

let organizationId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: EMAIL, name: `${TAG} secretary` }, select: { id: true } });
  const org = await prisma.organization.create({
    data: { name: `${TAG} society`, kind: "community" },
    select: { id: true },
  });
  organizationId = org.id;
  await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role: "owner" } });
  session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Create a tournament from a template, exactly as the picker screen does. */
async function fromTemplate(name: string, template: string) {
  const res = await createEvent(`${TAG} ${name}`, template, "single", undefined, organizationId);
  expect(res.ok, "created").toBe(true);
  const event = await prisma.event.findFirst({
    where: { name: `${TAG} ${name}` },
    select: { id: true, format: true, stages: { select: { id: true, type: true, format: true } } },
  });
  expect(event, "the tournament exists").not.toBeNull();
  return event!;
}

/** Put a field on it and draw the flights, as the Flights screen does. */
async function withField(eventId: string, howMany: number) {
  for (let i = 1; i <= howMany; i++) {
    await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} player ${i}`,
        email: `${TAG}-p${i}@example.invalid`.toLowerCase(),
        handicap: 10 + i,
        handicapType: "18",
        status: "confirmed",
        seed: i,
      },
    });
  }
  session = { email: EMAIL, name: `${TAG} secretary`, eventId, role: "admin", viewRole: "admin" };
  await regenGroups("balanced", "auto", 0);
}

describe("a charity day", () => {
  it("is a medal round, not a schedule of matches", async () => {
    const event = await fromTemplate("charity", "charity-day");
    expect(event.stages).toHaveLength(1);
    expect(event.stages[0].type, "the round type").toBe("Stroke Play Round");
    expect(isHeadToHead(event.stages[0].type), "nobody plays anybody").toBe(false);
  });

  it("draws no opponents when the flights are generated", async () => {
    /**
     * THE ASSERTION THAT MEASURES THE HARM RATHER THAN THE SETTING. A wrong
     * type is invisible on the Rounds screen; twelve matches for eight people
     * playing Stableford is not.
     */
    const event = await fromTemplate("draw", "charity-day");
    await withField(event.id, 8);
    const [groups, matches] = await Promise.all([
      prisma.group.count({ where: { eventId: event.id } }),
      prisma.match.count({ where: { eventId: event.id } }),
    ]);
    expect(groups, "the field is still divided into flights").toBeGreaterThan(0);
    expect(matches, "and nobody is drawn against anybody").toBe(0);
  });

  it("and its Scoring can rank what the round returns", async () => {
    /**
     * `Event.format` is the only thing `isStroke` reads, and nothing in the
     * creation path touched it — so a templated tournament kept the column
     * default, "match", and the board rendered a match-points table over a
     * medal: P, W, ½, L, PTS, every cell zero, the field in seed order.
     *
     * Asked through `scoringMismatch`, which states this rule for the screens,
     * rather than by comparing the column to a literal here. Two copies of one
     * rule is how one of them ends up wrong.
     */
    const event = await fromTemplate("scoring", "charity-day");
    expect(event.format).toBe("stroke");
    const rounds = event.stages.map((s) => ({ type: s.type, headToHead: isHeadToHead(s.type) }));
    expect(scoringMismatch(event.format, rounds), "nothing to warn about").toBeNull();
  });
});

describe("the templates that really are head to head", () => {
  it("keep their round robin and their match scoring", async () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING "NO TEMPLATE DRAWS OPPONENTS".
     * A weekly league night IS a round robin, and rewriting it to a medal
     * would take the whole format away from the outfit it was built for.
     */
    const event = await fromTemplate("league", "league-round");
    expect(event.stages[0].type).toBe("Round Robin");
    expect(event.stages[0].format).toBe("Match Play");
    expect(event.format, "and the board ranks by match points").toBe("match");
  });

  it("and a member-guest still draws its five nine-hole four-balls", async () => {
    const event = await fromTemplate("mg", "member-guest-rr");
    expect(event.stages).toHaveLength(5);
    expect(event.stages.every((s) => s.type === "Round Robin")).toBe(true);
    expect(event.format).toBe("match");
  });
});
