import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A FIELD SET ON A HIGHER TIER HOLDS THE LOWER TIER'S CAP (2026-09-30).
 *
 * A club moved down to Par from the owner console keeps the unlimited field
 * (capacity 0) it set on Eagle. `register`, `enter` and the roster add ask the
 * plan for its cap; three other paths and three screens read the stored 0:
 *
 *   - the public sign-up page said "Open for entries" to the eleventh person,
 *     who was then told the field was full (walked);
 *   - "Add someone new", the entry CSV import and approving a pending entry
 *     each CONFIRMED an eleventh player past Par's ten.
 *
 * Driven through the real actions and the real page view, with Eagle as the
 * control: the same stored 0 is genuinely unlimited there.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DOWNGRADE";

const auth = vi.hoisted(() => ({ session: null as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ getSession: async () => auth.session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

vi.mock("@/lib/owner", () => ({ isOwner: () => true }));

const { addSignup, importCsvSignups, approveSignup } = await import("@/app/actions/tournament");
const { setClubPlan } = await import("@/app/actions/owner");
const { readSource } = await import("./source");
const { openRegistrationView } = await import("@/lib/services/registration");

let orgId = "";
let eventId = "";
const TOKEN = `${TAG.toLowerCase()}-reg`;

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const setPlan = (plan: string) =>
  prisma.subscription.update({ where: { organizationId: orgId }, data: { plan } });

/** Ten confirmed, nobody else — the state every cell starts from. */
async function tenConfirmed() {
  await prisma.player.deleteMany({ where: { eventId } });
  for (let i = 1; i <= 10; i += 1) {
    await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} Entrant ${i}`,
        email: `zz-downgrade-${i}@example.invalid`,
        phone: `+1 202 555 01${50 + i}`,
        status: "confirmed",
        seed: i,
      },
    });
  }
}
const statusOf = async (email: string) =>
  (await prisma.player.findFirst({ where: { eventId, email }, select: { status: true } }))?.status;
const confirmed = () => prisma.player.count({ where: { eventId, status: "confirmed" } });

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} Society`, kind: "community", subscription: { create: { plan: "free", planTermsApply: true } } },
  });
  orgId = org.id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} Spring Stableford`,
        dates: "", course: "", city: "", address: "", regDeadline: "",
        status: "registration",
        capacity: 0, // unlimited, as it was set on Eagle
        shareToken: `${TAG.toLowerCase()}-share`,
        registrationToken: TOKEN,
        registrationOpen: true,
      },
    })
  ).id;
  auth.session = { eventId, role: "admin", viewRole: "admin", email: "zz-downgrade@example.invalid", name: `${TAG} Secretary` };
});

beforeEach(async () => {
  await setPlan("free");
  await tenConfirmed();
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a Par field keeps its cap when the stored capacity says unlimited", () => {
  it("the public page says waitlist, as the action will", async () => {
    const view = await openRegistrationView(TOKEN);
    expect(view, "the link should still be open — a full field waitlists").not.toBeNull();
    expect(view!.waitlistOnly).toBe(true);
    expect(view!.spotsLeft).toBe(0);
  });

  it("'Add someone new' waitlists the eleventh", async () => {
    const r = await addSignup({ name: `${TAG} Eleventh`, handicap: 12, email: "zz-downgrade-11@example.invalid", phone: "+1 202 555 0171" });
    expect(r.ok).toBe(true);
    expect(await statusOf("zz-downgrade-11@example.invalid")).toBe("waitlisted");
    expect(await confirmed()).toBe(10);
  });

  it("the entry CSV import waitlists every row past ten", async () => {
    const r = await importCsvSignups(
      "name,email,phone,handicap\n" +
        `${TAG} Twelfth,zz-downgrade-12@example.invalid,+1 202 555 0172,10\n` +
        `${TAG} Thirteenth,zz-downgrade-13@example.invalid,+1 202 555 0173,20\n`,
    );
    expect(r.imported).toBe(2);
    expect(await confirmed()).toBe(10);
  });

  it("approving a pending entry waitlists it", async () => {
    const pending = await prisma.player.create({
      data: { eventId, name: `${TAG} Pending`, email: "zz-downgrade-14@example.invalid", phone: "+1 202 555 0174", status: "pending", seed: 14 },
    });
    expect((await approveSignup(pending.id)).ok).toBe(true);
    expect(await statusOf("zz-downgrade-14@example.invalid")).toBe("waitlisted");
  });

  it("CONTROL: on Eagle the same stored 0 is unlimited, and the eleventh is confirmed", async () => {
    await setPlan("club");
    expect((await openRegistrationView(TOKEN))!.waitlistOnly).toBe(false);
    await addSignup({ name: `${TAG} Eleventh`, handicap: 12, email: "zz-downgrade-11@example.invalid", phone: "+1 202 555 0171" });
    expect(await statusOf("zz-downgrade-11@example.invalid")).toBe("confirmed");
  });
});

/**
 * AND THE OTHER DIRECTION: A FIELD MADE ON PAR IS NOT KEPT AT PAR'S CAP
 * (2026-10-09). A secretary created the club championship on Par, the owner
 * moved the club to Eagle, and the import of 120 members confirmed 10 and
 * waitlisted 110 — the tournament had STORED Par's ten as its own capacity.
 * The cap is now applied where capacity is read, never written into it.
 */
describe("a Par field moved up a tier", () => {
  it("lets the waiting list in when the owner moves the club to Eagle", async () => {
    await importCsvSignups(
      "name,email,phone,handicap\n" +
        `${TAG} Twelfth,zz-downgrade-12@example.invalid,+1 202 555 0172,10\n` +
        `${TAG} Thirteenth,zz-downgrade-13@example.invalid,+1 202 555 0173,20\n`,
    );
    expect(await confirmed(), "Par holds ten").toBe(10);
    const r = await setClubPlan(`${TAG} Society`, "club");
    expect(r.ok).toBe(true);
    expect(await confirmed(), "Eagle has no cap, so both who waited are in").toBe(12);
    expect(await statusOf("zz-downgrade-12@example.invalid")).toBe("confirmed");
  });

  it("CONTROL: a field the organizer chose to keep small stays small", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { capacity: 10 } });
    try {
      await importCsvSignups(`name,email,phone,handicap\n${TAG} Twelfth,zz-downgrade-12@example.invalid,+1 202 555 0172,10\n`);
      await setClubPlan(`${TAG} Society`, "club");
      expect(await confirmed()).toBe(10);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { capacity: 0 } });
    }
  });

  it("is never written into a tournament's own capacity", () => {
    const src = readSource("src/app/actions/tournament.ts");
    // Created open; saved and copied as the organizer set it.
    expect(src).toMatch(/capacity: 0,\s*status: "draft"/);
    expect(src).not.toMatch(/capacityUnderCap\(/);
    expect(src).toMatch(/capacity: data\.capacity <= 0 \? 0 : Math\.max\(1, Math\.round\(data\.capacity\)\)/);
  });
});
