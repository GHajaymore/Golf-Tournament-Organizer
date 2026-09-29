import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE TEAM CUP (2026-09-28), driven through the real actions and read back
 * through the one board every screen shows.
 *
 * Two teams (two flights), a four-ball session and a singles session. The
 * lineup must come from the right teams, nobody plays twice in a session, and
 * the score counts decided matches only — including a match stored the other
 * way round, which must still be credited to the right team.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addCupMatch, removeCupMatch, setCupSettings } = await import("@/app/actions/cup");
const { cupBoard } = await import("@/lib/services/cup");

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUP";
let orgId = "";

async function seed() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${stamp}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "live",
      shareToken: `audit-cup-${stamp}`,
    },
  });
  const eventId = event.id;
  const eur = await prisma.group.create({ data: { eventId, name: `${TAG} Europe`, position: 0 } });
  const usa = await prisma.group.create({ data: { eventId, name: `${TAG} USA`, position: 1 } });
  const fourball = await prisma.stage.create({
    data: { eventId, position: 0, type: "Team Session", format: "Four-Ball", holes: 18, description: "Friday fourballs" },
  });
  const singles = await prisma.stage.create({
    data: { eventId, position: 1, type: "Team Session", format: "Match Play", holes: 18, description: "Sunday singles" },
  });
  let seedNo = 0;
  const mk = async (name: string, groupId: string, status = "confirmed") =>
    (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${name}`,
          email: `${TAG.toLowerCase()}-${name}-${stamp}@example.invalid`,
          handicap: 10,
          seed: ++seedNo,
          status,
          groupId,
        },
      })
    ).id;
  const e = [await mk("E1", eur.id), await mk("E2", eur.id), await mk("E3", eur.id), await mk("E4", eur.id)];
  const u = [await mk("U1", usa.id), await mk("U2", usa.id), await mk("U3", usa.id), await mk("U4", usa.id)];
  const waiting = await mk("Ewait", eur.id, "waitlisted");
  session = { eventId, email: `${TAG.toLowerCase()}-staff@example.invalid`, name: `${TAG} staff`, role: "admin", viewRole: "admin" };
  return { eventId, eur: eur.id, usa: usa.id, fourball: fourball.id, singles: singles.id, e, u, waiting };
}

const board = async (eventId: string) => {
  const r = await cupBoard(eventId);
  if (!r.ok) throw new Error(`no board: ${r.reason}`);
  return r.board;
};
const holes = (s: string) => JSON.stringify([...s.padEnd(18, "-")].map((c) => (c === "-" ? null : c)));

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "society" } })).id;
});
afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("setting the lineup", () => {
  it("adds a four-ball pair v pair and a singles match, each on the right team", async () => {
    const f = await seed();
    expect(await addCupMatch(f.fourball, [f.e[0], f.e[1]], [f.u[0], f.u[1]])).toEqual({ ok: true });
    expect(await addCupMatch(f.singles, [f.e[0]], [f.u[0]])).toEqual({ ok: true });
    const b = await board(f.eventId);
    expect(b.teams.map((t) => t.name)).toEqual([`${TAG} Europe`, `${TAG} USA`]);
    expect(b.sessions.map((s) => [s.name, s.kind, s.matches.length])).toEqual([
      ["Friday fourballs", "Four-Ball", 1],
      ["Sunday singles", "Singles", 1],
    ]);
    expect(b.sessions[0].matches[0].a).toEqual([`${TAG} E1`, `${TAG} E2`]);
    expect(b.tally).toMatchObject({ a: 0, b: 0, total: 2, notStarted: 2 });
  });

  it("refuses a side from the wrong team, a player twice in a session, and an unconfirmed player", async () => {
    const f = await seed();
    expect((await addCupMatch(f.singles, [f.u[0]], [f.e[0]])).ok, "teams swapped").toBe(false);
    expect((await addCupMatch(f.fourball, [f.e[0]], [f.u[0]])).ok, "one player in a pair format").toBe(false);
    expect((await addCupMatch(f.singles, [f.waiting], [f.u[0]])).ok, "not confirmed").toBe(false);
    expect((await addCupMatch(f.singles, [f.e[0]], [f.u[0]])).ok).toBe(true);
    expect((await addCupMatch(f.singles, [f.e[0]], [f.u[1]])).ok, "E1 twice in the singles").toBe(false);
    // CONTROL: E1 may still play in a different session.
    expect((await addCupMatch(f.fourball, [f.e[0], f.e[1]], [f.u[0], f.u[1]])).ok).toBe(true);
  });

  it("a player cannot set the lineup", async () => {
    const f = await seed();
    session = { ...session!, role: "player", viewRole: "player" };
    await expect(addCupMatch(f.singles, [f.e[0]], [f.u[0]])).rejects.toThrow();
  });
});

describe("the score", () => {
  it("counts decided matches only, a halve as half each, and credits a reversed match to the right team", async () => {
    const f = await seed();
    await addCupMatch(f.singles, [f.e[0]], [f.u[0]]);
    await addCupMatch(f.singles, [f.e[1]], [f.u[1]]);
    await addCupMatch(f.singles, [f.e[2]], [f.u[2]]);
    const ms = await prisma.match.findMany({ where: { stageId: f.singles }, orderBy: { round: "asc" } });
    // Europe wins the first 4&3; the second is halved; the third is 2 UP to Europe thru 14 (not a point yet).
    await prisma.match.update({ where: { id: ms[0].id }, data: { holes: holes("AAAA" + "H".repeat(11)) } });
    await prisma.match.update({ where: { id: ms[1].id }, data: { holes: holes("AB" + "H".repeat(16)) } });
    await prisma.match.update({ where: { id: ms[2].id }, data: { holes: holes("AA" + "H".repeat(12)) } });
    // A fourth singles stored the OTHER way round — USA in the A columns — won by USA 5&4.
    const carrier = ms[0].groupId;
    await prisma.match.create({
      data: { eventId: f.eventId, stageId: f.singles, groupId: carrier, round: 4, playerAId: f.u[3], playerBId: f.e[3], holes: holes("AAAAA" + "H".repeat(9)) },
    });

    const b = await board(f.eventId);
    expect(b.tally).toEqual({ a: 1.5, b: 1.5, total: 4, decided: 3, inPlay: 1, notStarted: 0 });
    const reversed = b.sessions[1].matches.find((m) => m.b.includes(`${TAG} U4`))!;
    expect(reversed.a).toEqual([`${TAG} E4`]);
    expect(reversed.state).toMatchObject({ points: [0, 1], leader: "B", label: "5&4" });
    // 4 matches → 2½ to win outright.
    expect(b.target).toBe(2.5);
    expect(b.verdict).toEqual({ kind: "open", needA: 1, needB: 1 });
  });

  it("a named holder retains on a tie; the holder must be one of the teams", async () => {
    const f = await seed();
    await addCupMatch(f.singles, [f.e[0]], [f.u[0]]);
    await addCupMatch(f.singles, [f.e[1]], [f.u[1]]);
    const ms = await prisma.match.findMany({ where: { stageId: f.singles }, orderBy: { round: "asc" } });
    await prisma.match.update({ where: { id: ms[0].id }, data: { holes: holes("AAAA" + "H".repeat(11)) } });
    await prisma.match.update({ where: { id: ms[1].id }, data: { holes: holes("BBBB" + "H".repeat(11)) } });
    expect((await setCupSettings(0, "not-a-team")).ok).toBe(false);
    expect(await setCupSettings(0, f.usa)).toEqual({ ok: true });
    expect((await board(f.eventId)).verdict).toEqual({ kind: "retained", by: "B" });
  });

  it("a match with scores in it cannot be removed from the lineup; an unplayed one can", async () => {
    const f = await seed();
    await addCupMatch(f.singles, [f.e[0]], [f.u[0]]);
    await addCupMatch(f.singles, [f.e[1]], [f.u[1]]);
    const ms = await prisma.match.findMany({ where: { stageId: f.singles }, orderBy: { round: "asc" } });
    await prisma.match.update({ where: { id: ms[0].id }, data: { holes: holes("A") } });
    expect((await removeCupMatch(ms[0].id)).ok).toBe(false);
    expect(await removeCupMatch(ms[1].id)).toEqual({ ok: true });
    expect(await prisma.match.count({ where: { stageId: f.singles } })).toBe(1);
  });
});
