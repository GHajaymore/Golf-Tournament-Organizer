import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { loadEventState } from "@/lib/services/tournament";

/**
 * WHAT "SCORECARDS IN" COUNTS, AND WHAT IT USED TO.
 *
 * `roundProgress` measured `hasAnyHole(c.strokes)` — literally "somebody typed
 * a digit" — and three readers then described that number as finished: the
 * dashboard's "scorecards in" and "matches complete", `snapshotStanding`'s
 * "This round is all in", and the bracket feeder.
 *
 * The schema had said otherwise all along. `Scorecard.status` models Rule 3.3b
 * and its own comments are explicit:
 *
 *     entered    written down. Not yet claimed to be right by anyone.
 *     certified  the marker and player say the scores are correct.
 *                "This is the card being returned."
 *     approved   the committee has accepted it. "Only now is it a result."
 *     disputed   someone has said it is wrong.
 *
 * None of it was read here, so a DISPUTED card counted toward "cards in"
 * exactly as an approved one did — while `card-approval.ts`, two files away,
 * was refusing to rubber-stamp those very rows.
 *
 * NOTHING IN THE SUITE NOTICED THE CHANGE. tsc and 7,377 tests passed with the
 * counter rewritten, which says the semantics were asserted nowhere at all.
 * That is what this file is for.
 *
 * FOUR CARDS, ONE PER STATE, so each assertion can only be satisfied by
 * reading the column rather than by counting rows: the field is four and every
 * one of them has holes written down, so a counter that still asks `hasAnyHole`
 * answers 4 to all three questions.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-board-progress";

const FULL = JSON.stringify(new Array(18).fill(4));

let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
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
      name: `${TAG} medal`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
    },
    select: { id: true },
  });
  stageId = stage.id;

  // One player per card state. Every card is FULL, so the old counter — which
  // asked only whether a hole had been written down — would have said 4/4.
  for (const [i, status] of ["entered", "certified", "approved", "disputed"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${status}`,
        email: `${TAG}-${status}@example.invalid`,
        handicap: 8 + i,
        seed: i + 1,
        status: "confirmed",
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId: p.id, strokes: FULL, status },
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

const progress = async () => {
  const state = await loadEventState(eventId);
  expect(state, "the event did not load").not.toBeNull();
  return state!.boardProgress;
};

describe("the round's progress, on a field of four whose cards are all full", () => {
  it("counts every card as STARTED, because every one has holes on it", async () => {
    const p = await progress();
    expect(p.started, "all four players have written scores down").toBe(4);
    expect(p.total).toBe(4);
  });

  it("counts only the RETURNED cards as certified", async () => {
    /**
     * THE DEFECT. Certified and approved are returned; entered and disputed
     * are not. The old counter said four.
     */
    const p = await progress();
    expect(
      p.certified,
      "entered and disputed cards are not returned cards",
    ).toBe(2);
  });

  it("counts only the committee's own acceptance as approved", async () => {
    const p = await progress();
    expect(p.approved, "one card has been accepted").toBe(1);
  });

  it("drives the bar off certified, not off who has started", async () => {
    // 2 of 4 returned. The bar read 100% when it measured "started".
    const p = await progress();
    expect(p.pct).toBe(50);
  });

  it("does not report the round all in while two cards are outstanding", async () => {
    /**
     * The reader this was costing. `snapshotStanding` says "This round is all
     * in, but the tournament has not been closed yet" on `done >= total`, and
     * `done` is the alias of `certified` — so the sentence is now true when it
     * appears.
     */
    const p = await progress();
    expect(p.certified, "the alias is gone; readers name the question").toBe(2);
    expect(p.certified >= p.total, "two cards are still out").toBe(false);
  });
});

/**
 * AND THE SAME COUNTER OVER A ROUND THAT FILES ITS CARDS SOMEWHERE ELSE.
 *
 * A side playing one ball writes a `TeamScorecard`; the `Scorecard` table this
 * counter read stays EMPTY for the whole round. Foursomes is a "Stroke Play
 * Round" and is not head to head, so it took the stroke branch and answered
 * `started: 0, certified: 0` over a finished round, with `total` counting the
 * PLAYERS in the field rather than the sides in the draw.
 *
 * Measured on the seeded club on 2026-09-20 before the fix: three completed
 * team rounds holding 16, 8 and 8 team cards, and 0 individual scorecards
 * between them. `/reports` printed "Nothing returned for this round yet" over
 * eight complete sides.
 *
 * THE FIXTURE MAKES EVERY WRONG ANSWER LOOK DIFFERENT, which is the whole
 * point of it: three sides, six players, and one side apiece finished,
 * part-way and not started. So "counts rows" (4), "counts players" (6),
 * "counts anything written down" (2 certified) and "counts nothing" (0) are
 * four distinguishable numbers rather than coincidences.
 */
const TEAM_TAG = "zz-board-progress-team";
let teamEventId = "";

async function cleanupTeams() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TEAM_TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TEAM_TAG } } });
}

describe("the round's progress, on a foursomes day of three sides", () => {
  beforeAll(async () => {
    await cleanupTeams();
    const org = await prisma.organization.create({
      data: { name: `${TEAM_TAG} club`, kind: "club" },
      select: { id: true },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TEAM_TAG} foursomes`,
        status: "live",
        shape: "series",
        format: "stroke",
        formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: randomBytes(12).toString("hex"),
        registrationToken: randomBytes(8).toString("hex"),
        customPars: JSON.stringify(new Array(18).fill(4)),
        customYards: JSON.stringify(new Array(18).fill(400)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    });
    teamEventId = event.id;

    const stage = await prisma.stage.create({
      data: {
        eventId: teamEventId,
        position: 0,
        type: "Stroke Play Round",
        format: "Foursomes",
        holes: 18,
        scoringBasis: "net",
        handicapAllowance: 50,
      },
      select: { id: true },
    });

    // finished / part-way / not started. The middle one is nine holes, so a
    // counter that says "any hole written down means the card is in" reports
    // two returned where one is right.
    const holesFor = [18, 9, 0];
    for (const [i, holes] of holesFor.entries()) {
      const side = await prisma.team.create({
        data: { eventId: teamEventId, stageId: stage.id, name: `${TEAM_TAG} side ${i + 1}`, seed: i + 1 },
        select: { id: true },
      });
      for (const half of [0, 1]) {
        const p = await prisma.player.create({
          data: {
            eventId: teamEventId,
            name: `${TEAM_TAG} p${i + 1}${half}`,
            email: `${TEAM_TAG}-${i + 1}${half}@example.invalid`,
            handicap: 10 + i,
            seed: i * 2 + half + 1,
            status: "confirmed",
          },
          select: { id: true },
        });
        await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.id, position: half } });
      }
      if (holes === 0) continue;
      // One card for the side, with a blank playerId — the shared ball.
      await prisma.teamScorecard.create({
        data: {
          eventId: teamEventId,
          stageId: stage.id,
          teamId: side.id,
          strokes: JSON.stringify(
            Array.from({ length: 18 }, (_, h) => (h < holes ? 4 : null)),
          ),
        },
      });
    }
  });

  afterAll(cleanupTeams);

  const teamProgress = async () => {
    const state = await loadEventState(teamEventId);
    expect(state, "the team event did not load").not.toBeNull();
    return state!.boardProgress;
  };

  it("counts SIDES, not players and not team cards", async () => {
    /**
     * THE DEFECT. `total` was `confirmed.length` — six, the field — for a
     * round that only three things can return.
     */
    const p = await teamProgress();
    expect(p.total, "three sides are out, whatever the field size").toBe(3);
  });

  it("sees the two sides that are out on the course", async () => {
    // Zero before this, because the round files no `Scorecard` rows at all.
    const p = await teamProgress();
    expect(p.started).toBe(2);
  });

  it("counts a side's card as returned only once every hole is on it", async () => {
    const p = await teamProgress();
    expect(p.certified, "nine holes is not a returned card").toBe(1);
  });

  it("names what it is counting, so a screen does not re-derive it", async () => {
    /**
     * "cards" was the answer before, and it is the wrong noun twice over: a
     * four-ball of eight sides holds sixteen team cards, so the word would be
     * true about rows and false about the round.
     */
    const p = await teamProgress();
    expect(p.unit).toBe("sides");
  });

  it("stops offering a round the field has played as the next one to draw", async () => {
    /**
     * The second reader, and the one nobody would have connected to this.
     * `nextUnplayedRound` is "the first round with nothing on it, in play
     * order" — what `/foursomes` draws a tee sheet FOR. It asks
     * `roundProgress(s).started === 0`, so every team round in the app
     * qualified for ever, however many sides were round.
     */
    const state = await loadEventState(teamEventId);
    expect(state!.nextUnplayedRound, "two sides are out on this one").toBeNull();
  });

  it("counts a side's card as golf that has been played", async () => {
    /**
     * The third reader, and the one that decides where the whole tournament
     * IS. `resultsIn` feeds the lifecycle bar and the journey card — it is the
     * evidence route into "Play" for a club that never pressed Launch — and it
     * was handed the individual cards alone. A team day therefore sat in Draft
     * on every screen with its field out on the course.
     */
    const state = await loadEventState(teamEventId);
    expect(state!.resultsIn, "two sides have cards on this round").toBe(2);
  });

  it("does not claim a round is all in while a side is still out", async () => {
    // `snapshotStanding` prints "Nothing returned for this round yet" on
    // done <= 0 — which is the sentence that was over eight finished sides.
    const p = await teamProgress();
    expect(p.certified > 0, "something HAS been returned").toBe(true);
    expect(p.certified >= p.total, "two sides have not finished").toBe(false);
    expect(p.pct).toBe(33);
  });
});

/**
 * AND THE ROUND WHOSE RESULTS ARE IN NEITHER TABLE.
 *
 * A bracket stage files no `Scorecard` rows and no `Match` rows: a knockout's
 * results are `BracketWinner` rows keyed by slot. So the counter answered 0 of
 * 0 for one however far through the draw a club was, and three screens printed
 * it — "Matches complete 0/0 · 0% of round robin" on the dashboard, the same
 * on `/reports`, and "Nothing returned for this round yet" on the sheet that
 * gets printed and pinned up. Read off the seeded club's Summer Knockout on
 * 2026-09-20, which had five ties decided and its final drawn.
 *
 * FOUR PLAYERS, so the draw is two ties and then a final — and one recorded
 * winner, so "decided", "playable" and "in the draw" are three different
 * numbers and no wrong answer can satisfy them all.
 */
const KNOCKOUT_TAG = "zz-board-progress-knockout";
let knockoutEventId = "";
const KNOCKOUT_NAMES = ["Ann", "Bea", "Cal", "Dev"];

async function cleanupKnockout() {
  await prisma.event.deleteMany({ where: { name: { startsWith: KNOCKOUT_TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: KNOCKOUT_TAG } } });
}

describe("the round's progress, on a knockout", () => {
  beforeAll(async () => {
    await cleanupKnockout();
    const org = await prisma.organization.create({
      data: { name: `${KNOCKOUT_TAG} club`, kind: "club" },
      select: { id: true },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${KNOCKOUT_TAG} matchplay`,
        status: "live",
        shape: "series",
        format: "match",
        formationRule: "balanced",
        // Everybody qualifies, so the bracket is the whole field and this
        // fixture does not depend on a feeder round's standings.
        qualifyPerGroup: 4,
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: randomBytes(12).toString("hex"),
        registrationToken: randomBytes(8).toString("hex"),
      },
      select: { id: true },
    });
    knockoutEventId = event.id;

    await prisma.stage.create({
      data: {
        eventId: knockoutEventId,
        position: 0,
        description: "Knockout",
        type: "Bracket Stage",
        format: "Match Play",
        holes: 18,
        scoringBasis: "gross",
      },
      select: { id: true },
    });

    const group = await prisma.group.create({
      data: { eventId: knockoutEventId, name: `${KNOCKOUT_TAG} A`, position: 0 },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const [i, name] of KNOCKOUT_NAMES.entries()) {
      const p = await prisma.player.create({
        data: {
          eventId: knockoutEventId,
          groupId: group.id,
          name: `${KNOCKOUT_TAG} ${name}`,
          email: `${KNOCKOUT_TAG}-${name}@example.invalid`.toLowerCase(),
          handicap: i,
          seed: i + 1,
          status: "confirmed",
        },
        select: { id: true },
      });
      ids.push(p.id);
    }

    // One tie decided, by slot key — the only place a knockout's result is
    // ever written.
    await prisma.bracketWinner.create({
      data: { eventId: knockoutEventId, key: "winners-0-0", winnerId: ids[0], result: "3&2" },
    });
  });

  afterAll(cleanupKnockout);

  const knockoutProgressOf = async () => {
    const state = await loadEventState(knockoutEventId);
    expect(state, "the knockout did not load").not.toBeNull();
    return state!.boardProgress;
  };

  it("counts the ties that can be played, not the fixtures it has none of", async () => {
    const p = await knockoutProgressOf();
    // Two first-round ties; the final has nobody in it yet.
    expect(p.total, "the draw's playable ties").toBe(2);
  });

  it("counts the tie somebody has won", async () => {
    // Zero before this, for every knockout in the app.
    const p = await knockoutProgressOf();
    expect(p.certified).toBe(1);
    expect(p.pct).toBe(50);
  });

  it("names what it is counting, so no screen re-derives it", async () => {
    /**
     * The whole point of moving this out of the dashboard: `/reports` and
     * `snapshotStanding` read the unit, so they print "Ties decided" and
     * "1 of 2 ties in" without either of them knowing what a bracket is.
     */
    const p = await knockoutProgressOf();
    expect(p.unit).toBe("ties");
  });

  it("does not report a tie as disputed or half played", async () => {
    // A tie has no holes here and no committee step: it is decided or it is
    // not, and inventing the other two counts would put numbers on a screen
    // no action in the app can ever change.
    const p = await knockoutProgressOf();
    expect(p.started).toBe(1);
    expect(p.approved).toBe(1);
    expect(p.disputed).toBe(0);
  });
});

/**
 * AND THE ROUND WHOSE TYPE SAYS ONE THING AND WHOSE RESULTS SAY ANOTHER.
 *
 * A Nassau is eighteen holes of stroke-play scoring — its stage type is
 * "Stroke Play Round" — and it is three bets between two players, so what it
 * writes is `Match` rows. `roundIsStroke` reads the TYPE, so the counter asked
 * for scorecards and found none, for ever, over a night every pair had
 * finished.
 *
 * Measured on the seeded club's Festival of Formats on 2026-09-20: its Nassau
 * round holds 0 `Scorecard` rows against 8 `Match` rows.
 *
 * TWO MATCHES, ONE OVER AND ONE MID-ROUND, so "counts fixtures" (2), "counts
 * finished fixtures" (1) and "counts cards" (0) are three different numbers.
 */
const NASSAU_TAG = "zz-board-progress-nassau";
let nassauEventId = "";

async function cleanupNassau() {
  await prisma.event.deleteMany({ where: { name: { startsWith: NASSAU_TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: NASSAU_TAG } } });
}

describe("the round's progress, on a Nassau night", () => {
  beforeAll(async () => {
    await cleanupNassau();
    const org = await prisma.organization.create({
      data: { name: `${NASSAU_TAG} club`, kind: "club" },
      select: { id: true },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${NASSAU_TAG} nassau`,
        status: "live",
        shape: "series",
        format: "stroke",
        formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: randomBytes(12).toString("hex"),
        registrationToken: randomBytes(8).toString("hex"),
        customPars: JSON.stringify(new Array(18).fill(4)),
        customYards: JSON.stringify(new Array(18).fill(400)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    });
    nassauEventId = event.id;

    const stage = await prisma.stage.create({
      data: {
        eventId: nassauEventId,
        position: 0,
        description: "Nassau night",
        // The type a Nassau really has, which is the whole trap.
        type: "Stroke Play Round",
        format: "Nassau",
        holes: 18,
        scoringBasis: "net",
      },
      select: { id: true },
    });

    const group = await prisma.group.create({
      data: { eventId: nassauEventId, name: `${NASSAU_TAG} A`, position: 0 },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const [i, name] of ["Ann", "Bea", "Cal", "Dev"].entries()) {
      const p = await prisma.player.create({
        data: {
          eventId: nassauEventId,
          groupId: group.id,
          name: `${NASSAU_TAG} ${name}`,
          email: `${NASSAU_TAG}-${name}@example.invalid`.toLowerCase(),
          handicap: 10 + i,
          seed: i + 1,
          status: "confirmed",
        },
        select: { id: true },
      });
      ids.push(p.id);
    }

    // One pair round in full, one on the 9th: a counter that reads "any hole
    // written down" says two, and a counter that reads cards says nothing.
    await prisma.match.create({
      data: {
        eventId: nassauEventId,
        stageId: stage.id,
        groupId: group.id,
        round: 1,
        playerAId: ids[0],
        playerBId: ids[1],
        holes: JSON.stringify(new Array(18).fill("A")),
      },
    });
    await prisma.match.create({
      data: {
        eventId: nassauEventId,
        stageId: stage.id,
        groupId: group.id,
        round: 1,
        playerAId: ids[2],
        playerBId: ids[3],
        holes: JSON.stringify([...new Array(9).fill("B"), ...new Array(9).fill(null)]),
      },
    });
  });

  afterAll(cleanupNassau);

  const nassauProgress = async () => {
    const state = await loadEventState(nassauEventId);
    expect(state, "the Nassau event did not load").not.toBeNull();
    return state!.boardProgress;
  };

  it("counts the pairs, not the cards it has none of", async () => {
    const p = await nassauProgress();
    expect(p.total, "two pairs are out").toBe(2);
    expect(p.started, "both have holes on them").toBe(2);
  });

  it("counts only the pair whose round is over as returned", async () => {
    // Zero before this, over a night that was half finished.
    const p = await nassauProgress();
    expect(p.certified).toBe(1);
    expect(p.pct).toBe(50);
  });

  it("names what it is counting, so the screens do not say cards", async () => {
    /**
     * `snapshotStanding` prints the unit into its note — "1 of 2 matches in" —
     * and the dashboard's tile label comes from the same word. A Nassau night
     * that said "cards" would be describing a table it never writes to.
     */
    const p = await nassauProgress();
    expect(p.unit).toBe("matches");
  });
});

/**
 * AND THE ROUND NOTHING COUNTS, BY DESIGN.
 *
 * "Other (scored by hand)" carries `manual: true`, and its entry in
 * `formats.ts` says why in its own words: "no engine computes this. That is
 * the point." A club runs the competition and records the result themselves.
 *
 * The counter did not know that, so it measured the round the ordinary way —
 * cards against the field — and produced "Cards in 0/16 · 0% submitted" over a
 * round where no card is owed and the number would read zero for ever.
 * `/reports` printed "Nothing returned for this round yet" two inches above
 * its own notice explaining that the app does not work this result out.
 *
 * CARDS IN THE FIXTURE, deliberately: a full field with full cards on the
 * round. If the counter ever goes back to counting them it says 4 of 4 and
 * this fails loudly, which is a sharper control than an empty round — an
 * absence would be satisfied by any broken counter that happens to answer
 * zero.
 */
const MANUAL_TAG = "zz-board-progress-manual";
let manualEventId = "";

async function cleanupManual() {
  await prisma.event.deleteMany({ where: { name: { startsWith: MANUAL_TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: MANUAL_TAG } } });
}

describe("the round's progress, on a round scored by hand", () => {
  beforeAll(async () => {
    await cleanupManual();
    const org = await prisma.organization.create({
      data: { name: `${MANUAL_TAG} club`, kind: "club" },
      select: { id: true },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${MANUAL_TAG} hand scored`,
        status: "live",
        shape: "series",
        format: "stroke",
        formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: randomBytes(12).toString("hex"),
        registrationToken: randomBytes(8).toString("hex"),
        customPars: JSON.stringify(new Array(18).fill(4)),
        customYards: JSON.stringify(new Array(18).fill(400)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    });
    manualEventId = event.id;

    const stage = await prisma.stage.create({
      data: {
        eventId: manualEventId,
        position: 0,
        description: "Club fun day",
        type: "Stroke Play Round",
        format: "Other (scored by hand)",
        holes: 18,
        scoringBasis: "gross",
      },
      select: { id: true },
    });

    for (const [i, name] of ["Ann", "Bea", "Cal", "Dev"].entries()) {
      const p = await prisma.player.create({
        data: {
          eventId: manualEventId,
          name: `${MANUAL_TAG} ${name}`,
          email: `${MANUAL_TAG}-${name}@example.invalid`.toLowerCase(),
          handicap: 10 + i,
          seed: i + 1,
          status: "confirmed",
        },
        select: { id: true },
      });
      // A full card each, certified. Nothing should count them.
      await prisma.scorecard.create({
        data: {
          eventId: manualEventId,
          stageId: stage.id,
          playerId: p.id,
          strokes: JSON.stringify(new Array(18).fill(4)),
          status: "certified",
        },
      });
    }
  });

  afterAll(cleanupManual);

  const manualProgress = async () => {
    const state = await loadEventState(manualEventId);
    expect(state, "the hand-scored event did not load").not.toBeNull();
    return state!.boardProgress;
  };

  it("counts nothing, because nothing is owed", async () => {
    const p = await manualProgress();
    expect(p.total, "a field that owes no card is not a denominator").toBe(0);
    expect(p.certified).toBe(0);
    expect(p.started).toBe(0);
    expect(p.pct).toBe(0);
  });

  it("says so in the unit, so no screen counts on its behalf", async () => {
    /**
     * The dashboard tile, the `/reports` tile and `snapshotStanding` all read
     * this word. Without it each of them would have to learn what a manual
     * format is, which is how one absence came to have four readers.
     */
    const p = await manualProgress();
    expect(p.unit).toBe("manual");
  });
});
