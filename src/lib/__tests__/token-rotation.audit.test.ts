import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateShareToken } from "@/lib/codes";

/**
 * P3 of the 2026-08-12 audit — a public link with no way to replace it.
 *
 * The action itself needs a session, so what is provable here is the property
 * the action has to deliver: a new token is genuinely new, genuinely unique,
 * and the old one stops resolving. A rotation that produced a colliding or
 * guessable token would be worse than none, because the screen would say the
 * link had been replaced.
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TOKEN";

let eventId = "";
let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const ev = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: generateShareToken(),
      registrationToken: generateShareToken(),
    },
  });
  eventId = ev.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("replacing a public link", () => {
  it("stops the old leaderboard token resolving", async () => {
    const before = (await prisma.event.findUnique({ where: { id: eventId } }))!.shareToken;
    const next = generateShareToken();
    await prisma.event.update({ where: { id: eventId }, data: { shareToken: next } });

    // The old URL is what an organizer is trying to kill. It must find nothing.
    expect(await prisma.event.findFirst({ where: { shareToken: before } })).toBeNull();
    expect(await prisma.event.findFirst({ where: { shareToken: next } })).not.toBeNull();
  });

  it("stops the old sign-up token resolving", async () => {
    const before = (await prisma.event.findUnique({ where: { id: eventId } }))!.registrationToken;
    const next = generateShareToken();
    await prisma.event.update({ where: { id: eventId }, data: { registrationToken: next } });

    expect(await prisma.event.findFirst({ where: { registrationToken: before } })).toBeNull();
    expect(await prisma.event.findFirst({ where: { registrationToken: next } })).not.toBeNull();
  });

  it("mints a token nobody could have guessed, and no two the same", async () => {
    // A rotation that collided would hand one club another's leaderboard.
    const many = Array.from({ length: 500 }, () => generateShareToken());
    expect(new Set(many).size).toBe(many.length);
    expect(many.every((t) => t.length >= 20)).toBe(true);
  });

  it("leaves the tournament otherwise untouched", async () => {
    // Rotating a link must not be a way to change anything else about an
    // event — the action writes one column and this is the cheap check on it.
    const ev = (await prisma.event.findUnique({ where: { id: eventId } }))!;
    expect(ev.name).toBe(`${TAG} open`);
    expect(ev.organizationId).toBe(orgId);
  });
});
