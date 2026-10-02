import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CLUB THAT STOPS PAYING KEEPS ITS HISTORY FOR 30 DAYS (Ajay, 2026-10-02:
 * "keep history for 30 days").
 *
 * When Stripe says a subscription has ended, the club returns to Par — and
 * Par's terms delete tournaments. So every tournament the club has is held for
 * 30 days from the day the plan ENDED, and only then do the terms apply.
 *
 * Against real rows and the real sweep, because the failure here is a
 * former customer's results gone. Each assertion has its partner: held DURING
 * the window, gone AFTER it; and a longer hold somebody set by hand is never
 * shortened.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LAPSED";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { applySubscriptionWrite } = await import("@/lib/services/billing");
const { subscriptionWrite, RETAIN_AFTER_CANCEL_DAYS } = await import("@/lib/domain/billing");
const { sweepClosedPar } = await import("@/lib/services/par-sweep");

const DAY = 24 * 3600 * 1000;
const NOW = new Date();
const emailFor = (who: string) => `zz-audit-lapsed-${who}@example.invalid`;
const WHO = ["lapsed", "paying"];

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { in: WHO.map(emailFor) } } });
}

/** A club on a PAID plan through Stripe, as if it had checked out. */
async function payingClub(who: string) {
  const user = await prisma.user.create({ data: { email: emailFor(who), name: `${TAG} ${who}` } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} ${who}`,
      kind: "community",
      subscription: {
        create: { plan: "club", status: "active", provider: "stripe", providerCustomerId: `cus_${who}`, providerSubscriptionId: `sub_${who}`, planTermsApply: false },
      },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  return org.id;
}

/** A tournament whose Par clock has ALREADY run out — the sweep would take it today. */
async function dueTournament(orgId: string, name: string, retainUntil: Date | null = null) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      status: "live",
      shape: "series",
      shareToken: `${TAG}-${name}-${Date.now()}`.replace(/\s+/g, "-"),
      closesAt: new Date(NOW.getTime() - DAY),
      retainUntil,
    },
  });
}

const exists = async (id: string) => (await prisma.event.count({ where: { id } })) === 1;

/** What the webhook writes when Stripe says this club's subscription ended now. */
const ended = (orgId: string, who: string) =>
  subscriptionWrite({
    id: `sub_${who}`,
    status: "canceled",
    customer: `cus_${who}`,
    metadata: { organizationId: orgId, plan: "club" },
    ended_at: Math.floor(NOW.getTime() / 1000),
  })!;

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("a club whose paid plan ends", () => {
  it("is held for 30 days, then the Par terms apply", async () => {
    const org = await payingClub("lapsed");
    const plain = await dueTournament(org, "plain");
    const handHeld = await dueTournament(org, "hand-held", new Date(NOW.getTime() + 90 * DAY));

    await applySubscriptionWrite(ended(org, "lapsed"));

    const sub = await prisma.subscription.findUnique({ where: { organizationId: org } });
    expect(sub).toMatchObject({ plan: "free", status: "canceled", planTermsApply: true });

    // Every tournament is held to 30 days from the end — and a longer hold set by hand stands.
    const held = await prisma.event.findUnique({ where: { id: plain.id } });
    expect(held?.retainUntil?.getTime()).toBe(Math.floor(NOW.getTime() / 1000) * 1000 + RETAIN_AFTER_CANCEL_DAYS * DAY);
    const kept = await prisma.event.findUnique({ where: { id: handHeld.id } });
    expect(kept?.retainUntil?.getTime()).toBe(handHeld.retainUntil!.getTime());

    // During the window: the sweep that would take a Par tournament today takes neither.
    await sweepClosedPar(new Date(NOW.getTime() + 29 * DAY));
    expect(await exists(plain.id)).toBe(true);
    expect(await exists(handHeld.id)).toBe(true);

    // After it: the Par terms apply like any Par club's — and the hand-set hold still runs.
    await sweepClosedPar(new Date(NOW.getTime() + 31 * DAY));
    expect(await exists(plain.id)).toBe(false);
    expect(await exists(handHeld.id)).toBe(true);
  });

  it("CONTROL: a club still paying is never touched by the sweep, held or not", async () => {
    const org = await payingClub("paying");
    const t = await dueTournament(org, "paying");
    await sweepClosedPar(new Date(NOW.getTime() + 365 * DAY));
    expect(await exists(t.id)).toBe(true);
  });
});
