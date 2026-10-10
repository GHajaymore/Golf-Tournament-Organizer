import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A FOUR-BALL MEMBER KEEPS THEIR OWN CARD (2026-10-10).
 *
 * Walked on a club's 120-player four-ball medal: a member opened their card on
 * score entry, filled in eighteen holes, pressed Save — and the screen fell
 * over ("This screen didn't load"), nothing stored. `saveTeamScorecard` asked
 * `assertOwnMatch` about a match the round does not have: a team STROKE round
 * files its cards with an empty match, and for a player that threw "Match not
 * found.". Staff are waved through `assertOwnMatch`, so committee entry worked
 * and hid it — no member could ever save a four-ball medal card.
 *
 * Driven through the real action, signed in as the real roles, with the
 * controls that make the fix a fix rather than a hole: a member still cannot
 * save their partner's card, nor a card for a side they are not on.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { saveTeamScorecard } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FOURBALL-OWN";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const PARS = new Array(18).fill(4);
const card = PARS.map((p, i) => (i % 3 === 0 ? p + 1 : p));

let eventId = "";
let stageId = "";
const team: Record<string, string> = {};
const p: Record<string, string> = {};
const userIds: Record<string, string> = {};

async function signIn(who: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  eventId = (
    await prisma.event.create({
      data: {
        name: `${TAG} better-ball`,
        organizationId: org.id,
        status: "live",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-share`,
        customPars: JSON.stringify(PARS),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    })
  ).id;
  stageId = (
    await prisma.stage.create({
      data: { eventId, type: "Stroke Play Round", format: "Four-Ball", holes: 18, scoringBasis: "net", position: 0, description: "Round 1" },
      select: { id: true },
    })
  ).id;
  for (const [i, who] of ["a1", "a2", "b1", "b2"].entries()) {
    p[who] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed", handicap: 10 + i },
        select: { id: true },
      })
    ).id;
    userIds[who] = (await prisma.user.create({ data: { email: at(who), name: who, password: "x:unusable" }, select: { id: true } })).id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }
  for (const side of ["A", "B"]) {
    team[side] = (
      await prisma.team.create({
        data: {
          eventId,
          stageId,
          name: `${TAG} side ${side}`,
          members: { create: [{ playerId: p[`${side.toLowerCase()}1`] }, { playerId: p[`${side.toLowerCase()}2`] }] },
        },
        select: { id: true },
      })
    ).id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a four-ball medal, scored by its players", () => {
  it("a member saves their own card — there is no match to ask about", async () => {
    await signIn("a1");
    expect(await saveTeamScorecard(team.A, p.a1, "", card)).toEqual({ ok: true });
    const row = await prisma.teamScorecard.findFirst({ where: { stageId, teamId: team.A, playerId: p.a1 } });
    expect(row && JSON.parse(row.strokes)).toEqual(card);
  });

  it("CONTROL: not their partner's card", async () => {
    await signIn("a1");
    const res = await saveTeamScorecard(team.A, p.a2, "", card);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only enter your own card/);
  });

  it("CONTROL: not a card for a side they are not on", async () => {
    await signIn("a1");
    const res = await saveTeamScorecard(team.B, p.b1, "", card);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not on this team/);
    expect(await prisma.teamScorecard.count({ where: { stageId, teamId: team.B } })).toBe(0);
  });

  it("a refusal about a match is answered, not thrown", async () => {
    await signIn("a1");
    const res = await saveTeamScorecard(team.A, p.a1, "no-such-match", card);
    expect(res).toEqual({ ok: false, error: "Match not found." });
  });
});
