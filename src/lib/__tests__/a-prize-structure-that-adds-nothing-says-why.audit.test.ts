import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PRIZE STRUCTURE THAT ADDS NOTHING SAYS WHY (sweep 1, a2, 2026-10-10).
 *
 * Prizes & payouts offers "Flight winners" beside the other starting
 * structures: one line per flight. On a field not yet drawn into flights
 * there are none to add, and the action returned without a word — the button
 * was pressed, nothing appeared, nothing was said. A secretary has no way to
 * tell that from the app being broken.
 *
 * It answers now, and the answer names the remedy.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PRIZESTRUCT";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { applyPrizeStructure } = await import("@/app/actions/tournament");

let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: { organizationId: org.id, name: `${TAG} medal`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}` },
    })
  ).id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const prizes = () => prisma.prize.findMany({ where: { eventId }, select: { category: true }, orderBy: { position: "asc" } });

describe("starting the prize list from a structure", () => {
  it("says why 'Flight winners' added nothing on a field with no flights", async () => {
    const res = await applyPrizeStructure("flight-winners");
    expect(res.ok).toBe(false);
    expect(res.error ?? "", "nothing added and nothing said").toMatch(/flights/i);
    expect(res.error ?? "").toMatch(/Flights & groups/);
    expect(await prizes()).toEqual([]);
  });

  it("refuses a structure it does not know, rather than adding nothing in silence", async () => {
    const res = await applyPrizeStructure("constructor");
    expect(res.ok).toBe(false);
    expect(await prizes()).toEqual([]);
  });

  it("CONTROL: a structure that needs no flights is added", async () => {
    const res = await applyPrizeStructure("gross-net");
    expect(res.ok).toBe(true);
    expect((await prizes()).map((p) => p.category)).toEqual(["Best gross", "Best net"]);
  });

  it("CONTROL: and with flights drawn, each gets its winner's line", async () => {
    await prisma.group.createMany({
      data: [
        { eventId, name: "A", position: 0 },
        { eventId, name: "B", position: 1 },
      ],
    });
    const res = await applyPrizeStructure("flight-winners");
    expect(res.ok).toBe(true);
    expect((await prizes()).map((p) => p.category).slice(-2)).toEqual(["Flight A — Winner", "Flight B — Winner"]);
  });
});
