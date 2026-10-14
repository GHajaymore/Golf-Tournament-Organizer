import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { byAddress } from "@/lib/domain/my-entry";
import { myPlayerIds } from "@/lib/services/me";
import { playsInMatch } from "@/lib/services/match-access";
import { myCupIds } from "@/lib/services/cup";
import { prizesForEntrant } from "@/lib/services/player-prizes";

/**
 * AN EMPTY ADDRESS IS NOBODY — on real rows.
 *
 * Two entries made without an address, as round codes and a committee's own
 * typing make them, and a match between them. Asked with an empty address, the
 * readers that decide "which entries are mine" must answer nobody: not the two
 * address-less players, and not their match.
 *
 * The CONTROL is the query every one of them used to write, run against the
 * same rows: `email: { equals: "" }` finds both players. So the hazard is real,
 * and these assertions are not passing on an empty table.
 *
 * `my-entries-are-asked-one-way.test.ts` holds every query to `byAddress`.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-EMPTY-ADDRESS";
let eventId = "";
const id: Record<string, string> = {};

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  eventId = (
    await prisma.event.create({
      data: { name: `${TAG} medal`, organizationId: org.id, status: "live", format: "match", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-share` },
      select: { id: true },
    })
  ).id;
  for (const [i, who] of ["p", "q"].entries()) {
    id[who] = (
      await prisma.player.create({ data: { eventId, name: `${TAG} ${who}`, email: "", seed: i + 1, status: "confirmed", handicap: 10 }, select: { id: true } })
    ).id;
  }
  // And one with an address, who is somebody.
  id.r = (
    await prisma.player.create({
      data: { eventId, name: `${TAG} r`, email: `${TAG.toLowerCase()}-r@example.invalid`, seed: 3, status: "confirmed", handicap: 10 },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("asked with an empty address", () => {
  it("CONTROL: the query the readers used to write finds both address-less players", async () => {
    const found = await prisma.player.findMany({ where: { eventId, email: { equals: "", mode: "insensitive" } }, select: { id: true } });
    expect(found.map((p) => p.id).sort()).toEqual([id.p, id.q].sort());
  });

  it("byAddress finds nobody, and finds the one with an address when asked by it", async () => {
    for (const nobody of ["", "  "]) {
      expect(await prisma.player.count({ where: { eventId, ...byAddress(nobody) } }), JSON.stringify(nobody)).toBe(0);
    }
    const r = await prisma.player.findMany({ where: { eventId, ...byAddress(`  ${TAG}-R@EXAMPLE.INVALID `) }, select: { id: true } });
    expect(r.map((p) => p.id), "control: an address, in another case and with spaces, is found").toEqual([id.r]);
  });

  it("is in no entry, no match, no cup side and no prize", async () => {
    expect([...(await myPlayerIds(eventId, ""))]).toEqual([]);
    expect(await playsInMatch(eventId, "", { playerAId: id.p, playerBId: id.q })).toBe(false);
    expect([...(await myCupIds(eventId, "")).players]).toEqual([]);
    expect(await prizesForEntrant(eventId, "")).toEqual([]);
    // CONTROL: the player with an address is in their own match.
    expect(await playsInMatch(eventId, `${TAG.toLowerCase()}-r@example.invalid`, { playerAId: id.r, playerBId: id.q })).toBe(true);
  });
});
