import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * "SAVE EVENT" SAVES THE CALENDAR DATES, NOT ONLY THEIR LABEL (2026-10-10).
 *
 * The tournament's own screen read "Oct 12 – 13, 2026" while every member's
 * Events list, the club calendar and the season filed it under "No dates
 * yet": "Save event" stored the label and left `startOn`/`endOn` empty, which
 * only the second, smaller "Save dates" button wrote. Found when a member's
 * finished two-round better-ball disappeared into a folded "No dates yet ·
 * 24 tournaments" on her phone.
 *
 * Controls: an older caller that sends no calendar dates leaves them alone; a
 * finish before the start is taken as a single day, as `setTournamentDates`
 * takes it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SAVEDATES";
const EMAIL = `${TAG}.owner@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} owner`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveEvent } = await import("@/app/actions/tournament");

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
      data: { organizationId: org.id, name: `${TAG} better-ball`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}` },
    })
  ).id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} owner`, role: "admin" } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const details = (extra: Record<string, string>) => ({
  name: `${TAG} better-ball`, dates: "Oct 12 – 13, 2026", format: "stroke", course: "", courseId: "", city: "",
  address: "", regDeadline: "", capacity: 0, playerCountMode: "registration", courseMode: "fixed", ...extra,
});
const stored = async () => prisma.event.findUnique({ where: { id: eventId }, select: { startOn: true, endOn: true, dates: true } });

describe("Save event", () => {
  it("stores the calendar dates with their label", async () => {
    await saveEvent(details({ startOn: "2026-10-12", endOn: "2026-10-13" }));
    expect(await stored()).toEqual({ startOn: "2026-10-12", endOn: "2026-10-13", dates: "Oct 12 – 13, 2026" });
  });

  it("CONTROL: an older caller that sends no calendar dates leaves them alone", async () => {
    await saveEvent(details({}));
    expect((await stored())?.startOn).toBe("2026-10-12");
  });

  it("CONTROL: a finish before the start is one day", async () => {
    await saveEvent(details({ startOn: "2026-10-12", endOn: "2026-10-01" }));
    expect(await stored()).toMatchObject({ startOn: "2026-10-12", endOn: "2026-10-12" });
  });
});
