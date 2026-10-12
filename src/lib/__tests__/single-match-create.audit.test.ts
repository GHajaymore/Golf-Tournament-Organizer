import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The Single Match Stage can actually create its match.
 *
 * From the 2026-08-27 exploratory audit. `createSingleMatch` wrote
 * `groupId: ""` into a column that is NOT NULL and carries a foreign key to
 * `Group` — and since every Group id is a cuid, no such row can exist. Postgres
 * rejected the insert every time, the action threw rather than returning
 * `{ok:false}`, so the picker's error handler never ran and the button simply
 * did nothing. The feature was one hundred percent non-functional against any
 * real database. `createThirdPlaceMatch` had the identical line.
 *
 * It survived a green suite because nothing ever invoked the action: the unit
 * tests cover the pure resolver, and the component tests render the picker with
 * the server action mocked away. Only a test that reaches Postgres can see it,
 * which is what this one is for.
 *
 *   npx vitest run --config vitest.audit.config.ts
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

import { createSession, setActiveEvent } from "@/lib/auth";
import { setSingleMatchRule, createSingleMatch } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SINGLEMATCH";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let eventId = "";
let orgId = "";
let eighteenId = "";
let nineId = "";
let organizerUserId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} championship`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      scoreEntryBy: "staff",
      playerAccess: "email",
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  // Two Single Match Stages: the final over eighteen, and a nine-hole one,
  // because the empty card has to be sized to the round it is played over.
  const [eighteen, nine] = await Promise.all([
    prisma.stage.create({
      data: { eventId, position: 0, type: "Single Match Stage", format: "Match Play", holes: 18 },
    }),
    prisma.stage.create({
      data: { eventId, position: 1, type: "Single Match Stage", format: "Match Play", holes: 9 },
    }),
  ]);
  eighteenId = eighteen.id;
  nineId = nine.id;

  for (const [i, who] of ["ann", "rob"].entries()) {
    const p = await prisma.player.create({
      // Confirmed, because the resolver's field is the confirmed list.
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
  }

  const organizer = await prisma.user.create({
    data: { email: at("organizer"), name: "organizer", password: "x" },
  });
  organizerUserId = organizer.id;
  await prisma.account.create({
    data: { eventId, email: at("organizer"), name: "organizer", role: "admin" },
  });

  jar.clear();
  await createSession(organizerUserId);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("creating the match a Single Match Stage resolves to", () => {
  it("stores a rule that names both players", async () => {
    const res = await setSingleMatchRule(eighteenId, {
      kind: "named",
      a: player.ann,
      b: player.rob,
    });
    expect(res.ok).toBe(true);
  });

  it("creates the match — it used to throw on a foreign key every time", async () => {
    const res = await createSingleMatch(eighteenId);
    // The failure this replaces was not `{ok:false}`. The action threw, which
    // is why the picker showed no error: there was no result to read.
    expect(res.error ?? "").toBe("");
    expect(res.ok).toBe(true);
  });

  it("puts the match in a real group, not an empty string", async () => {
    const match = await prisma.match.findFirstOrThrow({ where: { eventId, stageId: eighteenId } });
    expect(match.groupId).not.toBe("");
    const group = await prisma.group.findUnique({ where: { id: match.groupId } });
    expect(group).not.toBeNull();
    expect(group!.eventId).toBe(eventId);
  });

  it("pairs the two players the rule named", async () => {
    const match = await prisma.match.findFirstOrThrow({ where: { eventId, stageId: eighteenId } });
    expect([match.playerAId, match.playerBId].sort()).toEqual([player.ann, player.rob].sort());
  });

  it("gives it a card of eighteen empty holes", async () => {
    // `"[]"` parsed to a zero-length card, and the entry screen falls back to
    // `holes.length || 18` — which is right by accident on eighteen and wrong
    // on a nine.
    const match = await prisma.match.findFirstOrThrow({ where: { eventId, stageId: eighteenId } });
    const holes = JSON.parse(match.holes) as unknown[];
    expect(holes).toHaveLength(18);
    expect(holes.every((h) => h === null)).toBe(true);
  });

  it("refuses to make a second match for the same round", async () => {
    const again = await createSingleMatch(eighteenId);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already has its match/i);
    const all = await prisma.match.findMany({ where: { eventId, stageId: eighteenId } });
    expect(all).toHaveLength(1);
  });
});

describe("a nine-hole single match", () => {
  it("creates it", async () => {
    const ruled = await setSingleMatchRule(nineId, { kind: "named", a: player.ann, b: player.rob });
    expect(ruled.ok).toBe(true);
    const res = await createSingleMatch(nineId);
    expect(res.error ?? "").toBe("");
    expect(res.ok).toBe(true);
  });

  it("gives it NINE empty holes, not eighteen", async () => {
    const match = await prisma.match.findFirstOrThrow({ where: { eventId, stageId: nineId } });
    const holes = JSON.parse(match.holes) as unknown[];
    expect(holes).toHaveLength(9);
  });

  it("still lands in a real group", async () => {
    const match = await prisma.match.findFirstOrThrow({ where: { eventId, stageId: nineId } });
    const group = await prisma.group.findUnique({ where: { id: match.groupId } });
    expect(group).not.toBeNull();
  });
});

/**
 * THE RULE NAMES THINGS THAT ARE IN THIS TOURNAMENT, AND OF THE RIGHT KIND
 * (sweep 1, b11, 2026-10-10).
 *
 * `setSingleMatchRule` checked only that the rule could be read: two ids,
 * different from each other. It never asked what they were ids OF. The picker
 * then supplied the wrong ones itself — switching from "Two players I pick"
 * to "Winners of two rounds" carried the two PLAYER ids across and saved them
 * as rounds — so the round read "Waiting on the earlier rounds — one hasn't
 * finished" for ever, about two rounds that do not exist. The same permanent
 * not-ready state `cloneSingleMatchRule` exists to prevent in a copy.
 */
describe("a rule made of the wrong ids is refused", () => {
  let thirdId = "";
  let elsewherePlayerId = "";
  let elsewhereStageId = "";

  beforeAll(async () => {
    thirdId = (await prisma.stage.create({ data: { eventId, position: 2, type: "Round Robin", format: "Match Play", holes: 18 } })).id;
    const other = await prisma.event.create({
      data: { organizationId: orgId, name: `${TAG} another club's day`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-other-${Date.now()}` },
    });
    elsewherePlayerId = (await prisma.player.create({ data: { eventId: other.id, name: `${TAG} stranger`, email: at("stranger"), seed: 1, status: "confirmed" } })).id;
    elsewhereStageId = (await prisma.stage.create({ data: { eventId: other.id, position: 0, type: "Round Robin", format: "Match Play", holes: 18 } })).id;
  });

  const stored = async () => (await prisma.stage.findUnique({ where: { id: eighteenId }, select: { singleMatchRule: true } }))?.singleMatchRule;

  it("CONTROL: two other rounds of this tournament are accepted", async () => {
    expect((await setSingleMatchRule(eighteenId, { kind: "stage-winners", a: nineId, b: thirdId })).ok).toBe(true);
  });

  const cases: Array<[string, () => { kind: string; a: string; b: string }]> = [
    ["two PLAYERS given as the rounds to take winners from", () => ({ kind: "stage-winners", a: player.ann, b: player.rob })],
    ["two ROUNDS given as the players", () => ({ kind: "named", a: nineId, b: thirdId })],
    ["the round itself as one of the rounds it waits on", () => ({ kind: "stage-winners", a: eighteenId, b: nineId })],
    ["a round from another tournament", () => ({ kind: "stage-winners", a: nineId, b: elsewhereStageId })],
    ["a player from another tournament", () => ({ kind: "named", a: player.ann, b: elsewherePlayerId })],
  ];
  for (const [what, rule] of cases) {
    it(`${what}: refused, and the stored rule is untouched`, async () => {
      const before = await stored();
      const res = await setSingleMatchRule(eighteenId, rule());
      expect(res.ok, `stored a pairing made of ${what}`).toBe(false);
      expect(await stored()).toBe(before);
    });
  }
});
