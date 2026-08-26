import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateAccessCode } from "../codes";
import { clearRateLimit } from "../rate-limit";

/**
 * A committee-scored tournament, attacked through the Round Code surface.
 *
 * The unit suites prove `canEnterScores` returns false for a player in a
 * staff-scored event. That was never the failure. The failure was that
 * savePlayMatchHoles and savePlayMatchResult never asked it — so an organizer
 * who handed out round codes only so the field could sign in was told scores
 * were the committee's alone, while any code holder could write a full card
 * and, because a score edit resets approval, drop an already-confirmed result
 * back to pending with nobody notified. A signed-off card silently un-signing
 * itself is the part a committee cannot recover from, because nothing on any
 * screen says it happened.
 *
 * Nothing short of driving the real action against real rows demonstrates
 * that: the guard is in the action, not in the screen, and the screen is
 * exactly what an attacker skips.
 *
 * Excluded from the default run — needs a live DATABASE_URL and writes rows,
 * all of which are deleted in afterAll.
 *   npx vitest run --config vitest.audit.config.ts
 */

/** One browser's cookie jar, so the play session round-trips for real. */
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

// Imported after the mocks are declared for readability only — vi.mock is
// hoisted above every import in this file regardless of where it is written.
import { claimPlayerSlot, savePlayMatchHoles, savePlayMatchResult } from "@/app/actions/play";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PLAY-ENTRY";
const CODE = generateAccessCode();
const EMPTY = JSON.stringify(new Array(18).fill(null));
const FULL_CARD = new Array(18).fill("A") as Array<"A" | "B" | "H" | null>;
/** A confirmation the committee already gave, which nothing here may undo. */
const SIGNED_OFF_BY = `${TAG}-committee`;

let eventId = "";
let matchId = "";
let playerAId = "";

/** The match as stored, for asserting a refusal actually wrote nothing. */
async function storedMatch() {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  return { holes: m.holes, scoreStatus: m.scoreStatus, confirmedById: m.confirmedById };
}

const setScoreEntryBy = (value: "staff" | "players") =>
  prisma.event.update({ where: { id: eventId }, data: { scoreEntryBy: value } });

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} club championship`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      // The configuration the bug was invisible in: the committee keeps the
      // cards, and codes exist only so players can sign in and see their tee
      // time and their result.
      scoreEntryBy: "staff",
      playerAccess: "code",
      scoreApproval: "staff",
    },
  });
  eventId = event.id;

  const [stage, group] = await Promise.all([
    prisma.stage.create({
      data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18, accessCode: CODE },
    }),
    prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0 } }),
  ]);

  const [a, b] = await Promise.all([
    prisma.player.create({ data: { eventId, name: `${TAG} Ainsley`, seed: 1, status: "confirmed" } }),
    prisma.player.create({ data: { eventId, name: `${TAG} Brody`, seed: 2, status: "confirmed" } }),
  ]);
  playerAId = a.id;

  const match = await prisma.match.create({
    data: {
      eventId,
      stageId: stage.id,
      groupId: group.id,
      round: 1,
      playerAId: a.id,
      playerBId: b.id,
      holes: EMPTY,
      // Already through approval — the state the exploit quietly reversed.
      scoreStatus: "confirmed",
      confirmedById: SIGNED_OFF_BY,
      confirmedBy: "Committee",
    },
  });
  matchId = match.id;
});

afterAll(async () => {
  try {
    await clearRateLimit("round-code", CODE);
    // Players, stages, groups, matches and audit rows all cascade from the
    // event; the organization is deleted last because the event hangs off it.
    if (eventId) await prisma.event.delete({ where: { id: eventId } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("a round code in a committee-scored tournament", () => {
  it("still signs the player in", async () => {
    // The code is how they reach their tee sheet and their result. Refusing
    // the sign-in would be a different tournament, not a safer one — the gate
    // belongs on the write.
    expect(await claimPlayerSlot(CODE, playerAId)).toEqual({ ok: true });
  });

  it("refuses a full card, and says who does enter scores", async () => {
    const res = await savePlayMatchHoles(matchId, FULL_CARD);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/entered by the organizer/);
  });

  it("leaves the committee's signed-off card exactly as it was", async () => {
    // The refusal has to be a refusal, not a rollback of a partial write —
    // and specifically it must not have reset the approval, which is the half
    // of the damage no screen would ever show.
    expect(await storedMatch()).toEqual({
      holes: EMPTY,
      scoreStatus: "confirmed",
      confirmedById: SIGNED_OFF_BY,
    });
  });

  it("refuses a phoned-in result too", async () => {
    // "3&2" writes the same card by another route. A guard on only one of the
    // two actions protects nothing.
    const res = await savePlayMatchResult(matchId, "A", "3&2");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/entered by the organizer/);
    expect(await storedMatch()).toEqual({
      holes: EMPTY,
      scoreStatus: "confirmed",
      confirmedById: SIGNED_OFF_BY,
    });
  });

  it("records nothing in the audit trail for an attempt it refused", async () => {
    // An audit line for a score that was never written would have a committee
    // chasing a player who did nothing.
    expect(await prisma.auditLog.count({ where: { matchId } })).toBe(0);
  });
});

describe("the same code once the organizer lets players score", () => {
  it("writes the card", async () => {
    // Proves the refusal above is the tournament's setting being honoured and
    // not an action that stopped working: same session, same match, one
    // setting changed.
    await setScoreEntryBy("players");
    expect(await savePlayMatchHoles(matchId, FULL_CARD)).toEqual({ ok: true });

    const stored = await storedMatch();
    expect(JSON.parse(stored.holes)).toEqual(FULL_CARD);
    // A new score always goes back through approval, whoever entered it.
    expect(stored.scoreStatus).toBe("pending");
    expect(stored.confirmedById).toBeNull();
  });

  it("takes a phoned-in result on the same terms", async () => {
    const res = await savePlayMatchResult(matchId, "A", "3&2");
    expect(res.ok).toBe(true);
    // A closed-out match is a finished round with holes nobody played, so the
    // reconstructed card is deliberately short of eighteen results.
    const holes = JSON.parse((await storedMatch()).holes) as Array<string | null>;
    expect(holes).toHaveLength(18);
    expect(holes.filter((h) => h === null)).toHaveLength(2);
  });

  it("goes back to refusing the moment the setting goes back", async () => {
    // Settings are changed mid-tournament — an organizer who takes scoring
    // back after a disputed card expects that to bind immediately, not at the
    // next sign-in.
    await setScoreEntryBy("staff");
    expect((await savePlayMatchHoles(matchId, FULL_CARD)).ok).toBe(false);
  });
});
