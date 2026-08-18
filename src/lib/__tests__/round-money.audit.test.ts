import "dotenv/config";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor } from "@/lib/services/expenses";

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

  it("never reports a round as final before its holes are in", async () => {
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
      if (r.final && status !== "completed") {
        expect(r.holesReturned, r.label).toBeGreaterThanOrEqual(r.holeCount);
      }
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
