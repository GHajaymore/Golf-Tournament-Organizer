import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND NOBODY HAS PLAYED IS ASKED ABOUT BEFORE IT IS CLOSED (B113, the Golf Pro's ruling of 27 Nov 2026).
 *
 * `setRoundClosed` used to close an unplayed round without a word, and on a stroke board that takes every player's place.
 * Abandoning a round without replaying it is the Committee's decision (Rule 5.7; Committee Procedures), so the app ASKS,
 * as it does over an unsigned card (Rule 3.3b(2)); it does not refuse. A conceded match is a result (Rule 3.2b(1)), and
 * the app's own rule says so (`roundsWithResultsFrom`: a forfeit is a result), so a round whose only match was conceded is
 * never asked. Against real rows, through the one rule:
 *
 *   a four-ball session, no hole tapped         ASKED; open after; closed only on a confirmed `true`
 *   the same, the confirm sent as a truthy      still ASKED (the flag must be the boolean `true`)
 *     non-boolean
 *   a medal round with no card                  ASKED
 *   the same medal round with one card          closes on the first press (CONTROL)
 *   a session with one hole tapped              closes on the first press (CONTROL)
 *   a session whose only match was conceded     closes on the first press, no question
 *   a disputed, unplayed round                  REFUSED first (the dispute outranks the question)
 *   re-opening                                  never asks
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NOBODY-PLAYED";
const session = { email: `${TAG}.sec@example.invalid`.toLowerCase(), name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setRoundClosed } = await import("@/app/actions/tournament");

const QUESTION = (round: string) =>
  `Nobody has played a hole in ${round} yet. Close it anyway? If play was rained off, keep it open and change its day on Rounds & formats instead.`;
const empty = () => JSON.stringify(new Array(18).fill(null));
const closedAt = async (stageId: string) => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).closedAt;

const ids = { org: "", event: "", medal: "", tapped: "", conceded: "", disputed: "", blues: "", whites: "", a: "", b: "", matchTapped: "", matchConceded: "" };

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  ids.org = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
  const event = await prisma.event.create({
    data: {
      organizationId: ids.org, name: `${TAG} cup`, status: "live", dates: "Saturday", course: "Home", city: "", address: "",
      regDeadline: "", shareToken: `${TAG}-${process.pid}`, scoreApproval: "staff",
    },
  });
  ids.event = event.id;
  session.eventId = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: session.email, name: session.name, role: "admin" } });
  const stage = async (position: number, type: string, format: string) =>
    (await prisma.stage.create({ data: { eventId: event.id, position, type, format, holes: 18 } })).id;
  ids.medal = await stage(0, "Stroke Play Round", "Stroke Play");
  ids.tapped = await stage(1, "Team Session", "Four-Ball");
  ids.conceded = await stage(2, "Team Session", "Four-Ball");
  ids.disputed = await stage(3, "Team Session", "Four-Ball");
  const person = async (name: string, i: number) =>
    (await prisma.player.create({ data: { eventId: event.id, name: `Zz ${name}`, email: `${TAG}.${i}@example.invalid`.toLowerCase(), seed: i + 1, handicap: 10, status: "confirmed" } })).id;
  ids.a = await person("Ines Corvo", 0);
  ids.b = await person("Bram Ellery", 1);
  const side = async (stageId: string, name: string, seed: number, member: string) =>
    (await prisma.team.create({ data: { eventId: event.id, stageId, name, seed, members: { create: [{ playerId: member, position: 0 }] } } })).id;
  const match = async (stageId: string, groupName: string, extra: { holes?: string; forfeitedBy?: string; scoreStatus?: string }) => {
    const blues = await side(stageId, `${TAG} Blues`, 1, ids.a);
    const whites = await side(stageId, `${TAG} Whites`, 2, ids.b);
    const carrier = await prisma.group.create({ data: { eventId: event.id, name: groupName, position: 5, stageId, isCarrier: true } });
    return prisma.match.create({
      data: {
        eventId: event.id, stageId, groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: blues, teamBId: whites,
        holes: extra.holes ?? empty(), ...(extra.forfeitedBy === "blues" ? { forfeitedBy: blues } : {}), ...(extra.scoreStatus ? { scoreStatus: extra.scoreStatus } : {}),
      },
    });
  };
  // Four-ball sessions: one with nothing tapped, one conceded before the first tee, one disputed with nothing tapped.
  ids.matchTapped = (await match(ids.tapped, "Session 1", {})).id;
  ids.matchConceded = (await match(ids.conceded, "Session 2", { forfeitedBy: "blues" })).id;
  await match(ids.disputed, "Session 3", { scoreStatus: "disputed" });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("closing a round nobody has played is asked, never silent and never refused", () => {
  it("ASKS over a four-ball session with no hole tapped, and leaves it open", async () => {
    expect(await setRoundClosed(ids.tapped, true)).toEqual({ ok: false, needsUnsignedConfirm: true, error: QUESTION("Round 2") });
    expect(await closedAt(ids.tapped), "asked, and closed anyway").toBeNull();
  });

  it("a confirm that is not the boolean true is still asked (a public endpoint takes whatever it is sent)", async () => {
    for (const sent of ["yes", 1, {}, "true"]) {
      const res = await setRoundClosed(ids.tapped, true, sent as unknown as boolean);
      expect(res, `confirm ${JSON.stringify(sent)} closed an unplayed round`).toEqual({ ok: false, needsUnsignedConfirm: true, error: QUESTION("Round 2") });
    }
    expect(await closedAt(ids.tapped)).toBeNull();
  });

  it("Close anyway (true) closes it, kept; re-opening never asks", async () => {
    expect(await setRoundClosed(ids.tapped, true, true)).toEqual({ ok: true });
    expect(await closedAt(ids.tapped), "Close anyway did not close it").not.toBeNull();
    expect(await setRoundClosed(ids.tapped, false)).toEqual({ ok: true });
    expect(await closedAt(ids.tapped)).toBeNull();
  });

  it("CONTROL: one hole tapped on its match, and the same session closes on the first press", async () => {
    await prisma.match.update({ where: { id: ids.matchTapped }, data: { holes: JSON.stringify(["A", ...new Array(17).fill(null)]) } });
    expect(await setRoundClosed(ids.tapped, true)).toEqual({ ok: true });
    expect(await closedAt(ids.tapped)).not.toBeNull();
  });

  it("a match conceded before play is a result: no question", async () => {
    expect(await setRoundClosed(ids.conceded, true)).toEqual({ ok: true });
    expect(await closedAt(ids.conceded)).not.toBeNull();
  });

  it("a medal round with no card is asked; with one card in, it closes on the first press (CONTROL)", async () => {
    expect(await setRoundClosed(ids.medal, true)).toEqual({ ok: false, needsUnsignedConfirm: true, error: QUESTION("Round 1") });
    expect(await closedAt(ids.medal)).toBeNull();
    await prisma.scorecard.create({
      data: { eventId: ids.event, stageId: ids.medal, playerId: ids.a, strokes: JSON.stringify(new Array(18).fill(4)), status: "approved", approvedBy: "zz", approvedAt: new Date() },
    });
    expect(await setRoundClosed(ids.medal, true)).toEqual({ ok: true });
    expect(await closedAt(ids.medal)).not.toBeNull();
  });

  it("a dispute outranks the question: refused, even from a caller that confirmed", async () => {
    const res = await setRoundClosed(ids.disputed, true, true);
    expect(res.ok).toBe(false);
    expect(res.needsUnsignedConfirm).toBeUndefined();
    expect(res.error).toMatch(/^1 result in Round 4 is disputed/);
    expect(await closedAt(ids.disputed)).toBeNull();
  });
});
