import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const auth = vi.hoisted(() => ({ session: null as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ getSession: async () => auth.session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/**
 * THE TABLE A SEASON IS DESCRIBED BY IS THE TABLE IT IS SCORED ON.
 *
 * Found 2026-10-13 by using the season screen in a browser for the first time.
 * A season's rules were saved with an empty points box — which is what the box
 * held, wrongly, straight after a season was started — and the season was
 * stored with a points table of `[]`. The standings have always read an empty
 * table as the default one. The sentence above them read it as it was stored:
 *
 *     points · best 5 rounds count
 *
 * Two readers of one column, each right about what it was handed, saying
 * different things on one screen. The browser test (`e2e/seasons.spec.ts`)
 * holds the screen; it cannot reach a season ALREADY stored that way, because
 * the app no longer stores one. This can, and production may hold some.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SEASON-POINTS";

const { seriesForOrg } = await import("@/lib/services/series");
const { updateSeries } = await import("@/app/actions/series");
const { DEFAULT_POINTS_TABLE, describeTable } = await import("@/lib/domain/series");

let organizationId = "";
const scrub = () => prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} Society` } });
  organizationId = org.id;
  await prisma.subscription.create({ data: { organizationId, plan: "society", status: "active" } });
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} Monthly Medal`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG.toLowerCase()}-share`,
    },
  });
  auth.session = { eventId: event.id, role: "admin", viewRole: "admin", email: "zz-season-points@example.invalid", name: `${TAG} Secretary` };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const shown = async (id: string) => (await seriesForOrg(organizationId)).find((s) => s.id === id)!;

describe("a season's points table", () => {
  it("stored empty, is described as the default table the standings score on", async () => {
    const old = await prisma.series.create({ data: { organizationId, name: `${TAG} Stored Empty`, pointsTable: "[]" } });
    const view = await shown(old.id);
    expect(view.pointsTable, "a season stored with no table is described as having none").toEqual(DEFAULT_POINTS_TABLE);
    expect(describeTable(view.pointsTable)).toBe("100, 80, 65… down to 8 for 20th");
  });

  it("a table that was really typed is described as typed — the control", async () => {
    const own = await prisma.series.create({ data: { organizationId, name: `${TAG} Its Own`, pointsTable: "[25,18,15]" } });
    expect((await shown(own.id)).pointsTable).toEqual([25, 18, 15]);
  });

  it("saved with an empty box, is stored as the default table and not as nothing", async () => {
    const season = await prisma.series.create({ data: { organizationId, name: `${TAG} Saved Empty`, pointsTable: "[25,18,15]" } });
    expect(await updateSeries(season.id, { pointsTable: "  ", bestOf: 5 })).toEqual({ ok: true });
    const stored = await prisma.series.findUniqueOrThrow({ where: { id: season.id } });
    expect(JSON.parse(stored.pointsTable)).toEqual(DEFAULT_POINTS_TABLE);
    expect(stored.bestOf).toBe(5);
  });

  it("refuses points that are not numbers, and keeps the table it had", async () => {
    const season = await prisma.series.create({ data: { organizationId, name: `${TAG} Refused`, pointsTable: "[25,18,15]" } });
    expect(await updateSeries(season.id, { pointsTable: "50, thirty", bestOf: 9 })).toEqual({ ok: false, error: "Points must be numbers, like 100, 80, 65." });
    const stored = await prisma.series.findUniqueOrThrow({ where: { id: season.id } });
    expect(JSON.parse(stored.pointsTable), "a refused save changed the table").toEqual([25, 18, 15]);
    expect(stored.bestOf, "a refused save stored the other rules that came with it").toBe(0);
  });
});
