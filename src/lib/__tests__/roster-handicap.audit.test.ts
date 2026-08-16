import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertMember } from "@/lib/services/roster";

/**
 * A blank handicap box must not wipe the index the club already had.
 *
 * D7 of the 2026-08-12 audit. `cleanRegistration` returns `handicap: 0` with
 * `handicapSource: "none"` when somebody leaves the box empty — deliberately,
 * because an empty box is the absence of a claim and not a scratch handicap.
 * `upsertMember` then checked `Number.isFinite(0)`, which is true, and never
 * looked at the source. A member on the roster at 12.4 who registered for the
 * Saturday medal without retyping their index came back as a 0 — and 0 is the
 * one wrong value nobody queries, because it looks like a very good golfer
 * rather than like missing data.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-HCP";

let orgId = "";

async function cleanup() {
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const member = (who: string) =>
  prisma.member.findFirstOrThrow({ where: { organizationId: orgId, name: `${TAG} ${who}` } });

describe("a member already on the roster with an index", () => {
  it("keeps it when they register without entering one", async () => {
    await upsertMember(orgId, {
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 12.4,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("rita")).handicap).toBe(12.4);

    // The same person, registering again, blank box.
    await upsertMember(orgId, {
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "none",
    });
    expect((await member("rita")).handicap).toBe(12.4);
  });

  it("still accepts a new index they did enter", async () => {
    // The guard must not freeze the roster. The whole reason the latest entry
    // wins for this one field is that it is what the organizer just typed.
    await upsertMember(orgId, {
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 9.1,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("rita")).handicap).toBe(9.1);
  });

  it("accepts a genuine scratch handicap somebody typed", async () => {
    // 0 is a real handicap. Only 0-with-no-claim is not, so the check has to be
    // on the source and never on the value.
    await upsertMember(orgId, {
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "manual",
    });
    expect((await member("rita")).handicap).toBe(0);
  });

  it("keeps it when a CSV without a handicap column re-imports them", async () => {
    await upsertMember(orgId, {
      name: `${TAG} sam`,
      email: `${TAG}.sam@example.invalid`.toLowerCase(),
      handicap: 18.2,
      handicapType: "18",
      handicapSource: "manual",
    });
    // What the importer now sends for a missing or unreadable cell.
    await upsertMember(orgId, {
      name: `${TAG} sam`,
      email: `${TAG}.sam@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "none",
    });
    expect((await member("sam")).handicap).toBe(18.2);
  });
});

describe("a member who is new", () => {
  it("is created at 0 with the source recorded as none, not as scratch", async () => {
    // Nothing to protect here, so the row is written — but it has to say the
    // index is unknown, or the next blank registration looks like a real 0 and
    // the guard above has nothing to go on.
    await upsertMember(orgId, {
      name: `${TAG} new`,
      email: `${TAG}.new@example.invalid`.toLowerCase(),
      handicap: 0,
      handicapType: "18",
      handicapSource: "none",
    });
    const row = await member("new");
    expect(row.handicap).toBe(0);
    expect(row.handicapSource).toBe("none");
  });
});

describe("a caller that says nothing about the source", () => {
  it("is still trusted, so nothing that worked before stops working", async () => {
    // Older call sites pass a handicap and no source. Treating that as "no
    // claim" would be a bigger regression than the bug: it would stop every
    // one of them updating the roster at all.
    await upsertMember(orgId, {
      name: `${TAG} legacy`,
      email: `${TAG}.legacy@example.invalid`.toLowerCase(),
      handicap: 5,
      handicapType: "18",
    });
    await upsertMember(orgId, {
      name: `${TAG} legacy`,
      email: `${TAG}.legacy@example.invalid`.toLowerCase(),
      handicap: 7.3,
      handicapType: "18",
    });
    expect((await member("legacy")).handicap).toBe(7.3);
  });
});
