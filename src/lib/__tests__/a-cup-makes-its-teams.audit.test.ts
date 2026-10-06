import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TEAM CUP MAKES ITS OWN TWO TEAMS (2026-10-06), through the real actions.
 *
 * They were made on Flights with the "Manual" formation rule — found walking a
 * cup from nothing. Now the Team cup screen names them and places players, on
 * the same rows (a team is a flight), so the rules that keep a cup coherent
 * are pinned here: exactly two, never beside other flights, nobody moved out
 * from under a lineup, and a captain who leaves stops captaining.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createCupTeams, renameCupTeam, setCupPlayerTeam, addCupMatch } = await import("@/app/actions/cup");

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUPTEAMS";

async function seed() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${TAG} ${stamp}`, kind: "society" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} ${stamp}`, dates: "", course: "", city: "", address: "",
      regDeadline: "", capacity: 0, status: "draft", shareToken: `${TAG}-${stamp}`,
    },
  });
  const singles = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles" },
  });
  const p = [] as string[];
  for (let i = 0; i < 4; i++) {
    p.push(
      (
        await prisma.player.create({
          data: { eventId: event.id, name: `${TAG} P${i}`, email: `${TAG.toLowerCase()}-${i}-${stamp}@example.invalid`, seed: i + 1, status: "confirmed" },
        })
      ).id,
    );
  }
  session = { eventId: event.id, email: `${TAG.toLowerCase()}-staff@example.invalid`, name: "staff", role: "admin", viewRole: "admin" };
  return { eventId: event.id, singles: singles.id, p };
}
const flights = (eventId: string) =>
  prisma.group.findMany({ where: { eventId, stageId: null, isCarrier: false }, orderBy: { position: "asc" } });

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
});
afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("making the two teams", () => {
  it("names them, in order — and refuses a blank or a duplicate name", async () => {
    const f = await seed();
    expect((await createCupTeams("Blues", "")).ok).toBe(false);
    expect((await createCupTeams("Blues", "blues")).ok).toBe(false);
    expect(await createCupTeams("Blues", "Whites")).toEqual({ ok: true });
    expect((await flights(f.eventId)).map((g) => g.name)).toEqual(["Blues", "Whites"]);
  });

  it("never beside flights that already exist — a cup is two teams, not four", async () => {
    const f = await seed();
    await prisma.group.create({ data: { eventId: f.eventId, name: "Flight A", position: 0 } });
    expect((await createCupTeams("Blues", "Whites")).ok).toBe(false);
    expect(await flights(f.eventId)).toHaveLength(1);
  });

  it("CONTROL: a player cannot make them", async () => {
    await seed();
    session = { ...session!, role: "player", viewRole: "player" };
    await expect(createCupTeams("Blues", "Whites")).rejects.toThrow();
  });
});

describe("who is on which team", () => {
  it("places a player, takes them off, and refuses a team that is not the cup's", async () => {
    const f = await seed();
    await createCupTeams("Blues", "Whites");
    const [blues, whites] = await flights(f.eventId);
    expect(await setCupPlayerTeam(f.p[0], blues.id)).toEqual({ ok: true });
    expect((await prisma.player.findUniqueOrThrow({ where: { id: f.p[0] } })).groupId).toBe(blues.id);
    expect(await setCupPlayerTeam(f.p[0], "")).toEqual({ ok: true });
    expect((await prisma.player.findUniqueOrThrow({ where: { id: f.p[0] } })).groupId).toBeNull();
    expect((await setCupPlayerTeam(f.p[0], "not-a-team")).ok).toBe(false);
    expect(await setCupPlayerTeam(f.p[1], whites.id)).toEqual({ ok: true });
  });

  it("will not move somebody out from under a lineup", async () => {
    const f = await seed();
    await createCupTeams("Blues", "Whites");
    const [blues, whites] = await flights(f.eventId);
    await setCupPlayerTeam(f.p[0], blues.id);
    await setCupPlayerTeam(f.p[1], whites.id);
    expect(await addCupMatch(f.singles, [f.p[0]], [f.p[1]])).toEqual({ ok: true });
    const r = await setCupPlayerTeam(f.p[0], whites.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lineup/);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: f.p[0] } })).groupId).toBe(blues.id);
    // CONTROL: somebody in no match moves freely.
    await setCupPlayerTeam(f.p[2], blues.id);
    expect(await setCupPlayerTeam(f.p[2], whites.id)).toEqual({ ok: true });
  });

  it("a captain who leaves a team stops captaining it", async () => {
    const f = await seed();
    await createCupTeams("Blues", "Whites");
    const [blues] = await flights(f.eventId);
    await setCupPlayerTeam(f.p[0], blues.id);
    await prisma.group.update({ where: { id: blues.id }, data: { captainId: f.p[0] } });
    await setCupPlayerTeam(f.p[0], "");
    expect((await prisma.group.findUniqueOrThrow({ where: { id: blues.id } })).captainId).toBeNull();
  });

  it("renames a team, and refuses the other team's name", async () => {
    const f = await seed();
    await createCupTeams("Blues", "Whites");
    const [blues] = await flights(f.eventId);
    expect((await renameCupTeam(blues.id, "whites")).ok).toBe(false);
    expect(await renameCupTeam(blues.id, "Europe")).toEqual({ ok: true });
    expect((await flights(f.eventId)).map((g) => g.name)).toEqual(["Europe", "Whites"]);
  });
});
