import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A push subscription belongs to the member who made it, and to no one else.
 *
 * The endpoint is a device's own URL, and the whole point of the table is to
 * reach a member on every device they turned alerts on. So the two things that
 * matter are: a save stamps the row with the CALLER's email (lowercased, the
 * identity a send looks up by), and a remove takes the CALLER's own row only
 * (the #1133 security review F-3; it was every row on the endpoint, SEC-2): the
 * browser's unsubscribe then stops the phone, and a 410 deletes anybody else's
 * row at the next send. Both presses are budgeted per person (`push-device`,
 * F-1). Against real rows, because both are decisions made from a session and a
 * column together.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PUSH";

type Session = { eventId: string; email: string; name: string; role: string; viewRole: string };
let session: Session | null = null;

// The rest of the module kept: since J39/J40 PR 2 the push actions ask the player viewer, which also
// reads the guest cookie (none here, outside a request) through `verify`.
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getSession: async () => session }));

const { savePushSubscription, removePushSubscription } = await import("@/app/actions/push");
const { clearRateLimit } = await import("@/lib/rate-limit");
const { pushDeviceBudgetKey } = await import("@/lib/services/push");
/** Each test starts with a full budget (the counters outlive a run); the budget test spends it on purpose. */
const freshBudget = (email: string) => clearRateLimit("push-device", pushDeviceBudgetKey({ email, guest: null }));

const E1 = `https://push.example.invalid/${TAG}-e1`;
const E2 = `https://push.example.invalid/${TAG}-e2`;
const ANN = `${TAG}.Ann@Example.Invalid`; // mixed case on purpose
const BEA = `${TAG}.bea@example.invalid`;

const sess = (email: string): Session => ({ eventId: "e", email, name: "Zz", role: "player", viewRole: "player" });
const rowFor = (endpoint: string) => prisma.pushSubscription.findUnique({ where: { endpoint } });

beforeEach(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: TAG } } });
  session = null;
  await freshBudget(ANN);
  await freshBudget(BEA);
});

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: TAG } } });
  await prisma.$disconnect();
});

describe("a member's push subscription", () => {
  it("stores the row under the caller's email, lowercased", async () => {
    session = sess(ANN);
    const res = await savePushSubscription({ endpoint: E1, keys: { p256dh: "key1", auth: "auth1" } });
    expect(res.ok).toBe(true);
    const row = await rowFor(E1);
    expect(row?.email).toBe(ANN.toLowerCase());
    expect(row?.p256dh).toBe("key1");
    expect(row?.auth).toBe("auth1");
  });

  it("upserts on the endpoint — the same device does not pile up rows", async () => {
    session = sess(ANN);
    await savePushSubscription({ endpoint: E1, keys: { p256dh: "key1", auth: "auth1" } });
    await savePushSubscription({ endpoint: E1, keys: { p256dh: "key2", auth: "auth2" } });
    const rows = await prisma.pushSubscription.findMany({ where: { endpoint: E1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("key2");
  });

  it("refuses a payload that isn't a subscription", async () => {
    session = sess(ANN);
    const res = await savePushSubscription({ endpoint: "", keys: { p256dh: "", auth: "" } });
    expect(res.ok).toBe(false);
    expect(await rowFor(E1)).toBeNull();
  });

  it("Turn off removes the caller's OWN row only: naming somebody else's endpoint deletes nothing (F-3)", async () => {
    // Ann's phone has alerts on; Bea, signed in elsewhere, names its endpoint.
    session = sess(ANN);
    await savePushSubscription({ endpoint: E1, keys: { p256dh: "key1", auth: "auth1" } });
    await savePushSubscription({ endpoint: E2, keys: { p256dh: "key1", auth: "auth1" } });
    session = sess(BEA);
    expect((await removePushSubscription(E1)).ok).toBe(true);
    expect(await rowFor(E1), "a viewer deleted somebody else's row by naming its endpoint").not.toBeNull();
    // Ann's own Turn off takes her row on that phone, and only that phone's.
    session = sess(ANN);
    expect((await removePushSubscription(E1)).ok).toBe(true);
    expect(await rowFor(E1)).toBeNull();
    expect(await rowFor(E2)).not.toBeNull();
  });

  it("saving and turning off are budgeted per person: the eleventh press in the window is refused (F-1)", async () => {
    session = sess(ANN);
    for (let i = 0; i < 10; i += 1) {
      const res = i % 2 === 0 ? await savePushSubscription({ endpoint: E1, keys: { p256dh: "k", auth: "a" } }) : await removePushSubscription(E1);
      expect(res.ok, `press ${i + 1} of 10 was refused`).toBe(true);
    }
    const refused = await savePushSubscription({ endpoint: E2, keys: { p256dh: "k", auth: "a" } });
    expect(refused.ok, "unlimited saves: one holder could file row after row").toBe(false);
    expect(refused.error).toMatch(/Too many alert changes/);
    expect(await rowFor(E2)).toBeNull();
    expect((await removePushSubscription(E1)).ok, "unlimited Turn offs").toBe(false);
    // Another person's budget is their own.
    session = sess(BEA);
    expect((await savePushSubscription({ endpoint: E2, keys: { p256dh: "k", auth: "a" } })).ok).toBe(true);
    await freshBudget(ANN);
  });

  it("refuses save and remove when nobody is signed in", async () => {
    session = null;
    expect((await savePushSubscription({ endpoint: E1, keys: { p256dh: "k", auth: "a" } })).ok).toBe(false);
    expect((await removePushSubscription(E1)).ok).toBe(false);
    expect(await rowFor(E1)).toBeNull();
  });
});
