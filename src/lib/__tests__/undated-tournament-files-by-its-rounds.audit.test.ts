import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { clubEventsFor } from "@/lib/services/club-events";

/**
 * EVENTS FILES A TOURNAMENT WITH NO DATES BY ITS ROUNDS' DATES (Ajay, 2026-09-26).
 *
 * The seeded Summer Knockout — rounds on 5 and 19 September, no tournament
 * dates — sat under "No dates yet" on Events while the member's calendar showed
 * it on 5 September. Asserted through `clubEventsFor`, the function the Events
 * screen renders, against real rows: the helper alone could be right while the
 * service went on reading `event.startOn`.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-undated-rounds";
const WHO = `${TAG}-${randomBytes(4).toString("hex")}@example.invalid`;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function tournament(orgId: string, name: string, extra: Record<string, unknown>) {
  return (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} ${name}`,
        status: "live",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        course: `${TAG} Course`,
        city: "",
        address: "",
        regDeadline: "",
        capacity: 0,
        registrationToken: randomBytes(6).toString("hex"),
        shareToken: randomBytes(10).toString("hex"),
        ...extra,
      },
      select: { id: true },
    })
  ).id;
}

let undated = "";
let dated = "";

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const user = await prisma.user.create({ data: { email: WHO, name: `${TAG} Member` }, select: { id: true } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "member" } });

  undated = await tournament(org.id, "knockout, rounds dated only", { dates: "", startOn: "" });
  await prisma.stage.createMany({
    data: [
      { eventId: undated, position: 0, type: "Round Robin", format: "Match Play", playedOn: "2026-09-19" },
      { eventId: undated, position: 1, type: "Bracket Stage", format: "Match Play", playedOn: "2026-09-05" },
    ],
  });

  // The control: the tournament's own dates win wherever they are set.
  dated = await tournament(org.id, "has its own dates", { dates: "1 Aug 2026", startOn: "2026-08-01" });
  await prisma.stage.create({
    data: { eventId: dated, position: 0, type: "Stroke Play Round", format: "Stroke Play", playedOn: "2026-09-30" },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a tournament's dates on Events", () => {
  it("falls back to its earliest round when it has none of its own", async () => {
    const row = (await clubEventsFor(WHO)).find((r) => r.eventId === undated);
    expect(row, "the tournament is not on the member's Events at all").toBeTruthy();
    expect(row!.startOn, "filed under No dates yet with dated rounds").toBe("2026-09-05");
    expect(row!.dates).toMatch(/5 Sep.*19 Sep/);
  });

  it("keeps the tournament's own dates where they are set (the control)", async () => {
    const row = (await clubEventsFor(WHO)).find((r) => r.eventId === dated);
    expect(row!.startOn).toBe("2026-08-01");
    expect(row!.dates).toBe("1 Aug 2026");
  });
});
