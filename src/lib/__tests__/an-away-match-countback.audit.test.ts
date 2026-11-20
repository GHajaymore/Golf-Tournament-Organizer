import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { weekViewFor } from "@/lib/services/week-view";
import { meetingsFor } from "@/lib/services/head-to-head";

/**
 * AN AWAY WEEK'S HALVED MATCH, DECIDED ON THE AWAY CARD BY ALL THREE READERS
 * (J26, 2026-11-06) — the standings, the week view and the head-to-head record,
 * read off real rows.
 *
 * The tournament's own card has the 1st as its hardest hole (index 1) and the
 * 18th as its easiest. Week 1 is played AWAY, at a club whose card is the same
 * layout indexed the other way round. Two matches that week, each all square
 * after eighteen, side A winning the 1st–3rd and side B the 16th–18th; the
 * committee decides a halve on the toughest six holes (Committee Procedures
 * 5A(6)):
 *
 *   Ann v Bea   played at the week's venue, the away card: its hardest six are
 *               the 13th–18th, where Bea won three and Ann none — BEA wins.
 *   Cal v Dee   moved by the pairing to a third club laid out like home (the
 *               match's own venue): its hardest six are the 1st–6th — CAL wins.
 *
 * Before J26 every reader took the tournament's card for both, and gave Ann the
 * first match. Cal v Dee is the control: right either way, so a reader that
 * stopped deciding halves at all would fail it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-J26-AWAY-COUNTBACK";
const at = (who: string) => `zz-j26-${who}@example.invalid`;

let orgId = "";
let eventId = "";
let weekId = "";
const player: Record<string, string> = {};
const member: Record<string, string> = {};

const HOME_SI = Array.from({ length: 18 }, (_, i) => i + 1);
const AWAY_SI = Array.from({ length: 18 }, (_, i) => 18 - i);
const HALVED = JSON.stringify(["A", "A", "A", ...new Array(12).fill("H"), "B", "B", "B"]);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} interclub`,
      shape: "series",
      format: "match",
      status: "live",
      dates: "",
      course: `${TAG} home`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(HOME_SI),
      matchTiebreakers: JSON.stringify(["toughest-6"]),
    },
  });
  eventId = event.id;

  const course = (name: string, si: number[]) =>
    prisma.course.create({
      data: {
        organizationId: orgId,
        name: `${TAG} ${name}`,
        city: "",
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(si),
      },
    });
  const away = await course("away links", AWAY_SI);
  const third = await course("third club", HOME_SI);
  // Every writer of a venue links it to the tournament; so does this fixture.
  await prisma.eventCourse.create({ data: { eventId, courseId: away.id } });
  await prisma.eventCourse.create({ data: { eventId, courseId: third.id } });

  const week = await prisma.stage.create({
    data: { eventId, position: 0, description: "Week 1", type: "Round Robin", format: "Match Play", holes: 18, courseId: away.id, playedOn: "2026-06-02" },
  });
  weekId = week.id;
  const group = await prisma.group.create({ data: { eventId, name: `${TAG} pool`, position: 0 } });

  for (const [i, who] of ["ann", "bea", "cal", "dee"].entries()) {
    member[who] = (await prisma.member.create({ data: { organizationId: orgId, name: `${TAG} ${who}` } })).id;
    player[who] = (
      await prisma.player.create({
        data: { eventId, groupId: group.id, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed", handicap: 10, memberId: member[who] },
      })
    ).id;
  }
  const match = (a: string, b: string, extra: Record<string, unknown> = {}) =>
    prisma.match.create({ data: { eventId, stageId: weekId, groupId: group.id, round: 1, playerAId: player[a], playerBId: player[b], holes: HALVED, ...extra } });
  await match("ann", "bea");
  await match("cal", "dee", { courseId: third.id });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("an away week's halved match", () => {
  it("THE STANDINGS: Bea has the win the away card's toughest six gave her; Cal keeps the control's", async () => {
    const state = (await loadEventState(eventId))!;
    const stats = (who: string) => state.overall.find((r) => r.player.id === player[who])!.stats;
    expect({ w: stats("bea").wins, l: stats("bea").losses, t: stats("bea").ties, pts: stats("bea").totalPoints }).toEqual({ w: 1, l: 0, t: 0, pts: 2 });
    expect({ w: stats("ann").wins, l: stats("ann").losses, pts: stats("ann").totalPoints }).toEqual({ w: 0, l: 1, pts: 0 });
    // CONTROL: the match's own venue (home layout) — Cal.
    expect({ w: stats("cal").wins, l: stats("dee").losses }).toEqual({ w: 1, l: 1 });
    // The card itself, read off the state the screens read.
    const annBea = state.matches.find((m) => m.playerAId === player.ann)!;
    expect(state.countbackCardFor(annBea)).toEqual(AWAY_SI);
  });

  it("THE WEEK VIEW: the season table after the away week puts Bea on 2 and Ann on 0", async () => {
    const view = (await weekViewFor(eventId, weekId))!;
    const value = (who: string) => view.standings.find((r) => r.playerId === player[who])?.value;
    expect({ bea: value("bea"), ann: value("ann"), cal: value("cal"), dee: value("dee") }).toEqual({ bea: 2, ann: 0, cal: 2, dee: 0 });
  });

  it("HEAD-TO-HEAD: Bea's record against Ann is one won, none halved", async () => {
    const meetings = await meetingsFor(orgId, member.bea);
    const vsAnn = meetings.filter((m) => [m.a, m.b].includes(member.ann));
    expect(vsAnn).toHaveLength(1);
    expect(vsAnn[0].winner).toBe(member.bea);
    // CONTROL: Cal over Dee on the third club's (home-layout) card.
    const calDee = (await meetingsFor(orgId, member.cal)).find((m) => [m.a, m.b].includes(member.dee))!;
    expect(calDee.winner).toBe(member.cal);
  });
});
