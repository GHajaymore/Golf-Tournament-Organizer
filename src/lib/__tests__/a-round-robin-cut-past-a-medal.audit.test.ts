import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND ROBIN'S CUT TAKEN PAST A MEDAL, ON REAL ROWS (J31 review, 2026-11-07).
 *
 * Round 1 a round robin, Round 2 a medal with no cut, Round 3 a round robin of
 * the top 2. The draw (`generateCutRound`) cuts Round 3 from the table of the
 * LAST ROUND ROBIN BEFORE IT, by position — Round 1 — not from the medal beside
 * it, which has no table: a qualifying ladder is points, and a medal in between
 * does not move the cut off it. Everything the committee is shown about a tie
 * at that line must ask the same question, or the draw refuses with "record who
 * won it below" while nothing below can record it.
 *
 * The table, worked by hand (win 2, halve 1, loss 0; every match 1 up):
 *
 *   Ann b Bea, Cat, Dot, Eve                       Ann 8
 *   Bea b Cat, Bea b Dot; Eve b Bea                Bea 4   ┐ level on points
 *   Cat b Dot, Cat b Eve                           Cat 4   ┘
 *   Dot b Eve                                      Dot 2, Eve 2
 *
 * Top 2 by play-off (Committee Procedures 5A(6)): Ann through; Bea and Cat owe
 * a play-off for the second place. Cat wins it, so Round 3 is Ann v Cat — the
 * player the table placed lower, which only a recorded play-off can give.
 *
 *   npx vitest run --config vitest.audit.config.ts a-round-robin-cut-past-a-medal
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
import { generateNextRound, settleCutTie, setStageCutTies } from "@/app/actions/tournament";
import { roundRobinCutOf } from "@/lib/services/regroup";
import { loadEventState } from "@/lib/services/tournament";
import { currentRoundCut, currentRoundCutRule } from "@/lib/domain/cut";
import { cutAfterRound } from "@/lib/domain/cut-ready";

const prisma = new PrismaClient();
const TAG = "zz-rr-cut-past-medal";
const at = (who: string) => `${TAG}-${who}@example.invalid`;
const id: Record<string, string> = {};
let orgId = "";
let eventId = "";
let r1 = "";
let r2 = "";
let r3 = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

const H = (first: "A" | "B") => JSON.stringify([first, ...new Array(17).fill("H")]);

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
  eventId = (
    await prisma.event.create({
      data: {
        name: `${TAG} Autumn Qualifier`,
        organizationId: orgId,
        status: "live",
        configUnlocked: true,
        format: "match",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${Date.now()}`,
      },
    })
  ).id;
  const flight = (await prisma.group.create({ data: { eventId, name: "Flight A", position: 0 } })).id;
  const rr = { eventId, type: "Round Robin", format: "Match Play", holes: 18 };
  r1 = (await prisma.stage.create({ data: { ...rr, position: 0, description: "Round 1" } })).id;
  r2 = (
    await prisma.stage.create({
      data: { eventId, type: "Stroke Play Round", format: "Stroke Play", holes: 18, position: 1, description: "Round 2" },
    })
  ).id;
  r3 = (
    await prisma.stage.create({
      data: {
        ...rr,
        position: 2,
        description: "Round 3",
        cutEnabled: true,
        cutScope: "overall",
        cutMode: "count",
        cutCount: 2,
        cutTies: "playoff",
      },
    })
  ).id;
  // Handicaps that would put Cat through on handicap, and entry order Bea.
  const field: [string, number][] = [["ann", 4], ["bea", 9], ["cat", 2], ["dot", 6], ["eve", 7]];
  for (const [i, [who, handicap]] of field.entries()) {
    id[who] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who[0].toUpperCase()}${who.slice(1)}`, email: at(who), seed: i + 1, status: "confirmed", handicap, groupId: flight },
      })
    ).id;
  }
  const results: [string, string, "A" | "B"][] = [
    ["ann", "bea", "A"], ["ann", "cat", "A"], ["ann", "dot", "A"], ["ann", "eve", "A"],
    ["bea", "cat", "A"], ["bea", "dot", "A"], ["bea", "eve", "B"],
    ["cat", "dot", "A"], ["cat", "eve", "A"],
    ["dot", "eve", "A"],
  ];
  for (const [a, b, w] of results) {
    await prisma.match.create({ data: { eventId, stageId: r1, groupId: flight, round: 1, playerAId: id[a], playerBId: id[b], holes: H(w) } });
  }
  const user = await prisma.user.create({ data: { email: at("sec"), name: `${TAG} Secretary`, password: "x:unusable", emailVerifiedAt: new Date() } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "owner" } });
  await prisma.account.create({ data: { eventId, email: at("sec"), name: `${TAG} Secretary`, role: "admin" } });
  jar.clear();
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

async function roundThreeField(): Promise<string[]> {
  const matches = await prisma.match.findMany({ where: { stageId: r3 }, select: { playerAId: true, playerBId: true } });
  const ids = new Set(matches.flatMap((m) => [m.playerAId, m.playerBId]));
  return Object.keys(id).filter((k) => ids.has(id[k])).sort();
}

describe("a round robin's cut taken past a medal: the tie card, the record and the draw ask one table", () => {
  it("the Stages card is shown the tie, against Round 1's table — not none, for the medal beside it", async () => {
    const made = await roundRobinCutOf(eventId, r3);
    expect(made, "the round robin's cut into Round 3").not.toBeNull();
    expect(made!.feeder.id, "taken out of Round 1, the last round robin before it").toBe(r1);
    expect([...made!.outcome.through]).toEqual([id.ann]);
    expect(made!.outcome.undecided.map((t) => [[...t.playerIds].sort(), t.places, t.by])).toEqual([[[id.bea, id.cat].sort(), 1, "playoff"]]);
  });

  it("the board and the dashboard say what Round 1's sheet says: the cut into Round 3, and the tie", async () => {
    // Round 1 is the round being played, and its table decides the cut into
    // Round 3 (`cutDecidedBy`, 2026-11-07) — not the medal beside it. So the
    // board lights Ann alone, marks Bea and Cat tied by play-off, and never
    // lights Bea, whom the table lists second only on head-to-head.
    const state = (await loadEventState(eventId))!;
    expect(state.qualifying, "a cut is being played for").toBe(true);
    expect([...state.advancingIds]).toEqual([id.ann]);
    expect(state.cutTiesUndecided.map((t) => [[...t.playerIds].sort(), t.places, t.by])).toEqual([[[id.bea, id.cat].sort(), 1, "playoff"]]);
    // The dashboard's card, from the rounds the dashboard hands it.
    const at = state.playRounds.findIndex((s) => s.id === state.activeStage?.id);
    expect(state.activeStage?.id, "Round 1 is the round being played").toBe(r1);
    const card = currentRoundCut(state.playRounds, at, 1)!;
    expect(card.label).toBe("Round 1 → Round 3 · top 2 advance");
    // And Round 1's rules sheet, the same cut into the same round.
    const sheet = cutAfterRound(state.playRounds, r1)!;
    expect(sheet.into).toBe("Round 3");
    expect(sheet.rule).toEqual(currentRoundCutRule(state.playRounds, at));
  });

  it("the same with the tournament's Scoring set to Stroke play — a mixed tournament may be either", async () => {
    // A round robin feeding a medal is a MIXED tournament, which
    // `scoringMismatch` calls set up correctly under either Scoring. The draw
    // never reads the setting (`generateCutRound` cuts on the table), so the
    // board may not either: it lit nobody and marked no tie under Stroke play
    // while the draw refused for the tie (round train-1107-3, J31).
    await prisma.event.update({ where: { id: eventId }, data: { format: "stroke" } });
    try {
      const state = (await loadEventState(eventId))!;
      expect(state.isStroke, "the fixture is what it says").toBe(true);
      expect([...state.advancingIds]).toEqual([id.ann]);
      expect(state.cutTiesUndecided.map((t) => [[...t.playerIds].sort(), t.places, t.by])).toEqual([[[id.bea, id.cat].sort(), 1, "playoff"]]);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { format: "match" } });
    }
  });

  it("the draw refuses, the play-off is recorded against Round 1, and Round 3 is drawn with its winner", async () => {
    const refused = await generateNextRound(r3);
    expect(refused.ok).toBe(false);
    expect("error" in refused ? refused.error : "").toBe(
      `${TAG} Bea and ${TAG} Cat are level on points for the last place. This cut settles a tie by play-off: record who won it below, then draw the round.`,
    );
    expect(await roundThreeField(), "nothing drawn").toEqual([]);

    // Recorded against the round robin the cut is taken out of, as the card's button presses it.
    expect(await settleCutTie(r1, [id.cat, id.bea], [id.cat])).toEqual({ ok: true });
    // CONTROL: the medal is not what the cut is taken out of.
    expect((await settleCutTie(r2, [id.cat, id.bea], [id.cat])).ok, "the medal has no table").toBe(false);

    const decided = await roundRobinCutOf(eventId, r3);
    expect([...decided!.outcome.through].sort()).toEqual([id.ann, id.cat].sort());
    expect(decided!.outcome.undecided).toEqual([]);

    const drawn = await generateNextRound(r3);
    expect(drawn.ok, "error" in drawn ? drawn.error : "").toBe(true);
    expect(await roundThreeField(), "the play-off's winner, though the table placed her lower").toEqual(["ann", "cat"]);
  });

  it("with ties going through, the cut takes all three level on 4 or more — the same table", async () => {
    await setStageCutTies(r3, "ties");
    await prisma.stage.update({ where: { id: r3 }, data: { cutTieDecisions: "[]" } });
    const made = await roundRobinCutOf(eventId, r3);
    expect(made!.outcome.undecided).toEqual([]);
    expect([...made!.outcome.through].sort()).toEqual([id.ann, id.bea, id.cat].sort());
  });
});
