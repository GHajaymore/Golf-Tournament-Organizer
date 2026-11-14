import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A push subscription belongs to the member who made it, and to no one else.
 *
 * The endpoint is a device's own URL, and the whole point of the table is to
 * reach a member on every device they turned alerts on. So the two things that
 * matter are: a save stamps the row with the CALLER's email (lowercased, the
 * identity a send looks up by), and a remove is about the PHONE (#1133 review,
 * SEC-2): Turn off clears every row on that endpoint, a previous holder's
 * included, and no other endpoint. (A remove scoped to the caller never stopped
 * somebody who held the endpoint anyway: a save by endpoint takes the row over.)
 * Against real rows, because both are decisions made from a session and a
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

const E1 = `https://push.example.invalid/${TAG}-e1`;
const E2 = `https://push.example.invalid/${TAG}-e2`;
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

  it("Turn off silences THIS PHONE: the previous holder's row on its endpoint goes too (#1133 review, SEC-2)", async () => {
    // Ann turned alerts on and handed the phone on without turning them off; Bea now uses it.
    session = sess(ANN);
    await savePushSubscription({ endpoint: E1, keys: { p256dh: "key1", auth: "auth1" } });
    await savePushSubscription({ endpoint: E2, keys: { p256dh: "key1", auth: "auth1" } });
    session = sess(BEA);
    expect((await removePushSubscription(E1)).ok).toBe(true);
    expect(await rowFor(E1), "a handed-on phone kept buzzing with the previous holder's notices").toBeNull();
    // Only that endpoint: Ann's other phone is untouched.
    expect(await rowFor(E2)).not.toBeNull();
  });

  it("refuses save and remove when nobody is signed in", async () => {
    session = null;
    expect((await savePushSubscription({ endpoint: E1, keys: { p256dh: "k", auth: "a" } })).ok).toBe(false);
    expect((await removePushSubscription(E1)).ok).toBe(false);
    expect(await rowFor(E1)).toBeNull();
  });
});
