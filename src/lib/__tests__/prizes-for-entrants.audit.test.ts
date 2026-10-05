import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));
import { prizesForEntrant } from "../services/player-prizes";

/**
 * PRIZES ARE SHOWN TO THE PEOPLE PLAYING FOR THEM, AND TO NOBODY ELSE
 * (Ajay, 2026-10-05).
 *
 * Against real rows, because "who is in this tournament" is a question about
 * the player table — confirmed, waitlisted, a different event — and the rule is
 * only as good as that query.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PLAYER-PRIZES";
const mail = (who: string) => `${TAG.toLowerCase()}-${who}@example.invalid`;

let eventId = "";
let otherEventId = "";

async function event(name: string, orgId: string) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "live",
      shareToken: `${TAG}-${name}-${Date.now()}-${Math.random()}`,
    },
  });
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } });
  const ev = await event("Captain's Prize", org.id);
  const other = await event("Another Medal", org.id);
  eventId = ev.id;
  otherEventId = other.id;

  const winner = await prisma.player.create({
    data: { eventId, name: `${TAG} Winner`, email: mail("winner"), status: "confirmed", seed: 1 },
  });
  await prisma.player.create({ data: { eventId, name: `${TAG} Entrant`, email: mail("entrant"), status: "confirmed", seed: 2 } });
  await prisma.player.create({ data: { eventId, name: `${TAG} Queue`, email: mail("queue"), status: "waitlisted", seed: 3 } });
  // Somebody playing a DIFFERENT tournament at the same club.
  await prisma.player.create({
    data: { eventId: otherEventId, name: `${TAG} Elsewhere`, email: mail("elsewhere"), status: "confirmed", seed: 1 },
  });

  await prisma.prize.createMany({
    data: [
      { eventId, position: 0, category: "Winner", amount: 50, winnerId: winner.id },
      { eventId, position: 1, category: "Nearest the pin", detail: "the 7th", amount: 15 },
    ],
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("the prize list a player sees", () => {
  it("is the whole list, in the committee's order, for somebody confirmed in the field", async () => {
    const list = await prizesForEntrant(eventId, mail("entrant"));
    expect(list.map((p) => [p.category, p.amount])).toEqual([
      ["Winner", 50],
      ["Nearest the pin", 15],
    ]);
    // Awarded prizes name the winner; the rest do not invent one.
    expect(list[0].winner).toBe(`${TAG} Winner`);
    expect(list[1].winner).toBeNull();
    expect(list[1].detail).toBe("the 7th");
  });

  it("matches the address however it is cased", async () => {
    expect(await prizesForEntrant(eventId, mail("entrant").toUpperCase())).toHaveLength(2);
  });

  it("is nothing for somebody only on the waitlist", async () => {
    expect(await prizesForEntrant(eventId, mail("queue"))).toEqual([]);
  });

  it("is nothing for somebody playing a different tournament at the same club", async () => {
    expect(await prizesForEntrant(eventId, mail("elsewhere"))).toEqual([]);
  });

  it("is nothing for a stranger, or for no address at all", async () => {
    expect(await prizesForEntrant(eventId, mail("nobody"))).toEqual([]);
    expect(await prizesForEntrant(eventId, "")).toEqual([]);
  });
});
