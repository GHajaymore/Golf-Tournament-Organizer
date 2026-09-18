import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { staffSeatCount } from "@/lib/services/limits";
import { readSource } from "./source";

/**
 * THE CLUB SETTINGS SCREEN SHOWS THE NUMBER THAT CAN REFUSE SOMEBODY.
 *
 * It showed two. The Staff card counted rows in `OrganizationMember`; the plan
 * panel a few hundred lines below counted a SEAT — anybody with organizer or
 * assistant rights anywhere in the club, deduplicated by email. `limits.ts`
 * explains why a seat has to be the wider thing, and the sentence is the whole
 * argument: club membership alone "would have made the limit meaningless …
 * anyone could add unlimited staff by granting them on each event instead".
 *
 * So a club whose organizers were named on events rather than on the club read
 * **Staff 0** while its allowance counted them. On the free plan, which
 * includes one seat, that club is refused the next person it adds while its own
 * settings page says it has none — and the refusal names a limit the screen has
 * just told them they are nowhere near.
 *
 * The TOURNAMENTS number beside it had exactly this bug and was already fixed;
 * the comment on that `_count` ends "disagreed about the same number, on the
 * same screen". This is the other half.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STAFFNUM";

let orgId = "";

async function cleanup() {
  await prisma.account.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} society`, kind: "society" },
    select: { id: true },
  });
  orgId = org.id;

  // A club whose people are named on TOURNAMENTS, never on the club. This is
  // the ordinary shape for a society that has simply never opened the staff
  // table — and it is the shape the old card read as empty.
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} saturday medal`,
      status: "registration",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });

  await prisma.account.createMany({
    data: [
      { eventId: event.id, name: `${TAG} organizer`, email: `${TAG}.org@example.invalid`.toLowerCase(), role: "admin" },
      { eventId: event.id, name: `${TAG} helper`, email: `${TAG}.helper@example.invalid`.toLowerCase(), role: "assistant" },
      // A player, who must never count — that constraint is the whole point of
      // the pricing, and counting them here would quietly undo it.
      { eventId: event.id, name: `${TAG} player`, email: `${TAG}.player@example.invalid`.toLowerCase(), role: "player" },
    ],
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("what the club settings Staff card counts", () => {
  it("counts the two people who hold rights, and not the player", async () => {
    expect(await staffSeatCount(orgId)).toBe(2);
  });

  it("is a number the old source could not have produced", async () => {
    /**
     * The reason this file exists, stated as a measurement rather than as
     * prose: `OrganizationMember` is EMPTY for this club, so the card's old
     * source reads zero while two people hold organizer rights. Without this
     * cell the one above would pass just as happily against the wrong source
     * on a club that happened to have matching rows.
     */
    const rows = await prisma.organizationMember.count({ where: { organizationId: orgId } });
    expect(rows, "the fixture stopped being the interesting case").toBe(0);
    expect(await staffSeatCount(orgId)).toBeGreaterThan(rows);
  });
});

describe("the club settings screen reads it from one place", () => {
  const page = readSource("src", "app", "(app)", "organization", "page.tsx");

  it("feeds the Staff card from the allowance, not from a row count", () => {
    expect(page, "the page no longer resolves the club's standing").toContain("limitStatus(org.id)");
    expect(page).toContain("memberCount={standing.staffSeats.current}");
    expect(
      page.includes("memberCount={org._count.members}"),
      "the Staff card is back on OrganizationMember rows, which is not what the limit counts",
    ).toBe(false);
  });

  it("resolves that standing once, so the two numbers cannot drift apart", () => {
    // Two calls would be two truths the moment one of them moved — the card
    // and the plan panel are the same fact rendered twice.
    const calls = page.split("limitStatus(").length - 1;
    expect(calls, "limitStatus is resolved more than once on this screen").toBe(1);
  });
});
