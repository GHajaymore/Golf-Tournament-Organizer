import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PAIR IS ITS TWO PLAYERS IN THE ORDER THE CAPTAIN PICKED THEM.
 *
 * `nominatePair` looks the two ids up in the tournament before it uses them,
 * which is right — it is a public endpoint and works from the rows that came
 * back. It then took the pair's ORDER from those rows as well, and the query
 * has no order: the database returns them however it likes. So a secretary who
 * picked One and then Four got a pair named "Four / One" whenever the rows
 * happened to come back that way, with Four as its first player.
 *
 * Found on 2026-10-13 by a failed check, not by a person: the browser test that
 * runs a league from its first week (`e2e/interclub-league.spec.ts`) passed
 * twenty times running on one machine and in two full runs, and failed once on
 * GitHub looking for "Cardross One / Cardross Four" on a page that showed
 * "Cardross Four / Cardross One". It read as the test being impatient. The
 * page it kept showed the pair had been put up, under the other name.
 *
 * So the order is an axis, and this walks it: the same two players, nominated
 * both ways round, and the same again for two players created in the opposite
 * order — whichever way the database prefers, one of the four differs from it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-pair-order";

const session = { email: `${TAG}@example.invalid`, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { nominatePair, withdrawPair } = await import("@/app/actions/league");

let stageId = "";
let clubId = "";
const id: Record<string, string> = {};

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
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `${TAG}-${process.pid}`,
      registrationToken: `${TAG}r-${process.pid}`,
    },
  });
  session.eventId = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: session.email, name: session.name, role: "admin" } });
  stageId = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18, scoringBasis: "net" },
    })
  ).id;
  clubId = (await prisma.group.create({ data: { eventId: event.id, name: `${TAG} Cardross`, position: 0 } })).id;
  // Created one at a time, so the order they were made in is known: One, Two, Three, Four.
  for (const [i, who] of ["One", "Two", "Three", "Four"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        handicap: 10 + i,
        handicapType: "18",
        seed: i + 1,
        status: "confirmed",
        groupId: clubId,
      },
    });
    id[who] = p.id;
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Nominate two players in this order, read the pair back, and take it down again. */
async function pairOf(first: string, second: string) {
  const res = await nominatePair(stageId, clubId, [id[first], id[second]]);
  expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
  const team = await prisma.team.findFirstOrThrow({
    where: { eventId: session.eventId, stageId, clubGroupId: clubId },
    include: { members: { orderBy: { position: "asc" }, include: { player: { select: { name: true } } } } },
  });
  const read = { name: team.name, members: team.members.map((m) => m.player.name.replace(`${TAG} `, "")) };
  const down = await withdrawPair(team.id);
  expect(down.ok, `could not take the pair down: ${down.ok === false ? down.error : ""}`).toBe(true);
  return read;
}

describe("a nominated pair", () => {
  for (const [first, second] of [
    ["One", "Four"],
    ["Four", "One"],
    ["Three", "Two"],
    ["Two", "Three"],
  ]) {
    it(`${first} then ${second} is named "${first} / ${second}", with ${first} as its first player`, async () => {
      const pair = await pairOf(first, second);
      expect(pair.name).toBe(`${TAG} ${first} / ${TAG} ${second}`);
      expect(pair.members).toEqual([first, second]);
    });
  }

  it("the same player sent twice is still one player, and is refused as half a pair", async () => {
    const res = await nominatePair(stageId, clubId, [id.One, id.One]);
    expect(res.ok).toBe(false);
    expect(await prisma.team.count({ where: { eventId: session.eventId, stageId } })).toBe(0);
  });

  it("an id from nowhere is refused, whichever place it is sent in", async () => {
    for (const ids of [[id.One, "not-a-player"], ["not-a-player", id.One]]) {
      const res = await nominatePair(stageId, clubId, ids);
      expect(res.ok).toBe(false);
    }
    expect(await prisma.team.count({ where: { eventId: session.eventId, stageId } })).toBe(0);
  });
});
