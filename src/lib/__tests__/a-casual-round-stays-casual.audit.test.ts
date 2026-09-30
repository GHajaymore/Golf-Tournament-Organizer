import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CASUAL ROUND STAYS CASUAL (2026-09-30).
 *
 * One round, two to eight players (Ajay, 2026-09-08), and it counts against no
 * tournament allowance. Its creator — any member — is its organizer, and the
 * tournament field and round endpoints never asked what they were being called
 * on: a round that is not a tournament could be given more rounds and a bigger
 * field. Through the real actions, with a real tournament as the control.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUAL";
const ME = "zz-casual-me@example.invalid";

const auth = vi.hoisted(() => ({ session: null as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ getSession: async () => auth.session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addStage, addSignup, importCsvSignups } = await import("@/app/actions/tournament");

let orgId = "";
let casualId = "";
let tournamentId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const as = (eventId: string) => {
  auth.session = { eventId, role: "admin", viewRole: "admin", email: ME, name: `${TAG} Me` };
};

/** The field back to `n` players, named after the tag. */
async function fieldOf(eventId: string, n: number) {
  await prisma.player.deleteMany({ where: { eventId } });
  for (let i = 1; i <= n; i += 1) {
    await prisma.player.create({ data: { eventId, name: `${TAG} Player ${i}`, status: "confirmed", seed: i } });
  }
}

beforeAll(async () => {
  await scrub();
  // A paid plan, so no tier limit is what refuses anything here.
  const org = await prisma.organization.create({
    data: { name: `${TAG} Club`, kind: "club", subscription: { create: { plan: "club", planTermsApply: true } } },
  });
  orgId = org.id;
  const base = { organizationId: orgId, dates: "", course: "", city: "", address: "", regDeadline: "", playerAccess: "code" };
  casualId = (await prisma.event.create({ data: { ...base, name: `${TAG} Sunday Fourball`, shape: "match", shareToken: `${TAG.toLowerCase()}-m` } })).id;
  tournamentId = (await prisma.event.create({ data: { ...base, name: `${TAG} Medal`, shape: "single", shareToken: `${TAG.toLowerCase()}-t` } })).id;
  await prisma.stage.create({ data: { eventId: casualId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
});

beforeEach(async () => {
  await prisma.stage.deleteMany({ where: { eventId: tournamentId } });
  await prisma.stage.deleteMany({ where: { eventId: casualId, position: { gt: 0 } } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a casual round cannot be grown into a tournament", () => {
  it("refuses a second round", async () => {
    as(casualId);
    const r = await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(r.error).toMatch(/casual round is one round/);
    // And where to go instead: "there is always a free tier" (Ajay, 2026-09-30).
    expect(r.error).toMatch(/free on Par/);
    expect(await prisma.stage.count({ where: { eventId: casualId } })).toBe(1);
  });

  it("refuses a ninth player, by hand and by file", async () => {
    as(casualId);
    await fieldOf(casualId, 8);
    const one = await addSignup({ name: `${TAG} Ninth`, handicap: 10 });
    expect(one.ok).toBe(false);
    expect(one.error).toMatch(/up to 8 players/);
    expect(one.error).toMatch(/free on Par/);
    const file = await importCsvSignups(`name,handicap\n${TAG} Tenth,12\n`);
    expect(file.error).toMatch(/up to 8 players/);
    expect(await prisma.player.count({ where: { eventId: casualId } })).toBe(8);
  });

  it("CONTROL: takes an eighth", async () => {
    as(casualId);
    await fieldOf(casualId, 7);
    expect((await addSignup({ name: `${TAG} Eighth`, handicap: 10 })).ok).toBe(true);
  });

  it("CONTROL: a tournament takes rounds and a ninth player", async () => {
    as(tournamentId);
    expect((await addStage("Stroke Play Round", { format: "Stroke Play" })).error).toBeUndefined();
    await fieldOf(tournamentId, 8);
    expect((await addSignup({ name: `${TAG} Ninth`, handicap: 10 })).ok).toBe(true);
  });
});
