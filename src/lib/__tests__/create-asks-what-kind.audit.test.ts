import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE CREATE FORM ASKS WHAT KIND OF OUTFIT IS RUNNING IT (Ajay, 2026-09-28,
 * left to my recommendation).
 *
 * It filed every organizer as an outing: the name typed into "Who's running
 * this?" landed on a `personal` organization, so a newcomer who typed
 * "Riverside Golf Society" was told "Name your outing". The kind is taken on
 * exactly the terms the name is — only while the organization is still
 * unnamed — and never so as to hide a members list.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-KIND";
let n = 0;
const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createEvent } = await import("@/app/actions/tournament");

/** A fresh organizer, signed in, with nothing yet. */
function newcomer() {
  n += 1;
  session.email = `zz-audit-kind-${n}-${Date.now()}@example.invalid`;
  session.name = `${TAG} Person ${n}`;
  return session.email;
}
const orgOf = async (email: string) =>
  (await prisma.organizationMember.findFirst({ where: { user: { email } }, include: { organization: true } }))!
    .organization;

async function scrub() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "zz-audit-kind-" } }, select: { id: true } });
  const orgs = await prisma.organizationMember.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { organizationId: true } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.organizationId) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("what kind of outfit runs it", () => {
  it("a newcomer naming 'X Golf Society' as a society is filed as one — and asked for members first", async () => {
    const email = newcomer();
    const r = await createEvent(`${TAG} spring`, "custom", "single", `${TAG} Riverside Golf Society`, undefined, true, "community");
    const org = await orgOf(email);
    expect(org.name).toBe(`${TAG} Riverside Golf Society`);
    expect(org.kind).toBe("community");
    // The club-first rule: a society adds its members before its first
    // tournament, and says which answer it is waiting for.
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Finish setting up your society first/);
  });

  it("CONTROL: a company or one-off day goes straight through", async () => {
    const email = newcomer();
    const r = await createEvent(`${TAG} day`, "custom", "single", `${TAG} Acme Charity Day`, undefined, true, "personal");
    expect(r.error ?? "").toBe("");
    expect((await orgOf(email)).kind).toBe("personal");
  });

  it("an organizer whose outfit is still unnamed gets the name AND the kind", async () => {
    const email = newcomer();
    await createEvent(`${TAG} first`, "custom", "single"); // created under their own name, personal
    expect((await orgOf(email)).kind).toBe("personal");
    await createEvent(`${TAG} second`, "custom", "single", `${TAG} Cedar Dunes Golf Club`, undefined, true, "club");
    const org = await orgOf(email);
    expect(org.name).toBe(`${TAG} Cedar Dunes Golf Club`);
    expect(org.kind).toBe("club");
  });

  it("CONTROL: a named outfit is never renamed or re-kinded from this form", async () => {
    const email = newcomer();
    await createEvent(`${TAG} a`, "custom", "single", `${TAG} Heathland Society`, undefined, true, "community");
    await createEvent(`${TAG} b`, "custom", "single", `${TAG} Something Else`, undefined, true, "club");
    const org = await orgOf(email);
    expect(org.name).toBe(`${TAG} Heathland Society`);
    expect(org.kind).toBe("community");
  });

  it("CONTROL: a kind without a name changes nothing", async () => {
    const email = newcomer();
    await createEvent(`${TAG} c`, "custom", "single", "", undefined, true, "club");
    expect((await orgOf(email)).kind).toBe("personal");
  });
});
