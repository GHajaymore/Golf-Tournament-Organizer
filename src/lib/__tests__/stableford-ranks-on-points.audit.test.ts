import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { weekViewFor } from "@/lib/services/week-view";
import { WEEK_BASIS_LABEL } from "@/lib/domain/week-basis";

/**
 * A STABLEFORD NIGHT IS WON ON POINTS.
 *
 * The format gives the UNIT and the basis gives the ALLOCATION — a Stableford
 * competition is decided on points, and gross/net only says whether handicap
 * strokes are applied while computing them. `weekBasis` read the basis alone,
 * so the seeded club's Thursday league — eight weeks, every one
 * `format: "Stableford"` with `scoringBasis: "net"` — was ranked on net
 * strokes under a heading reading "Stableford · 18 holes · net strokes".
 *
 * THE FIXTURE HAS TO CONTAIN A WIPE, and that is the whole difficulty.
 * Stableford points and net strokes move together everywhere except on a hole
 * whose points FLOOR at zero, so on ordinary cards the two orders are
 * identical. Measured on the seeded league before this change: all four played
 * weeks ranked the same either way — the 99 and the 84 on week 3 both net 75
 * and both score 32. A test built on cards like those cannot fail.
 *
 * So the two cards here are chosen so the orders REVERSE:
 *
 *   wiper   one 12 on a par 4, pars elsewhere   gross 80  net 80  points 34
 *   grinder seven bogeys, pars elsewhere        gross 79  net 79  points 29
 *
 * The grinder is a stroke better and four points worse. On net he wins the
 * night; on points he loses it. Scratch handicaps, so net equals gross and
 * nothing here turns on an allowance.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-stableford-points";

const PAR = 4;
const PARS = new Array(18).fill(PAR);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** One wipe, pars elsewhere: fewest strokes lost, most points kept. */
const WIPER = PARS.map((p, i) => (i === 0 ? 12 : p));
/** Seven bogeys: a stroke better, and a point worse on each of them. */
const GRINDER = PARS.map((p, i) => (i < 7 ? p + 1 : p));

let eventId = "";
let stableford = "";
let strokePlay = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function round(position: number, description: string, format: string) {
  const s = await prisma.stage.create({
    data: {
      eventId,
      position,
      description,
      type: "Stroke Play Round",
      format,
      // NET on both, which is the combination the whole defect lived in.
      scoringBasis: "net",
      holes: 18,
    },
    select: { id: true },
  });
  return s.id;
}

async function card(stageId: string, playerId: string, strokes: number[]) {
  await prisma.scorecard.create({
    data: { eventId, stageId, playerId, strokes: JSON.stringify(strokes) },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} Course`,
      city: `${TAG} Town`,
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(10).toString("hex"),
      registrationToken: randomBytes(6).toString("hex"),
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  eventId = event.id;

  const people = [];
  for (const who of ["wiper", "grinder"]) {
    people.push(
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${who}`,
          email: `${TAG}-${who}@example.invalid`,
          // Scratch: net equals gross, so the comparison is about the FLOOR
          // and not about an allowance.
          handicap: 0,
          seed: people.length + 1,
          status: "confirmed",
        },
        select: { id: true, name: true },
      }),
    );
  }

  stableford = await round(0, "Stableford night", "Stableford");
  await card(stableford, people[0].id, WIPER);
  await card(stableford, people[1].id, GRINDER);

  // The CONTROL round: identical cards, ordinary stroke play. It must still
  // rank on net, or "Stableford ranks on points" has quietly become
  // "everything ranks on points".
  strokePlay = await round(1, "Medal night", "Stroke Play");
  await card(strokePlay, people[0].id, WIPER);
  await card(strokePlay, people[1].id, GRINDER);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const who = (name: string) => name.replace(`${TAG} `, "");

describe("a Stableford night", () => {
  it("is won by the higher points, not the lower net", async () => {
    const week = await weekViewFor(eventId, stableford);
    const played = week!.results.filter((r) => r.thru > 0);
    expect(played, "both cards should be in").toHaveLength(2);

    const wiper = played.find((r) => who(r.name) === "wiper")!;
    const grinder = played.find((r) => who(r.name) === "grinder")!;

    // The fixture really does disagree — asserted rather than assumed, because
    // a fixture where the two agree cannot express a wrong answer and every
    // ordering test on it is decoration.
    expect(wiper.gross, "the wiper's card").toBe(80);
    expect(grinder.gross, "the grinder's card").toBe(79);
    expect(grinder.net, "the grinder is a stroke better on net").toBeLessThan(wiper.net);
    expect(wiper.points, "the wiper is ahead on points").toBeGreaterThan(grinder.points);

    // And the night is decided the Stableford way.
    expect(who(played[0].name), "the night was ranked on net strokes").toBe("wiper");
    expect(wiper.position).toBe(1);
    expect(grinder.position).toBe(2);
  });

  it("says so in the heading, instead of naming strokes", async () => {
    /**
     * `WeekClient` renders `format · holes · WEEK_BASIS_LABEL[view.basis]`, so
     * the sentence a league reads every week is this value. It said
     * "Stableford · 18 holes · net strokes" — the competition named, and then
     * the night decided on something else, on one line.
     */
    const week = await weekViewFor(eventId, stableford);
    expect(week!.basis).toBe("stableford");
    expect(WEEK_BASIS_LABEL[week!.basis]).toBe("Stableford points");
  });
});

describe("and an ordinary medal on identical cards", () => {
  it("still ranks on net, so this did not turn every round into Stableford", async () => {
    /**
     * THE CONTROL. "A Stableford round ranks on points" is satisfied perfectly
     * by ranking EVERYTHING on points, and the same two cards through a
     * stroke-play round is the cheapest way to show that has not happened.
     */
    const week = await weekViewFor(eventId, strokePlay);
    const played = week!.results.filter((r) => r.thru > 0);
    expect(who(played[0].name), "a medal should be won by the lower net").toBe("grinder");
  });
});
