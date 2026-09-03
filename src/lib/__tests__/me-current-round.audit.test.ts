import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { meFor } from "../services/me";

/**
 * On the morning of Round 1, a player is shown Round 1.
 *
 * `activeStage` is one number that the dashboard, score entry, the tee sheet,
 * the leaderboard, the printed standings and the player's own screen all read.
 * It had three rules in a chain: matches for a round robin, the calendar for a
 * dated league, and — for everything left — "the last playing round".
 *
 * A two-round club championship is everything left. It carries no dates (the
 * field is optional) and it has no matches (a medal round generates none), so
 * both rules declined and the fallback answered Round 2 before a ball had been
 * struck. The comment above it called that "all there is to go on without
 * dates", and the cards were sitting in the same query.
 *
 * What a player actually saw on Saturday morning: Round 2's tee sheet.
 * Unpublished at that point in most clubs, so the group card was simply empty
 * and they were told nothing; and in a club that had drawn both rounds up
 * front, the wrong tee time and the wrong playing partners, stated as
 * confidently as the right ones. Their own card was Round 2's too, so a round
 * played on Saturday could be entered against Sunday.
 *
 * Real rows, because the fault is in what `loadEventState` decides from a
 * whole event — stages, scorecards and a published sheet together — and not in
 * any function that can be handed an argument.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CURRENT-ROUND";

const PARS = new Array(18).fill(4);
const BLANK = JSON.stringify(new Array(18).fill(null));

let eventId = "";
const stage: Record<string, string> = {};
const player: Record<string, string> = {};

const emailFor = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

/** A published sheet naming who is out with whom, and when. */
const sheet = (groups: Array<{ name: string; time: string; playerIds: string[] }>) =>
  JSON.stringify({ savedAt: "", startType: "tee", groups: groups.map((g) => ({ ...g, startHole: 1 })) });

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} championship`,
      // NO DATES. That is the case, not an oversight in the fixture: the field
      // is optional and most clubs leave it empty.
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      format: "stroke",
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  for (const [i, who] of ["ann", "bea", "cal", "dee"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: emailFor(who),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
    });
    player[who] = p.id;
  }

  // Two rounds, both drawn and both published up front — which is exactly the
  // club that gets the WRONG answer rather than an empty one. Deliberately
  // different partners in each, so reading the wrong round is visible.
  const r1 = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      playedOn: "",
      teeSheetPublished: true,
      teeSheet: sheet([
        { name: "Group 1", time: "8:00 AM", playerIds: [player.ann, player.bea] },
        { name: "Group 2", time: "8:10 AM", playerIds: [player.cal, player.dee] },
      ]),
    },
  });
  stage.r1 = r1.id;

  const r2 = await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      playedOn: "",
      teeSheetPublished: true,
      teeSheet: sheet([
        { name: "Group 1", time: "1:00 PM", playerIds: [player.ann, player.cal] },
        { name: "Group 2", time: "1:10 PM", playerIds: [player.bea, player.dee] },
      ]),
    },
  });
  stage.r2 = r2.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the fixture really is the case that broke", () => {
  it("has two undated rounds and no matches to reason about", async () => {
    // Every assertion below is vacuous if any of these stops holding: a date
    // would hand the question to the calendar rule, and a match to the round
    // robin one.
    const stages = await prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } });
    expect(stages).toHaveLength(2);
    expect(stages.every((s) => !s.playedOn)).toBe(true);
    expect(await prisma.match.count({ where: { eventId } })).toBe(0);
  });

  it("has two sheets that name genuinely different partners", async () => {
    // Otherwise "shows Round 1's partners" would pass while reading Round 2's.
    const state = await loadEventState(eventId);
    const partnersIn = (stageId: string) => {
      const s = state!.stages.find((x) => x.id === stageId)!;
      const groups = (JSON.parse(s.teeSheet) as { groups: Array<{ playerIds: string[] }> }).groups;
      return groups.find((g) => g.playerIds.includes(player.ann))!.playerIds;
    };
    expect(partnersIn(stage.r1)).not.toEqual(partnersIn(stage.r2));
  });
});

describe("before anyone has teed off", () => {
  it("puts the player on Round 1, not the last round drawn", async () => {
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("ann"));
    expect(mine.round).not.toBeNull();
    expect(mine.round!.stageId).toBe(stage.r1);
  });

  it("gives them Round 1's tee time and Round 1's partners", async () => {
    // The lived symptom. Read off the wrong round this said 1:00 PM and named
    // Cal, and there is nothing on the screen to suggest either is wrong.
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("ann"));
    expect(mine.round!.group).not.toBeNull();
    expect(mine.round!.group!.time).toBe("8:00 AM");
    expect(mine.round!.group!.partners).toEqual([`${TAG} bea`]);
  });

  it("names the round, rather than naming the format", async () => {
    // "Stroke Play" is true of both rounds and so tells a player nothing about
    // which one they are looking at — which mattered most while the answer
    // itself was wrong.
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("ann"));
    expect(mine.round!.label).toBe("Round 1");
  });
});

describe("once play has started", () => {
  it("stays on Round 1 while Round 1 is being scored", async () => {
    // The morning after is when cards are returned and scores entered. Moving
    // the field on to Round 2 would put an unfinished card out of reach.
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: stage.r1,
        playerId: player.ann,
        strokes: JSON.stringify([4, 5, ...new Array(16).fill(null)]),
      },
    });
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("ann"));
    expect(mine.round!.stageId).toBe(stage.r1);
    expect(mine.round!.group!.time).toBe("8:00 AM");
  });

  it("is not moved on by a card row nobody has written on", async () => {
    // A blank row is not a round that has started. If it counted, Round 2
    // would take over the moment score entry was opened on it — which is the
    // original bug wearing a different hat.
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.r2, playerId: player.bea, strokes: BLANK },
    });
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("ann"));
    expect(mine.round!.stageId).toBe(stage.r1);
  });

  it("moves to Round 2 once a Round 2 card is actually written on", async () => {
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: stage.r2,
        playerId: player.ann,
        strokes: JSON.stringify([4, ...new Array(17).fill(null)]),
      },
    });
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("ann"));
    expect(mine.round!.stageId).toBe(stage.r2);
    expect(mine.round!.label).toBe("Round 2");
    // And with it the right sheet: 1:00 PM, out with Cal.
    expect(mine.round!.group!.time).toBe("1:00 PM");
    expect(mine.round!.group!.partners).toEqual([`${TAG} cal`]);
  });
});
