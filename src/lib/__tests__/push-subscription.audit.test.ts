import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A push subscription belongs to the member who made it, and to no one else.
 *
 * The endpoint is a device's own URL, and the whole point of the table is to
 * reach a member on every device they turned alerts on. So the two things that
 * matter are: a save stamps the row with the CALLER's email (lowercased, the
 * identity a send looks up by), and a remove is SCOPED to the caller — a leaked
 * endpoint must not let one member silence another's phone. Against real rows,
 * because both are decisions made from a session and a column together.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PUSH";

type Session = { eventId: string; email: string; name: string; role: string; viewRole: string };
let session: Session | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { savePushSubscription, removePushSubscription } = await import("@/app/actions/push");

const E1 = `https://push.example.invalid/${TAG}-e1`;
const ANN = `${TAG}.Ann@Example.Invalid`; // mixed case on purpose
const BEA = `${TAG}.bea@example.invalid`;

const sess = (email: string): Session => ({ eventId: "e", email, name: "Zz", role: "player", viewRole: "player" });
const rowFor = (endpoint: string) => prisma.pushSubscription.findUnique({ where: { endpoint } });

beforeEach(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: TAG } } });
  session = null;
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

  it("lets another member's remove do NOTHING to it", async () => {
    session = sess(ANN);
    await savePushSubscription({ endpoint: E1, keys: { p256dh: "key1", auth: "auth1" } });

    // Bea, a different member, tries to remove Ann's device by its endpoint.
    session = sess(BEA);
    const res = await removePushSubscription(E1);
    expect(res.ok).toBe(true); // it succeeds, but scoped to Bea — so it matches nothing
    expect(await rowFor(E1)).not.toBeNull();

    // Ann removes her own, and it goes.
    session = sess(ANN);
    await removePushSubscription(E1);
    expect(await rowFor(E1)).toBeNull();
  });

  it("refuses save and remove when nobody is signed in", async () => {
    session = null;
    expect((await savePushSubscription({ endpoint: E1, keys: { p256dh: "k", auth: "a" } })).ok).toBe(false);
    expect((await removePushSubscription(E1)).ok).toBe(false);
    expect(await rowFor(E1)).toBeNull();
  });
});
