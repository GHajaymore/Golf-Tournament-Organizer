import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { meetingsFor } from "@/lib/services/head-to-head";
import { recordAgainst, recordVerdict } from "@/lib/domain/head-to-head";

/**
 * HEAD-TO-HEAD (2026-09-28, Ajay: "go ahead with your recommendations as a
 * golf pro") — a member's record against each opponent across the club's
 * tournaments. What needs real rows: that meetings are found in BOTH places a
 * match result lives (a Match's holes, and a knockout's BracketWinner seats),
 * across two tournaments, joined by MEMBER, and that everything which is not a
 * meeting between two members is left out.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-H2H";
let orgId = "";
const mem: Record<string, string> = {};
const H = (s: string) => JSON.stringify(s.split("").map((c) => (c === "." ? null : c)));

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function event(name: string, extra: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`,
      format: "match",
      ...extra,
    },
  });
}

async function entrant(eventId: string, who: string, seed: number, memberId: string | null = mem[who]) {
  return (
    await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `zz-h2h-${who}@example.invalid`, seed, status: "confirmed", memberId },
    })
  ).id;
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club` } })).id;
  for (const who of ["ann", "bea", "cal"]) {
    mem[who] = (await prisma.member.create({ data: { organizationId: orgId, name: `${TAG} ${who}` } })).id;
  }

  // 1. A round robin: Ann beats Bea 3&2, Ann and Cal halve, Cal concedes to Bea,
  //    and Ann's match with a GUEST (no member record) is decided but not a member meeting.
  const rr = await event("summer matchplay");
  const rrStage = await prisma.stage.create({ data: { eventId: rr.id, position: 0, type: "Round Robin", format: "Match Play", playedOn: "2026-06-01" } });
  const group = await prisma.group.create({ data: { eventId: rr.id, position: 0, name: `${TAG} pool` } });
  const [ann, bea, cal, guest] = [
    await entrant(rr.id, "ann", 1),
    await entrant(rr.id, "bea", 2),
    await entrant(rr.id, "cal", 3),
    await entrant(rr.id, "guest", 4, null),
  ];
  const match = (a: string, b: string, holes: string, extra: Record<string, unknown> = {}) =>
    prisma.match.create({ data: { eventId: rr.id, stageId: rrStage.id, groupId: group.id, round: 1, playerAId: a, playerBId: b, holes, ...extra } });
  // Ann 3 up with 2 to play after 16: A A A H H H H H H H H H H H H H . .
  await match(ann, bea, H("AAAHHHHHHHHHHHHH.."));
  await match(ann, cal, H("HHHHHHHHHHHHHHHHHH"));
  await match(bea, cal, H(".................."), { forfeitedBy: cal });
  await match(ann, guest, H("AAAAAAAAAA........"));
  // …and one Ann v Bea still being played, which is no result at all.
  await match(bea, ann, H("BB................"));

  // 2. A knockout: Bea beats Ann in the Flight A final, recorded on the seats.
  //    A default knockout splits its field into two flights, so four entrants
  //    put seeds 1 and 2 in Flight A's final and two guests in Flight B's.
  const ko = await event("summer knockout");
  await prisma.stage.create({ data: { eventId: ko.id, position: 0, type: "Bracket Stage", format: "Match Play", playedOn: "2026-08-01" } });
  await entrant(ko.id, "ann", 1);
  const koBea = await entrant(ko.id, "bea", 2);
  await entrant(ko.id, "guest3", 3, null);
  await entrant(ko.id, "guest4", 4, null);
  await prisma.bracketWinner.create({ data: { eventId: ko.id, key: "winners-0-0", winnerId: koBea, result: "2&1" } });

  // 3. Controls that are NOT member meetings. A side four-ball IN THE SAME
  //    tournament as the singles — a second round, Ann's side beating Bea's —
  //    so the tournament is read and only the row itself can keep it out.
  const fbStage = await prisma.stage.create({ data: { eventId: rr.id, position: 1, type: "Round Robin", format: "Four-Ball Match Play" } });
  const [ta, tb] = [
    await prisma.team.create({ data: { eventId: rr.id, stageId: fbStage.id, name: "side A" } }),
    await prisma.team.create({ data: { eventId: rr.id, stageId: fbStage.id, name: "side B" } }),
  ];
  await prisma.match.create({
    data: { eventId: rr.id, stageId: fbStage.id, groupId: group.id, round: 1, playerAId: ann, playerBId: bea, teamAId: ta.id, teamBId: tb.id, holes: H("A".repeat(18)) },
  });
  const casual = await event("quick match", { shape: "match" });
  const cStage = await prisma.stage.create({ data: { eventId: casual.id, position: 0, type: "Single Match Stage", format: "Match Play" } });
  const cGroup = await prisma.group.create({ data: { eventId: casual.id, position: 0, name: `${TAG} c` } });
  const [ca, cb] = [await entrant(casual.id, "ann", 1), await entrant(casual.id, "bea", 2)];
  await prisma.match.create({ data: { eventId: casual.id, stageId: cStage.id, groupId: cGroup.id, round: 1, playerAId: ca, playerBId: cb, holes: H("B".repeat(18)) } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a member's record against each opponent", () => {
  it("finds meetings in a match's holes AND on a knockout's seats, across tournaments", async () => {
    const recs = recordAgainst(mem.ann, await meetingsFor(orgId, mem.ann));
    const vsBea = recs.find((r) => r.opponentId === mem.bea)!;
    // Won the round robin 3&2, lost the knockout final 2&1.
    expect({ won: vsBea.won, lost: vsBea.lost, halved: vsBea.halved }).toEqual({ won: 1, lost: 1, halved: 0 });
    expect(vsBea.meetings.map((m) => m.margin)).toEqual(["2&1", "3&2"]); // newest first
    expect(recordVerdict(vsBea)).toBe("All square 1–1");
  });

  it("counts a halve as a halve, and a concession for the player who did not concede", async () => {
    const ann = recordAgainst(mem.ann, await meetingsFor(orgId, mem.ann));
    expect(ann.find((r) => r.opponentId === mem.cal)).toMatchObject({ won: 0, lost: 0, halved: 1 });
    const bea = recordAgainst(mem.bea, await meetingsFor(orgId, mem.bea));
    const vsCal = bea.find((r) => r.opponentId === mem.cal)!;
    expect(vsCal).toMatchObject({ won: 1, lost: 0, halved: 0 });
    expect(vsCal.meetings[0].margin).toBe("conceded");
  });

  it("CONTROL: leaves out what is not a finished meeting between two members", async () => {
    const meetings = await meetingsFor(orgId, mem.ann);
    const names = new Set(meetings.map((m) => m.eventName));
    expect(names.has(`${TAG} quick match`), "a casual match is not a club result").toBe(false);
    // The side four-ball in Round 2 of the same tournament is a partnership's result.
    expect(meetings.some((m) => m.where === "Round 2"), "a side match is not a meeting").toBe(false);
    // The guest match is decided, but a guest cannot be followed across tournaments.
    expect(meetings.every((m) => m.a && m.b)).toBe(true);
    // Ann v Bea in the round robin: the 3&2 counts, the unfinished second match does not.
    expect(meetings.filter((m) => m.eventName === `${TAG} summer matchplay` && [m.a, m.b].includes(mem.bea))).toHaveLength(1);
    expect(meetings).toHaveLength(3); // 3&2 v Bea, halved v Cal, 2&1 v Bea
  });
});
