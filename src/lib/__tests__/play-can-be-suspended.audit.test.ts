import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * SUSPEND AND RESUME PLAY (Rule 5.7, 2026-09-28), driven through the real
 * actions against real rows: the committee can stop the field and start it
 * again, the record says who and why, and nobody else can do either.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { suspendPlay, resumePlay } = await import("@/app/actions/play-status");
const { tournamentStatusNow } = await import("@/lib/services/tournament-status");
const { consoleOffersPlayStop } = await import("@/lib/domain/play-status");
const { isMatch } = await import("@/lib/tournament-shape");

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SUSPEND";
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
      shareToken: `audit-suspend-${stamp}`,
    },
  });
  return event.id;
}
const as = (eventId: string, role: string) => {
  session = { eventId, email: `${TAG.toLowerCase()}-${role}@example.invalid`, name: `${TAG} ${role}`, role, viewRole: role };
};
const row = (id: string) => prisma.event.findUnique({ where: { id }, select: { playSuspendedAt: true, playSuspendedNote: true } });
const lines = (eventId: string) =>
  prisma.auditLog.findMany({ where: { eventId, action: { startsWith: "play-" } }, orderBy: { createdAt: "asc" }, select: { action: true, detail: true } });

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});
afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("the committee stops and restarts the field", () => {
  it("suspends with a reason, then resumes, and records both", async () => {
    const id = await seed();
    as(id, "admin");
    expect(await suspendPlay("  Lightning in the area ")).toEqual({ ok: true });
    const off = await row(id);
    expect(off!.playSuspendedAt).not.toBeNull();
    expect(off!.playSuspendedNote).toBe("Lightning in the area");

    expect(await resumePlay()).toEqual({ ok: true });
    const on = await row(id);
    expect(on!.playSuspendedAt).toBeNull();
    expect(on!.playSuspendedNote).toBe("");

    expect(await lines(id)).toEqual([
      { action: "play-suspended", detail: "Play suspended: Lightning in the area" },
      { action: "play-resumed", detail: "Play resumed" },
    ]);
  });

  it("an assistant may do it too — it is a committee job on the day", async () => {
    const id = await seed();
    as(id, "assistant");
    expect((await suspendPlay("")).ok).toBe(true);
    expect((await row(id))!.playSuspendedAt).not.toBeNull();
  });

  it("resuming play that was never suspended changes nothing and tells nobody", async () => {
    const id = await seed();
    as(id, "admin");
    expect(await resumePlay()).toEqual({ ok: true });
    expect(await lines(id)).toEqual([]);
  });

  it("a player can do neither", async () => {
    const id = await seed();
    as(id, "player");
    await expect(suspendPlay("fake storm")).rejects.toThrow();
    expect((await row(id))!.playSuspendedAt).toBeNull();
    as(id, "admin");
    await suspendPlay("");
    as(id, "player");
    await expect(resumePlay()).rejects.toThrow();
    expect((await row(id))!.playSuspendedAt).not.toBeNull();
  });
});

/**
 * AND THE CONSOLE OFFERS IT ON THE MACHINE'S REAL STEP (simplicity cut 2, 14 Nov).
 *
 * The shell draws Suspend play on every console screen by `consoleOffersPlayStop`,
 * handed the step the shell's chip shows (`tournamentStatusFor` on the club's day).
 * Asked here of real rows through the same service, so the rule is held to the
 * machine and not to a hand-made step: a draft is never offered it, a launched
 * tournament with a round to play is, a completed one is not — until play is
 * suspended there, when the way back is offered whatever the step.
 */
describe("the console offers Suspend play on the machine's step, from real rows", () => {
  async function seedWithRound(status: string, shape?: string) {
    const id = await seed();
    await prisma.event.update({ where: { id }, data: shape ? { status, shape } : { status } });
    await prisma.stage.create({ data: { eventId: id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" } });
    return id;
  }
  /** What the shell would draw for this viewer: its step, its row, its rule. */
  async function offered(id: string, viewRole: string) {
    const step = (await tournamentStatusNow(id))?.status.step ?? null;
    const r = await prisma.event.findUniqueOrThrow({ where: { id }, select: { playSuspendedAt: true, shape: true } });
    return { step, offered: consoleOffersPlayStop({ viewRole, step, suspended: !!r.playSuspendedAt, casualRound: isMatch(r.shape) }) };
  }

  it("a casual round: created live and never closed, and never offered it — the creator is no committee (#1149 C1)", async () => {
    const id = await seedWithRound("live", "match");
    expect(await offered(id, "admin"), "Suspend play over a game between friends").toEqual({ step: "live", offered: false });
  });

  it("a draft: not offered", async () => {
    const id = await seedWithRound("draft");
    expect(await offered(id, "admin")).toEqual({ step: "setting-up", offered: false });
  });

  it("launched with a round to play: offered to staff, never to a player", async () => {
    const id = await seedWithRound("live");
    expect(await offered(id, "admin")).toEqual({ step: "live", offered: true });
    expect((await offered(id, "assistant")).offered).toBe(true);
    expect((await offered(id, "player")).offered).toBe(false);
  });

  it("completed: not offered, until play is suspended there — then the way back is, and it goes once resumed", async () => {
    const id = await seedWithRound("completed");
    expect(await offered(id, "admin")).toEqual({ step: "completed", offered: false });
    as(id, "assistant");
    expect((await suspendPlay("Lightning")).ok).toBe(true);
    expect(await offered(id, "assistant"), "suspended, with no way back on the screen").toEqual({ step: "completed", offered: true });
    expect((await resumePlay()).ok).toBe(true);
    expect((await offered(id, "assistant")).offered).toBe(false);
  });
});
