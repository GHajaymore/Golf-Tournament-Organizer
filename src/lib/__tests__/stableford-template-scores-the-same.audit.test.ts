import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { weekViewFor } from "@/lib/services/week-view";
import { TOURNAMENT_TEMPLATES } from "@/lib/tournament-templates";

/**
 * THE STABLEFORD TEMPLATE MOVED TO THE CANONICAL SPELLING, AND SCORES THE SAME.
 *
 * The template started a round as `Stroke Play` + basis `stableford` — the
 * legacy spelling the Rounds screen no longer offers, so a newcomer who picked
 * "Stableford" was shown a round called "Stroke Play" with no scoring option
 * ticked (walked 2026-09-27). It now starts `Stableford` + `net`, the model
 * decided on 2026-09-20: the format gives the unit, the basis the allocation.
 *
 * That is a change to what EVERY new Stableford tournament stores, so its
 * safety is measured here rather than argued: the same two cards, through the
 * reader a board uses, on a round stored each way.
 *
 * The fixture is built to be able to DISAGREE. Real handicaps (14.0 and 22.3),
 * so the allowance and the allocation both enter; a blow-up hole where the
 * points floor at zero, which is the one place points and net part company;
 * and one player's points worked by hand from the Rules, so the two rounds
 * agreeing cannot be two readers wrong the same way.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-stableford-template";
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 1, 15, 3, 11, 5, 17, 9, 13, 8, 2, 16, 4, 12, 6, 18, 10, 14];

/** Ordinary mid-handicap golf, with one 10 on the stroke index 1 par 4. */
const STEADY = PARS.map((p, i) => (i === 1 ? 10 : p + (i % 3 === 0 ? 1 : 0)));
/** Bogey golf, and a par-3 triple. */
const HACKER = PARS.map((p, i) => (i === 2 ? p + 3 : p + 1));

let eventId = "";
const stages: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "community" }, select: { id: true } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} outing`,
        status: "live",
        shape: "series",
        format: "stroke",
        dates: "",
        course: `${TAG} Course`,
        city: "",
        address: "",
        regDeadline: "",
        capacity: 0,
        shareToken: randomBytes(10).toString("hex"),
        registrationToken: randomBytes(6).toString("hex"),
        customPars: JSON.stringify(PARS),
        customYards: JSON.stringify(new Array(18).fill(380)),
        customStrokeIndex: JSON.stringify(SI),
      },
      select: { id: true },
    })
  ).id;

  const players = [];
  for (const [who, hcp] of [["steady", 14.0], ["hacker", 22.3]] as const) {
    players.push(
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`, handicap: hcp, handicapType: "18", seed: players.length + 1, status: "confirmed" },
        select: { id: true },
      }),
    );
  }

  const template = TOURNAMENT_TEMPLATES.find((t) => t.key === "charity-day")!.rounds[0];
  const rounds: Array<[string, string, string]> = [
    ["legacy", "Stroke Play", "stableford"],
    ["template", template.format, template.scoringBasis],
  ];
  for (const [i, [label, format, scoringBasis]] of rounds.entries()) {
    stages[label] = (
      await prisma.stage.create({
        data: { eventId, position: i, description: label, type: "Stroke Play Round", format, scoringBasis, holes: 18 },
        select: { id: true },
      })
    ).id;
    await prisma.scorecard.create({ data: { eventId, stageId: stages[label], playerId: players[0].id, strokes: JSON.stringify(STEADY) } });
    await prisma.scorecard.create({ data: { eventId, stageId: stages[label], playerId: players[1].id, strokes: JSON.stringify(HACKER) } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

async function board(label: string) {
  const week = await weekViewFor(eventId, stages[label]);
  return {
    basis: week!.basis,
    rows: week!.results
      .filter((r) => r.thru > 0)
      .map((r) => ({ who: r.name.replace(`${TAG} `, ""), position: r.position, points: r.points, net: r.net, gross: r.gross })),
  };
}

describe("the Stableford template's round, against the legacy spelling it replaced", () => {
  it("starts the canonical spelling", () => {
    const r = TOURNAMENT_TEMPLATES.find((t) => t.key === "charity-day")!.rounds[0];
    expect([r.format, r.scoringBasis]).toEqual(["Stableford", "net"]);
  });

  it("ranks on points, with the same points, net and places for the same cards", async () => {
    const legacy = await board("legacy");
    const now = await board("template");
    expect(legacy.rows, "both cards are in").toHaveLength(2);
    expect(now.basis).toBe("stableford");
    expect(legacy.basis).toBe("stableford");
    expect(now.rows).toEqual(legacy.rows);
  });

  it("and the points are the Rules' own, handicap and all (the control)", async () => {
    /**
     * Worked by hand under Rule 21.1, so agreement between the two rounds
     * cannot be two readers wrong the same way. The hacker, 22.3 at the 95%
     * individual allowance, plays off 21: one shot on every hole and a second
     * on stroke index 1–3.
     *
     *   14 bogeys with one shot     net par      2 pts each   28
     *    3 bogeys with two shots    net birdie   3 pts each    9
     *    the par-3 triple, one shot net double   0             0
     *                                                         37
     *
     * Off scratch the same card is worth 17, so 37 is the handicap entering.
     */
    const now = await board("template");
    expect(now.rows.find((r) => r.who === "hacker")!.points).toBe(37);
  });
});
