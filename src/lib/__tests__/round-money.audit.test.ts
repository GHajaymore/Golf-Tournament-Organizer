import "dotenv/config";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor } from "@/lib/services/expenses";
import { matchIsOver, type HoleResult } from "@/lib/domain";

/**
 * The player's round-by-round money, against real data.
 *
 * Two properties matter and neither can be checked in the pure layer, because
 * both are about what the SERVICE chooses to compute:
 *
 *   - a round still being played reports nothing. Not hidden after the fact —
 *     not worked out at all, so there is no half-answer to leak;
 *   - the outing total is the rounds added up, so the two figures on the
 *     screen cannot disagree with each other.
 */

const prisma = new PrismaClient();

describe("what a player is told about the money", () => {
  it("adds the rounds up into the outing total", async () => {
    const ev = await prisma.event.findFirst({ select: { id: true } });
    if (!ev) return; // an empty dev database is not a failure
    const player = await prisma.player.findFirst({
      where: { eventId: ev.id, email: { not: "" } },
      select: { email: true },
    });
    if (!player) return;

    const view = await roundMoneyFor(ev.id, player.email);
    const summed = view.rounds.reduce((a, r) => a + r.yourCents, 0);
    expect(view.yourTotalCents).toBe(summed);
  });

  it("computes nothing for a round that is still out", async () => {
    const ev = await prisma.event.findFirst({ select: { id: true } });
    if (!ev) return;
    const player = await prisma.player.findFirst({
      where: { eventId: ev.id, email: { not: "" } },
      select: { email: true },
    });
    if (!player) return;

    const view = await roundMoneyFor(ev.id, player.email);
    for (const r of view.rounds) {
      if (r.final) continue;
      // An unfinished round contributes nothing and shows nobody a position.
      expect(r.yourCents, r.label).toBe(0);
      expect(r.standing, r.label).toEqual([]);
    }
  });

  it("only reports a round as final for a reason it can name", async () => {
    /**
     * Three ways a round finishes, and it must be one of them.
     *
     * Holes returned is the stroke-play reading. Match play returns no
     * scorecards at all, so on that measure alone a match round would never
     * finish and its pots would never be reported — which is what happened
     * the first time this was tried against a real match-play tournament.
     * Every match OVER is the second reading, and the organizer closing the
     * tournament is the third.
     *
     * "Over" is the word that matters and this test used to get it wrong. It
     * checked for a match with any hole on it, mirroring what the service did
     * — which is how a test comes to assert current behaviour rather than the
     * rule, and it passed happily while a round one hole old called itself
     * final. See `round-finality.audit.test.ts`, which owns that rule against
     * a fixture it can control; this stays a shape check over whatever the
     * dev database happens to hold.
     */
    const ev = await prisma.event.findFirst({ select: { id: true } });
    if (!ev) return;
    const player = await prisma.player.findFirst({
      where: { eventId: ev.id, email: { not: "" } },
      select: { email: true },
    });
    if (!player) return;

    const view = await roundMoneyFor(ev.id, player.email);
    const status = (await prisma.event.findUnique({ where: { id: ev.id }, select: { status: true } }))?.status;

    for (const r of view.rounds) {
      if (!r.final || status === "completed") continue;
      const matches = await prisma.match.findMany({
        where: { stageId: r.stageId },
        select: { holes: true, forfeitedBy: true },
      });
      const everyMatchIn =
        matches.length > 0 &&
        matches.every((m) => {
          if (m.forfeitedBy) return true;
          try {
            return matchIsOver(JSON.parse(m.holes) as HoleResult[]);
          } catch {
            return false;
          }
        });
      expect(r.holesReturned >= r.holeCount || everyMatchIn, r.label).toBe(true);
    }
  });

  it("gives a stranger nothing rather than an empty-looking sheet", async () => {
    const ev = await prisma.event.findFirst({ select: { id: true } });
    if (!ev) return;
    const view = await roundMoneyFor(ev.id, "nobody@example.invalid");
    expect(view.playerId).toBe("");
    expect(view.yourTotalCents).toBe(0);
  });
});
