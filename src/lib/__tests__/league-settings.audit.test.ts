import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * THE LEAGUE'S RULES, WRITTEN BY THE ORGANIZER AND NOBODY ELSE.
 *
 * `setLeagueSettings` is a public endpoint, so the three things worth proving
 * need real rows: an assistant cannot change what a week is worth, a value
 * the form would never send is refused rather than stored, and a change that
 * re-scores the whole season leaves a line in the audit log saying so.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-settings";

const session = { email: `${TAG}@example.invalid`, name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setLeagueSettings } = await import("@/app/actions/league");

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const read = () =>
  prisma.event.findUniqueOrThrow({
    where: { id: session.eventId },
    select: { leaguePoints: true, leagueMatchBonus: true, leaguePairs: true, leaguePlayoffClubs: true },
  });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  session.eventId = event.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("league settings", () => {
  it("stores what the organizer chose, and logs the change against the old values", async () => {
    session.role = "admin";
    const result = await setLeagueSettings({ points: "holes-and-match", matchBonus: 3, pairs: 6, playoffs: 4 });
    expect(result).toEqual({ ok: true });
    expect(await read()).toEqual({ leaguePoints: "holes-and-match", leagueMatchBonus: 3, leaguePairs: 6, leaguePlayoffClubs: 4 });

    const log = await prisma.auditLog.findFirst({
      where: { eventId: session.eventId, action: "league-settings" },
      select: { detail: true },
    });
    // Both halves: what it was (the defaults) and what it became.
    expect(log?.detail).toBe("League scoring off (bonus 2, pairs 0, play-offs 0) -> holes-and-match (bonus 3, pairs 6, play-offs 4)");
  });

  it("refuses an assistant, and leaves the league as it was", async () => {
    session.role = "assistant";
    try {
      await expect(setLeagueSettings({ points: "nassau", matchBonus: 0, pairs: 8, playoffs: 0 })).rejects.toThrow(
        "Organizer access required",
      );
    } finally {
      session.role = "admin";
    }
    expect(await read()).toEqual({ leaguePoints: "holes-and-match", leagueMatchBonus: 3, leaguePairs: 6, leaguePlayoffClubs: 4 });
  });

  it.each([
    ["an unknown system", { points: "stableford", matchBonus: 2, pairs: 6, playoffs: 0 }],
    ["a fractional bonus", { points: "match", matchBonus: 1.5, pairs: 6, playoffs: 0 }],
    ["a negative bonus", { points: "match", matchBonus: -1, pairs: 6, playoffs: 0 }],
    ["a bonus as text", { points: "match", matchBonus: "2", pairs: 6, playoffs: 0 }],
    ["an empty pairs box", { points: "match", matchBonus: 2, pairs: Number.NaN, playoffs: 0 }],
    ["too many pairs", { points: "match", matchBonus: 2, pairs: 25, playoffs: 0 }],
    ["a play-off of six", { points: "match", matchBonus: 2, pairs: 6, playoffs: 6 }],
    ["play-offs as text", { points: "match", matchBonus: 2, pairs: 6, playoffs: "4" }],
  ])("refuses %s without writing", async (_, input) => {
    const result = await setLeagueSettings(input);
    expect(result.ok).toBe(false);
    expect(await read()).toEqual({ leaguePoints: "holes-and-match", leagueMatchBonus: 3, leaguePairs: 6, leaguePlayoffClubs: 4 });
  });

  it("switches the league off with an empty system, and says so in the log", async () => {
    expect(await setLeagueSettings({ points: "", matchBonus: 3, pairs: 6, playoffs: 0 })).toEqual({ ok: true });
    expect((await read()).leaguePoints).toBe("");
    const last = await prisma.auditLog.findFirst({
      where: { eventId: session.eventId, action: "league-settings" },
      orderBy: { createdAt: "desc" },
      select: { detail: true },
    });
    expect(last?.detail).toBe("League scoring holes-and-match (bonus 3, pairs 6, play-offs 4) -> off (bonus 3, pairs 6, play-offs 0)");
  });
});
