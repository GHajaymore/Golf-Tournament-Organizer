import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ONE NAME IN PLAY PER CLUB, AT EVERY DOOR (Ajay, 2026-11-01: "year may not solve. what if they
 * run same tournament twice a year?").
 *
 * Against real rows, as the secretary would press them: create, rename, copy and reopen each
 * refuse a name another of the club's tournaments still in play is using, in words that name it
 * and offer a free one; a completed tournament may share a name; another club's never counts;
 * and the database's own backstop (migration A036), hit by a write that skipped the check, is
 * turned into the same words rather than a 500.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-onename";
const EMAIL = `${TAG}.sec@example.invalid`;
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createEvent, cloneEvent, saveEvent, setEventStatus } = await import("@/app/actions/tournament");
const { withNameBackstop, isNameInPlayViolation } = await import("@/lib/services/tournament-name");

let orgId = "";
let otherOrgId = "";
let seq = 0;

async function scrub() {
  await prisma.event.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organizationMember.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

/** A tournament of the club at `status`, with the secretary as its organizer. */
async function tournament(name: string, status: string, org = orgId) {
  seq += 1;
  const event = await prisma.event.create({
    data: {
      organizationId: org, name, status, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${process.pid}-${seq}`, configUnlocked: true, shape: "single",
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: session.name, role: "admin" } });
  return event;
}

const details = (name: string) => ({
  name, dates: "", format: "stroke", course: "", courseId: "", city: "", address: "", regDeadline: "",
  capacity: 0, playerCountMode: "registration", courseMode: "fixed",
});
const count = (name: string) => prisma.event.count({ where: { organizationId: orgId, name } });

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: EMAIL, name: session.name, password: "x", emailVerifiedAt: new Date() } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: "Europe/London" } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club" } })).id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "owner" } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("create", () => {
  it("refuses a name another tournament in play holds, whatever its case and spaces, naming it and offering a free one", async () => {
    const held = await tournament(`${TAG} Spring Medal`, "draft");
    session.eventId = held.id;
    const res = await createEvent(`  ${TAG.toUpperCase()}   SPRING medal `, undefined, "single", undefined, orgId, true);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain(`“${TAG} Spring Medal” (setting up)`);
    expect(res.error ?? "").toMatch(/is free/);
    expect(await prisma.event.count({ where: { organizationId: orgId, name: { contains: "SPRING", mode: "insensitive" } } })).toBe(1);
  });

  it("CONTROL: lets a name only a completed tournament, or another club, uses", async () => {
    await tournament(`${TAG} Autumn Cup`, "completed");
    await tournament(`${TAG} Autumn Cup`, "completed");
    await tournament(`${TAG} Autumn Cup`, "live", otherOrgId);
    expect(await createEvent(`${TAG} Autumn Cup`, undefined, "single", undefined, orgId, true)).toMatchObject({ ok: true });
    expect(await count(`${TAG} Autumn Cup`)).toBe(3);
  });

  it("names an empty box with a free placeholder rather than refusing its own choice", async () => {
    await tournament("New Tournament", "draft");
    expect(await createEvent("", undefined, "single", undefined, orgId, true)).toMatchObject({ ok: true });
    const made = await prisma.event.findMany({ where: { organizationId: orgId, name: { startsWith: "New Tournament" } }, select: { name: true } });
    expect(made.map((m) => m.name).sort()).toEqual(["New Tournament", `New Tournament ${new Date().getUTCFullYear()}`].sort());
  });
});

describe("rename", () => {
  it("refuses renaming one in play to a name another in play holds, and changes nothing", async () => {
    await tournament(`${TAG} Club Championship`, "live");
    const mine = await tournament(`${TAG} Seniors`, "draft");
    session.eventId = mine.id;
    const res = await saveEvent(details(`${TAG} club championship`));
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain(`“${TAG} Club Championship” (live)`);
    expect((await prisma.event.findUnique({ where: { id: mine.id } }))?.name).toBe(`${TAG} Seniors`);
  });

  it("CONTROL: keeping its own name, and renaming a completed one to a held name, are both allowed", async () => {
    const mine = await tournament(`${TAG} Juniors`, "draft");
    session.eventId = mine.id;
    expect(await saveEvent(details(`${TAG} Juniors`))).toMatchObject({ ok: true });
    const old = await tournament(`${TAG} Juniors 2025`, "completed");
    session.eventId = old.id;
    expect(await saveEvent(details(`${TAG} Juniors`))).toMatchObject({ ok: true });
  });
});

describe("copy", () => {
  it("refuses copying last year's medal under the name this year's already holds", async () => {
    const last = await tournament(`${TAG} Monthly Medal`, "completed");
    await tournament(`${TAG} Monthly Medal`, "draft");
    session.eventId = last.id;
    const res = await cloneEvent(last.id, `${TAG} Monthly Medal`);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain(`“${TAG} Monthly Medal” (setting up)`);
    expect(await count(`${TAG} Monthly Medal`)).toBe(2);
  });

  it("CONTROL: copies it under a free name, and an empty box gets a free one", async () => {
    const last = await tournament(`${TAG} Pairs`, "completed");
    await tournament(`${TAG} Pairs (copy)`, "draft");
    expect(await cloneEvent(last.id, `${TAG} Pairs 2026`)).toMatchObject({ ok: true });
    expect(await cloneEvent(last.id, "")).toMatchObject({ ok: true });
    const names = (await prisma.event.findMany({ where: { organizationId: orgId, name: { startsWith: `${TAG} Pairs` } }, select: { name: true } })).map((e) => e.name);
    expect(names.sort()).toEqual(
      [`${TAG} Pairs`, `${TAG} Pairs (copy)`, `${TAG} Pairs 2026`, `${TAG} Pairs (copy) ${new Date().getUTCFullYear()}`].sort(),
    );
  });
});

describe("a name past the bound", () => {
  it("is refused on create and on copy, as on a rename, and nothing is made", async () => {
    const long = `${TAG} ${"x".repeat(200)}`;
    const made = await createEvent(long, undefined, "single", undefined, orgId, true);
    expect(made).toMatchObject({ ok: false });
    expect((made as { error?: string }).error ?? "").toContain("characters");
    const last = await tournament(`${TAG} Long Source`, "completed");
    session.eventId = last.id;
    const copied = await cloneEvent(last.id, long);
    expect(copied.ok).toBe(false);
    expect(copied.error ?? "").toContain("characters");
    expect(await count(long)).toBe(0);
  });
});

describe("reopen", () => {
  it("refuses reopening a completed one while another in play holds its name", async () => {
    const old = await tournament(`${TAG} Foursomes`, "completed");
    await tournament(`${TAG} FOURSOMES`, "live");
    session.eventId = old.id;
    const res = await setEventStatus("live");
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toMatch(/can’t be reopened under its name/);
    expect(res.error ?? "").toContain(`“${TAG} FOURSOMES” (live)`);
    expect((await prisma.event.findUnique({ where: { id: old.id } }))?.status).toBe("completed");
  });

  it("CONTROL: reopens it when the name is free", async () => {
    const old = await tournament(`${TAG} Greensomes`, "completed");
    await tournament(`${TAG} Greensomes`, "completed");
    session.eventId = old.id;
    expect(await setEventStatus("live")).toEqual({ ok: true });
  });
});

describe("the database's backstop", () => {
  it("refuses a second in-play row of one name that skipped the check, and the refusal is the same words", async () => {
    const held = await tournament(`${TAG} Stableford`, "live");
    const raced = await withNameBackstop(
      () => tournament(`${TAG}  stableford `, "draft"),
      { organizationId: orgId, name: `${TAG} Stableford`, selfId: null, door: "create" },
    );
    expect(raced.ok).toBe(false);
    if (!raced.ok) expect(raced.error).toContain(`“${held.name}” (live)`);
  });

  it("CONTROL: the index is there, and leaves a completed twin and a casual round alone", async () => {
    const idx = await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int n from pg_indexes where indexname = 'Event_name_in_play_key'`);
    expect(idx[0].n, "migration A036 made no index on this database").toBe(1);
    await tournament(`${TAG} Texas Scramble`, "live");
    await expect(tournament(`${TAG} Texas Scramble`, "completed")).resolves.toBeTruthy();
    seq += 1;
    await expect(
      prisma.event.create({
        data: { organizationId: orgId, name: `${TAG} Texas Scramble`, status: "live", shape: "match", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}-${seq}` },
      }),
    ).resolves.toBeTruthy();
    // And a plain unique clash on another column is not mistaken for the name.
    let other: unknown = null;
    try {
      await prisma.event.create({
        data: { organizationId: orgId, name: `${TAG} token`, status: "completed", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}-${seq}` },
      });
    } catch (e) {
      other = e;
    }
    expect(other, "the share token clash did not throw").not.toBeNull();
    expect(isNameInPlayViolation(other)).toBe(false);
  });
});
