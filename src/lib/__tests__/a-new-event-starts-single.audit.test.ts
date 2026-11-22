import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A NEW EVENT STARTS AS ONE BRACKET, AND A COPY KEEPS THE SOURCE'S (redesign 2.4).
 *
 * The column default of `Event.bracketMode` is the legacy "split". What a new
 * event starts with is `newEventDefaults()`, and every create spreads it:
 * a tournament, a casual round and a copy (which lets the source's own mode
 * win). This is proved against real rows rather than assumed from the code.
 *
 *   npx vitest run --config vitest.audit.config.ts a-new-event-starts-single
 */

const prisma = new PrismaClient();
const MARK = "zz-newdefaults";
const at = (who: string) => `${MARK}-${who}@example.invalid`;

let session: { email: string; name: string; eventId: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { createMatch } = await import("@/app/actions/match-setup");
const { createEvent, cloneEvent } = await import("@/app/actions/tournament");

const ids = { org: "", user: "", source: "" };

async function scrub() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.event.deleteMany({ where: { name: { contains: MARK } } });
  await prisma.event.deleteMany({ where: { organization: { name: { startsWith: MARK } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: at("sec"), name: `${MARK} sec`, emailVerifiedAt: new Date() } });
  ids.user = user.id;
  const org = await prisma.organization.create({ data: { name: `${MARK} club`, kind: "club" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "society", planTermsApply: false } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  session = { email: at("sec"), name: `${MARK} sec`, eventId: "", role: "admin" };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("what a new event starts with", () => {
  it("a new tournament starts as one bracket", async () => {
    const name = `${MARK} Match Play Championship`;
    const res = await createEvent(name, undefined, "single", undefined, ids.org);
    expect(res.ok, res.error).toBe(true);
    const made = await prisma.event.findFirstOrThrow({ where: { organizationId: ids.org, name } });
    expect(made.bracketMode).toBe("single");
  });

  it("a casual round starts as one bracket (no knockout is reachable from it either way)", async () => {
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${MARK} sec`, handicap: "10", memberId: "" },
        { name: `${MARK} Guest`, handicap: "12", memberId: "" },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);
    const made = await prisma.event.findUniqueOrThrow({ where: { id: res.eventId! } });
    expect(made.bracketMode).toBe("single");
  });

  it("a copy carries the source's own mode, not the new default", async () => {
    const source = await prisma.event.create({
      data: {
        organizationId: ids.org,
        name: `${MARK} Plate Source`,
        status: "completed",
        shape: "single",
        format: "stroke",
        bracketMode: "plate",
        startOn: "2026-06-13",
        endOn: "2026-06-13",
        dates: "13 Jun 2026",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${MARK}-share-${process.pid}`,
      },
    });
    ids.source = source.id;
    session = { email: at("sec"), name: `${MARK} sec`, eventId: source.id, role: "admin" };
    const copyName = `${MARK} Plate Copy`;
    const res = await cloneEvent(source.id, copyName, { startOn: "2099-06-13" });
    expect(res.ok, res.error).toBe(true);
    const copy = await prisma.event.findFirstOrThrow({ where: { organizationId: ids.org, name: copyName } });
    expect(copy.bracketMode).toBe("plate");
  });
});
