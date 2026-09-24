import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

// loadEventState reads the board through `unstable_cache`, which cannot run
// outside Next. Identity here, as in the other board audit tests.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { loadEventState, computeHighlights } from "@/lib/services/tournament";

/**
 * A STANDING PRINTS THE FIGURE THE BOARD IS RANKED ON — everywhere, not only on
 * the board table.
 *
 * `board-prints-what-it-ranked-on` pins that rule for the two BOARD readers
 * (`rankedScore`, `toParCell`). It missed two others, and a screen walk on
 * 2026-09-23 found both on the seeded club's April Medal — a NET monthly medal
 * whose board correctly read Marnie −18 (net to-par):
 *
 *   the leaderboard "🏆 Leader" card    "leads at +10 (net 53)"   ← GROSS to-par
 *   the dashboard "Flight standings"    +10, +20, +21 down a NET-sorted column
 *
 * Both read `StrokeStanding.toPar` — which is `gross - parThru` — instead of the
 * basis-aware figure the boards get from `toParOnBasis`. The fix computes that
 * figure ONCE, at the sink: `StrokeStanding.toParShown`. This pins it there, so
 * the flight card (which prints `toParShown`) and the highlight both follow the
 * board's basis and cannot drift back to the gross.
 *
 * Asserted against a NET medal where a handicap makes gross and net to-par
 * genuinely different — the only shape that can tell the fixed reader from the
 * broken one. Reverting either reader to `toPar` turns this red.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-standing-basis";

/** Eighteen par 4s → par 72, so a gross total reads straight off as to-par. */
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const YARDS = new Array(18).fill(400);

let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A gross card summing to `total` over 18 par-4 holes: extra shots up front. */
function cardTo(total: number): number[] {
  const over = total - 72;
  return Array.from({ length: 18 }, (_, h) => (h < over ? 5 : 4));
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Braid Hollow`,
      city: `${TAG} Glasgow`,
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(YARDS),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  // Rating = par and slope 113, so a course handicap equals the index — the
  // fixture needs strokes to be received, not a particular number of them.
  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: `${TAG} White`, gender: "M", courseRating: 72, slopeRating: 113, par: 72, position: 0 },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} April Medal`,
      status: "live",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "2026-09-23",
      course: `${TAG} Braid Hollow`,
      city: `${TAG} Glasgow`,
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(YARDS),
      customStrokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      nine: "full",
      courseId: course.id,
      teeId: tee.id,
      scoringBasis: "net",
      handicapAllowance: 95,
      playedOn: "2026-09-23",
    },
    select: { id: true },
  });

  // The high handicapper shoots 80 gross and wins on net; the low one shoots 74
  // and does not. So the leader's gross to-par (+8) and net to-par diverge, and
  // "who leads" is a net question — exactly the medal that was misread.
  const field = [
    { who: "hi", handicap: 20, total: 80 },
    { who: "lo", handicap: 2, total: 74 },
  ];
  for (const [i, f] of field.entries()) {
    const player = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} ${f.who}`,
        email: `${TAG}-${f.who}-${randomBytes(3).toString("hex")}@example.invalid`,
        handicap: f.handicap,
        handicapType: "exact",
        seed: i + 1,
        status: "confirmed",
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        playerId: player.id,
        strokes: JSON.stringify(cardTo(f.total)),
        status: "approved",
        certifiedBy: `${TAG} marker`,
        certifiedAt: new Date(),
        approvedBy: `${TAG} organizer`,
        approvedAt: new Date(),
      },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a standing prints the figure the board is ranked on", () => {
  it("exposes a net-basis to-par at the sink, distinct from the raw gross to-par", async () => {
    const state = await loadEventState(eventId);
    const lead = state!.strokeStandings.filter((s) => s.ranked)[0];
    expect(lead, "no ranked leader — the fixture did not build a board").toBeTruthy();

    // CONTROL: the fixture must actually award strokes, or net and gross to-par
    // coincide and nothing here can tell the fixed reader from the broken one.
    expect(lead.net, "no strokes received — fixture broken, not the app").toBeLessThan(lead.gross);

    // The raw figure is still gross-based; readers that show a player their
    // standing must not use it directly.
    expect(lead.toPar).toBe(lead.gross - 72);
    // The sink figure follows the board's basis: net to-par on a net medal.
    expect(lead.toParShown).toBe(lead.net - 72);
    // And so it is NOT the gross to-par the two readers used to print.
    expect(lead.toParShown).not.toBe(lead.toPar);
  });

  it("names the leader on net to-par, not gross, in the highlight card", async () => {
    const state = await loadEventState(eventId);
    const lead = state!.strokeStandings.filter((s) => s.ranked)[0];
    const netToPar = lead.net - 72;
    const netStr = netToPar === 0 ? "level par" : netToPar > 0 ? `+${netToPar}` : `${netToPar}`;

    const leader = computeHighlights(state!).find((h) => h.title === "Leader");
    expect(leader, "no leader highlight").toBeTruthy();
    // Pinned in full: the gross reader would print `leads at +8 (net …)`.
    expect(leader!.text).toBe(`${lead.player.name} leads at ${netStr} (net ${lead.net}).`);
  });
});
