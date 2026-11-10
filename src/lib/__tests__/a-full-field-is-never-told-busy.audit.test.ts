import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { registerForEvent } from "@/app/actions/register";
import { entryLinkBudgetFor } from "@/lib/services/registration";
import { RATE_LIMITS, entryLinkBudget } from "@/lib/domain/rate-limit";
import { fieldCapFor } from "@/lib/services/limits";

/**
 * A FULL FIELD ENTERING AT THE MINUTE ENTRIES OPEN IS NEVER TOLD "BUSY"
 * (2026-11-10).
 *
 * Round G583-1, scenario A: a Birdie club's 64-player field, its members
 * entering through the shared link one after another. Members 61 to 72 were
 * told "This entry form is very busy just now. Wait 6 minutes and try again."
 * — the link's flood cap was a fixed sixty, whatever the field. Security and
 * the Tournament Director ruled it a product limit: while places remain (and a
 * waiting list behind them), nobody is turned away by the flood cap.
 *
 * Driven through the real public action, on a throwaway club on Birdie's
 * published terms: the plan's cap is read from the plan, the field fills to it,
 * and everyone past it waits. Reverting the budget (a fixed sixty) turns the
 * 61st away here exactly as it did in the round.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-entry-link-budget";
/** Fresh every run: the limiter lives in Postgres and outlives this file's rows. */
const RUN = randomBytes(4).toString("hex");
/** The club's field cap, asked of the club (its plan, and any owner override) —
 *  never typed here. */
let CAP = 0;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

const form = (i: number) => ({
  name: `${TAG} Member ${i} ${RUN}`,
  email: `${TAG}-${i}-${RUN}@example.invalid`,
  handicap: "12",
  handicapType: "18",
  phone: "15551234567",
  preferredTee: "",
});

let orgId = "";
let token = "";
let eventId = "";

async function tournament(name: string, open: boolean, capacity: number) {
  const t = randomBytes(8).toString("hex");
  const ev = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} Course`,
      city: `${TAG} Town`,
      address: "",
      regDeadline: "",
      capacity,
      registrationOpen: open,
      registrationApproval: "auto",
      registrationToken: t,
      shareToken: randomBytes(10).toString("hex"),
    },
    select: { id: true },
  });
  return { id: ev.id, token: t };
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Society`,
      kind: "community",
      // Birdie on the published terms, so the plan's cap is enforced.
      subscription: { create: { plan: "society", planTermsApply: true } },
    },
    select: { id: true },
  });
  orgId = org.id;
  CAP = (await fieldCapFor(orgId)) ?? 0;
  // Capacity 0: the organizer set no number, so the plan's cap is the field.
  ({ id: eventId, token } = await tournament("Saturday Stableford", true, 0));
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("an entry link's budget is what its field can take", () => {
  it("a Birdie link is budgeted on the club's field cap", async () => {
    expect(CAP, "the fixture's plan has a cap above the old fixed sixty").toBeGreaterThan(60);
    expect(await entryLinkBudgetFor(token)).toBe(entryLinkBudget({ live: true, fieldLimit: CAP }));
  });

  it("a smaller field the organizer typed is budgeted on its own number", async () => {
    const small = await tournament("Twilight", true, 40);
    expect(await entryLinkBudgetFor(small.token)).toBe(entryLinkBudget({ live: true, fieldLimit: 40 }));
  });

  it("an unknown token and a closed link both get only the floor", async () => {
    const closed = await tournament("Closed", false, 0);
    const floor = RATE_LIMITS["register-token"].limit;
    expect(await entryLinkBudgetFor(closed.token)).toBe(floor);
    expect(await entryLinkBudgetFor(`${TAG}-no-such-link-${RUN}`)).toBe(floor);
    expect(await entryLinkBudgetFor("")).toBe(floor);
  });

  it(`takes the plan's cap and eight more in one burst: the field fills, the rest wait`, async () => {
    const refusals: string[] = [];
    for (let i = 1; i <= CAP + 8; i += 1) {
      const r = await registerForEvent(token, form(i));
      if (!r.ok) refusals.push(`sign-up ${i}: ${r.error}`);
    }
    expect(refusals, "nobody is turned away while places and the waiting list remain").toEqual([]);
    const by = await prisma.player.groupBy({ by: ["status"], where: { eventId }, _count: true });
    const count = (s: string) => by.find((b) => b.status === s)?._count ?? 0;
    expect(count("confirmed"), `the field holds the plan's cap of ${CAP}`).toBe(CAP);
    expect(count("waitlisted"), "everyone past the cap waits").toBe(8);
  }, 180_000);
});
