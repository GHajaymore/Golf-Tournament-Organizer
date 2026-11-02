import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CHANGE OF KIND SAYS WHAT IT DOES TO MONEY, AND THE ACTION ENFORCES IT.
 *
 * Money is resolved at read time: the tournament's own mode, then the club's,
 * then the kind of outfit. So a society switched to "Golf club" moved every
 * tournament that had never chosen from "Split shared costs" to "Costs
 * handled outside the app" — the players' shared costs, the ledger and the
 * report's lines went with it, and nothing asked (found 2026-11-01).
 *
 * The picker asks now, but a `"use server"` export is called with whatever
 * the caller likes, so the cells below drive the real action against real
 * rows: refused without an answer and nothing written; "keep" pins the club's
 * own default and the tournaments resolve exactly as before; "switch anyway"
 * changes the kind and the tournaments follow it. A tournament with its own
 * mode is the control — it is never named and never moves.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-kindwarn";

const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: async () => {}, sendJoinRequestEmail: async () => {} }));

const { saveOrganizationKind } = await import("@/app/actions/organization");
const { resolveMoneyMode } = await import("@/lib/domain/money-mode");

const owner = { email: `${TAG}-owner@example.invalid`, name: `${TAG} Owner` };
const assistant = { email: `${TAG}-assistant@example.invalid`, name: `${TAG} Assistant` };

let orgId = "";
const ids: Record<string, string> = {};
/** Five that follow the club, so the question has to say "and 2 more". */
const FOLLOWERS = ["Spring Medal", "Summer Pairs", "Autumn Cup", "Winter Stableford", "Away Trip"];

async function scrub() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

const event = (name: string, moneyMode: string, n: number) =>
  prisma.event.create({
    data: {
      organizationId: orgId,
      // Distinct names: the development database holds a unique index on an
      // in-play tournament's name within a club.
      name: `${TAG} ${name}`,
      moneyMode,
      status: "registration", shape: "single", format: "stroke", formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: `${TAG}-share-${n}`,
      registrationToken: `${TAG}-reg-${n}`,
    },
  });

const org = () =>
  prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { kind: true, moneyMode: true } });

/** What each tournament resolves to right now, from the rows. */
async function modes(): Promise<Record<string, string>> {
  const o = await org();
  const events = await prisma.event.findMany({ where: { organizationId: orgId }, select: { id: true, moneyMode: true } });
  return Object.fromEntries(
    events.map((e) => [e.id, resolveMoneyMode({ eventMode: e.moneyMode, orgMode: o.moneyMode, orgKind: o.kind })]),
  );
}

beforeAll(async () => {
  try {
    await scrub();
    const user = await prisma.user.create({ data: { email: owner.email, name: owner.name, password: "x:unusable" } });
    const asst = await prisma.user.create({ data: { email: assistant.email, name: assistant.name, password: "x:unusable" } });
    orgId = (
      await prisma.organization.create({
        data: {
          name: `${TAG} Riverside Society`,
          kind: "community",
          members: { create: [{ userId: user.id, role: "owner" }, { userId: asst.id, role: "member" }] },
        },
      })
    ).id;
    let n = 0;
    for (const name of FOLLOWERS) ids[name] = (await event(name, "", ++n)).id;
    // The control: its own mode, so no change of kind can move it.
    ids.pinned = (await event("Captains Day", "float", ++n)).id;
  } catch (e) {
    await scrub();
    throw e;
  }
});

beforeEach(async () => {
  await prisma.organization.update({ where: { id: orgId }, data: { kind: "community", moneyMode: "" } });
  session.email = owner.email;
  session.name = owner.name;
  session.eventId = ids["Spring Medal"];
  session.role = "admin";
  session.viewRole = "admin";
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("switching a society to a golf club", () => {
  it("is refused without an answer, names the tournaments, and writes nothing", async () => {
    const before = await modes();
    const res = await saveOrganizationKind("club");

    expect(res.ok, "the kind changed and five tournaments' money moved without a word").toBe(false);
    expect(res.moneyChanges?.count).toBe(5);
    expect(res.moneyChanges?.names).toHaveLength(3);
    expect(res.error).toContain("and 2 more");
    expect(res.error).toContain("“Split shared costs” to “Costs handled outside the app”");
    expect(res.error).not.toContain("Captains Day");
    expect(await org()).toEqual({ kind: "community", moneyMode: "" });
    expect(await modes()).toEqual(before);
  });

  it("refuses an answer it does not know rather than reading it as yes", async () => {
    const res = await saveOrganizationKind("club", false, "yes please");
    expect(res.ok).toBe(false);
    expect((await org()).kind).toBe("community");
  });

  it("'keep' pins the club's own default, and every tournament resolves exactly as before", async () => {
    const before = await modes();
    expect(Object.values(before).filter((m) => m === "split")).toHaveLength(5);

    expect(await saveOrganizationKind("club", false, "keep")).toMatchObject({ ok: true });
    expect(await org()).toEqual({ kind: "club", moneyMode: "split" });
    expect(await modes()).toEqual(before);
  });

  it("'switch anyway' changes the kind and the tournaments follow it; the control does not", async () => {
    expect(await saveOrganizationKind("club", false, "switch")).toMatchObject({ ok: true });
    expect(await org()).toEqual({ kind: "club", moneyMode: "" });
    const after = await modes();
    for (const name of FOLLOWERS) expect(after[ids[name]], name).toBe("none");
    expect(after[ids.pinned]).toBe("float");
  });

  it("asks nothing when the club already chose its own default", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { moneyMode: "split" } });
    expect(await saveOrganizationKind("club")).toMatchObject({ ok: true });
    expect((await org()).kind).toBe("club");
  });

  it("asks nothing between a society and one person's golf, which split the same way", async () => {
    // No members on the roster, so the roster question does not fire either.
    expect(await saveOrganizationKind("personal")).toMatchObject({ ok: true });
    expect((await org()).kind).toBe("personal");
  });

  it("still refuses somebody who is not a Commissioner or Admin, whatever they answer", async () => {
    session.email = assistant.email;
    session.name = assistant.name;
    session.role = "player";
    session.viewRole = "player";
    const res = await saveOrganizationKind("club", false, "switch");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Commissioner or Admin/);
    expect(await org()).toEqual({ kind: "community", moneyMode: "" });
  });
});
