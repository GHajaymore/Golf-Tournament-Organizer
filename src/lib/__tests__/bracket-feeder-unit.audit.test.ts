import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { bracketVisibility } from "@/lib/bracket-visibility";

/**
 * THE FEEDER IS MEASURED IN ITS OWN UNIT, NOT THE EVENT'S.
 *
 * `bracket-visibility.ts` says so in as many words: its caller "passes counts
 * in the feeder's own unit, so a stroke qualifier can pass cards returned and
 * a round robin can pass matches". Its one caller — the dashboard — chose that
 * unit from `event.format`, which is ONE VALUE FOR A WHOLE TOURNAMENT. The
 * comment above the line even said to "measure whichever this tournament
 * actually uses rather than assuming one shape".
 *
 * Measured on 2026-09-12 with the feeder FULLY PLAYED, which is what turned an
 * argument about shapes into two defects:
 *
 *   round robin inside a stroke-format event   cards 0/4   -> 0    -> HIDDEN
 *   medal qualifier inside a match event       matches 0/0 -> null -> SET
 *
 * The first is the one an organizer feels: every match in the group phase
 * decided and no knockout draw on the dashboard at all, for good. The second
 * is the one that misleads — `null` means "nothing feeds this", so the draw
 * read "Set" whether or not a single card had come in.
 *
 * Same family as the board reading `event.format` for a round's scoring, and
 * found by following that thread. Fixed at the source: `bracketFeederProgress`
 * is computed in `loadEventState` beside the stages, so the screen has nothing
 * left to get wrong.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FEEDERUNIT";

let medalInStroke = "";
let robinInStroke = "";
let medalInMatch = "";
let medalInMatchUnplayed = "";
let legacyMedal = "";
let straightKnockout = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * A tournament whose bracket is fed by one round of `feeder` — or by nothing
 * at all, when `feeder` is null.
 *
 * `play` seeds that round's results IN ITS OWN UNIT: cards for a round scored
 * off cards, decided matches for one that is not. That is the whole fixture.
 * Results in the other unit are what the old code went looking for and never
 * found.
 */
async function build(
  name: string,
  eventFormat: string,
  feeder: { type: string; format: string } | null,
  play: boolean,
) {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
      format: eventFormat,
      status: "live",
    },
    select: { id: true },
  });
  const group = await prisma.group.create({
    data: { eventId: ev.id, name: `${TAG} g`, position: 0 },
    select: { id: true },
  });

  let feederId = "";
  if (feeder) {
    const s = await prisma.stage.create({
      data: {
        eventId: ev.id,
        position: 0,
        type: feeder.type,
        format: feeder.format,
        scoringBasis: "gross",
        holes: 18,
      },
      select: { id: true },
    });
    feederId = s.id;
  }
  await prisma.stage.create({
    data: { eventId: ev.id, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });

  const players = [];
  for (let i = 0; i < 4; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: ev.id,
          groupId: group.id,
          name: `${TAG} P${i + 1}`,
          email: `${TAG}-${name}-${i}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true },
      }),
    );
  }

  if (feeder && play) {
    // Stroke Play is the only card-scored format used here, so the fixture
    // decides its own unit from a literal rather than by calling the function
    // under test — otherwise it would inherit the bug it exists to catch.
    if (feeder.format === "Stroke Play") {
      for (const p of players) {
        await prisma.scorecard.create({
          data: {
            eventId: ev.id,
            stageId: feederId,
            playerId: p.id,
            strokes: JSON.stringify(new Array(18).fill(4)),
          },
        });
      }
    } else {
      for (const pair of [[0, 1], [2, 3]]) {
        await prisma.match.create({
          data: {
            eventId: ev.id,
            stageId: feederId,
            groupId: group.id,
            round: 1,
            playerAId: players[pair[0]].id,
            playerBId: players[pair[1]].id,
            holes: JSON.stringify(["A", "A", "A", "A", "A", ...new Array(13).fill(null)]),
          },
        });
      }
    }
  }
  return ev.id;
}

beforeAll(async () => {
  await scrub();
  medalInStroke = await build("a-medal-in-stroke", "stroke", { type: "Stroke Play Round", format: "Stroke Play" }, true);
  robinInStroke = await build("b-robin-in-stroke", "stroke", { type: "Round Robin", format: "Match Play" }, true);
  medalInMatch = await build("c-medal-in-match", "match", { type: "Stroke Play Round", format: "Stroke Play" }, true);
  medalInMatchUnplayed = await build("d-unplayed", "match", { type: "Stroke Play Round", format: "Stroke Play" }, false);
  legacyMedal = await build("e-legacy-medal", "stroke", { type: "Round Robin", format: "Stroke Play" }, true);
  straightKnockout = await build("f-straight-knockout", "match", null, false);
}, 120_000);

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const progressOf = async (id: string) => {
  const state = await loadEventState(id);
  expect(state, "no state at all").toBeTruthy();
  return state!.bracketFeederProgress;
};

/** What the dashboard tile actually does with the number. */
const tile = (feederProgress: number | null) =>
  bracketVisibility({
    hasBracketStage: true,
    feederProgress,
    bracketStarted: false,
    qualificationDecided: false,
  });

describe("a feeder that is finished reads finished", () => {
  it("counts a round robin by MATCHES, inside a stroke-format event", async () => {
    /**
     * THE ONE AN ORGANIZER FEELS. Both matches decided, the group phase over,
     * and no cards anywhere — because a match keeps its result on the match.
     * The old code counted cards, got nought out of four, and hid the draw.
     */
    const p = await progressOf(robinInStroke);
    expect(p, "a finished round robin read as no progress").toBe(1);
    expect(tile(p), "the knockout draw was hidden on a finished group phase").toBe("set");
  });

  it("counts a medal round by CARDS, inside a match-format event", async () => {
    const p = await progressOf(medalInMatch);
    expect(p).toBe(1);
    expect(tile(p)).toBe("set");
  });

  it("counts a round robin set to stroke play by its CARDS", async () => {
    /**
     * The legacy medal again, in a third place. Head-to-head by type and
     * scored off cards in fact, so the unit has to come from the format — the
     * identical correction the boards and the week sheet needed.
     */
    const p = await progressOf(legacyMedal);
    expect(p, "a legacy medal's cards were not counted").toBe(1);
  });

  it("leaves the ordinary championship exactly as it was", async () => {
    // A stroke qualifier in a stroke event: the case that always worked, and
    // the control that keeps this from being a behaviour change for everyone.
    expect(await progressOf(medalInStroke)).toBe(1);
  });
});

describe("a feeder that has not been played reads unplayed", () => {
  it("does not call an untouched qualifier a settled draw", async () => {
    /**
     * THE MISLEADING HALF, and the more dangerous one. Reading the unit off
     * `event.format` sent this to the match count, which found 0 of 0 — and
     * `feederFraction(0, 0)` is `null`, which the rule reads as "nothing feeds
     * this bracket, so show it". A draw seeded from an unplayed qualifier,
     * badged "Set".
     *
     * What is being asserted is the distinction between "no feeder" and "a
     * feeder with nothing in it", which the old code could not make.
     */
    const p = await progressOf(medalInMatchUnplayed);
    expect(p, "an unplayed qualifier reported as 'nothing feeds this'").toBe(0);
    expect(tile(p), "a draw off an unplayed qualifier was badged Set").toBe("hidden");
  });

  it("still shows a straight knockout from the first day", async () => {
    /**
     * And the case `null` is FOR. Nothing feeds this bracket — the draw is the
     * tournament, seeded from entry, and hiding it would withhold the
     * tournament itself. `bracket-visibility.ts` is explicit that a null feeder
     * "is a reason to show the bracket immediately rather than a reason to hide
     * it", so the fix must not have made null unreachable.
     */
    const p = await progressOf(straightKnockout);
    expect(p, "a straight knockout reported a feeder it has not got").toBeNull();
    expect(tile(p)).toBe("set");
  });
});
