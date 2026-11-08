import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TIE FOR THE LAST PLACE AT A ROUND ROBIN'S CUT, ON REAL ROWS (J31, 2026-11-06).
 *
 * A flight of five plays a round robin; round 2 is a round robin of the top 2.
 * Worked by hand (win 2, halve 1, loss 0; every match 1 up):
 *
 *   Ann b Bea, Cat, Dot, Eve                       Ann 8
 *   Bea b Cat, Bea b Dot; Eve b Bea                Bea 4   ┐ level on points;
 *   Cat b Dot, Cat b Eve                           Cat 4   ┘ Bea won their meeting
 *   Dot b Eve                                      Dot 2, Eve 2
 *
 * The cut took the front of the table, which is Bea (head-to-head) — and where
 * the tie-breaks run out, whoever entered first. The committee's published
 * method decides it now (Committee Procedures 5A(6)), done here as the
 * secretary would, through the real actions:
 *
 *   play-off   the board lights Ann alone and marks Bea and Cat as tied, the
 *              round will not be drawn and says why, Cat wins the play-off,
 *              and round 2 is Ann v Cat — the player the table placed LOWER;
 *   countback  the table's own tie-break: Ann v Bea;
 *   ties       (the default) all three are drawn into round 2.
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
import { generateNextRound, settleCutTie, setStageCutTies } from "@/app/actions/tournament";
import { loadEventState, standingRows } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "zz-rr-cut-tie";
const at = (who: string) => `${TAG}-${who}@example.invalid`;
const id: Record<string, string> = {};
let orgId = "";
let eventId = "";
let r1 = "";
let r2 = "";

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
        name: `${TAG} Spring Round Robin`,
        organizationId: orgId,
        status: "live",
        // Unlocked: the tie rule is part of the cut's terms and locks with setup.
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
  const base = { eventId, type: "Round Robin", format: "Match Play", holes: 18 };
  r1 = (await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" } })).id;
  r2 = (
    await prisma.stage.create({
      data: { ...base, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 2 },
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

/** Who round 2 was drawn between, by key. */
async function roundTwoField(): Promise<string[]> {
  const matches = await prisma.match.findMany({ where: { stageId: r2 }, select: { playerAId: true, playerBId: true } });
  const ids = new Set(matches.flatMap((m) => [m.playerAId, m.playerBId]));
  return Object.keys(id).filter((k) => ids.has(id[k])).sort();
}

describe("a tie at a round robin's cut line, settled the committee's way", () => {
  it("the board marks the tie whatever the tournament's Scoring says — the draw never reads it", async () => {
    // Round train-1107-3 (J31): the browser walk's tournament was left at
    // Scoring "Stroke play" (two match-play round robins), and the board lit
    // nobody and marked no tie — it read the table only under "Match play" —
    // while the draw, which cuts on the table whatever the setting, refused
    // for the tie. One cut, one answer: the board asks what the draw asks.
    await setStageCutTies(r2, "playoff");
    await prisma.event.update({ where: { id: eventId }, data: { format: "stroke" } });
    try {
      const state = (await loadEventState(eventId))!;
      expect(state.isStroke, "the fixture is what it says").toBe(true);
      expect([...state.advancingIds].sort()).toEqual([id.ann]);
      expect(state.cutTiesUndecided.map((t) => [[...t.playerIds].sort(), t.places, t.by])).toEqual([[[id.bea, id.cat].sort(), 1, "playoff"]]);
      const rows = standingRows(state);
      for (const who of ["bea", "cat"]) {
        const r = rows.find((x) => x.id === id[who])!;
        expect([r.advancing, r.tiedAtCut, r.cutTieBy], who).toEqual([false, true, "playoff"]);
      }
      // The draw agrees: refused for the same tie.
      const refused = await generateNextRound(r2);
      expect("error" in refused ? refused.error : "").toMatch(/are level on points for the last place/);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { format: "match" } });
    }
  });

  it("a play-off: nobody in the tie is lit or drawn until the committee records who won it", async () => {
    await setStageCutTies(r2, "playoff");

    // The board: Ann through; Bea and Cat neither through nor out — tied, by play-off.
    const state = (await loadEventState(eventId))!;
    expect([...state.advancingIds].sort()).toEqual([id.ann]);
    expect(state.cutTiesUndecided.map((t) => [[...t.playerIds].sort(), t.places, t.by])).toEqual([[[id.bea, id.cat].sort(), 1, "playoff"]]);
    const rows = standingRows(state);
    for (const who of ["bea", "cat"]) {
      const r = rows.find((x) => x.id === id[who])!;
      expect([r.advancing, r.tiedAtCut, r.cutTieBy], who).toEqual([false, true, "playoff"]);
    }
    expect(rows.find((x) => x.id === id.dot)!.tiedAtCut, "control: Dot is simply behind").toBe(false);

    // Drawing round 2 is refused, at the press, with the tie named.
    const refused = await generateNextRound(r2);
    expect(refused.ok).toBe(false);
    expect("error" in refused ? refused.error : "").toBe(
      `${TAG} Bea and ${TAG} Cat are level on points for the last place. This cut settles a tie by play-off: record who won it below, then draw the round.`,
    );
    expect(await roundTwoField(), "nothing drawn").toEqual([]);

    // A wrong record is refused; then Cat wins the play-off.
    expect((await settleCutTie(r1, [id.bea, id.cat], [id.bea, id.cat])).ok).toBe(false);
    expect((await settleCutTie(r1, [id.bea, id.dot], [id.bea])).ok, "not the tie").toBe(false);
    expect(await settleCutTie(r1, [id.cat, id.bea], [id.cat])).toEqual({ ok: true });
    expect([...(await loadEventState(eventId))!.advancingIds].sort()).toEqual([id.ann, id.cat].sort());

    const drawn = await generateNextRound(r2);
    expect(drawn.ok, "error" in drawn ? drawn.error : "").toBe(true);
    expect(await roundTwoField(), "the play-off's winner, though the table placed her lower").toEqual(["ann", "cat"]);
  });

  it("a result recorded after round 2 is drawn says to redraw it — the draw does not move by itself", async () => {
    // Round 2 is drawn (Ann v Cat) and unplayed. The committee corrects the
    // play-off to Bea: recorded, and told plainly that the round it already
    // drew does not have it yet. (Before the draw the same press is a bare
    // success — the `toEqual({ ok: true })` in the test above is that control.)
    expect(await roundTwoField(), "round 2 is drawn").toEqual(["ann", "cat"]);
    const res = await settleCutTie(r1, [id.bea, id.cat], [id.bea]);
    expect(res).toEqual({ ok: true, notice: "Recorded. Round 2 was drawn before this, so it does not have this result yet. Redraw Round 2 so the draw uses it." });
    expect(await roundTwoField(), "nothing moved on its own").toEqual(["ann", "cat"]);
    const redrawn = await generateNextRound(r2);
    expect(redrawn.ok, "error" in redrawn ? redrawn.error : "").toBe(true);
    expect(await roundTwoField(), "the redraw uses it").toEqual(["ann", "bea"]);
  });

  it("a countback: the table's own tie-break — Bea won their meeting", async () => {
    await setStageCutTies(r2, "countback");
    const drawn = await generateNextRound(r2);
    expect(drawn.ok, "error" in drawn ? drawn.error : "").toBe(true);
    expect(await roundTwoField()).toEqual(["ann", "bea"]);
  });

  it("the default, ties go through: all three on 4 points or more are drawn", async () => {
    await setStageCutTies(r2, "ties");
    const drawn = await generateNextRound(r2);
    expect(drawn.ok, "error" in drawn ? drawn.error : "").toBe(true);
    expect(await roundTwoField()).toEqual(["ann", "bea", "cat"]);
  });

  it("once round 2 has a result, the recorded play-off can no longer be changed", async () => {
    await setStageCutTies(r2, "playoff");
    const m = await prisma.match.findFirstOrThrow({ where: { stageId: r2 } });
    await prisma.match.update({ where: { id: m.id }, data: { holes: H("A") } });
    const res = await settleCutTie(r1, [id.bea, id.cat], [id.bea]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/has results already/);
  });
});
