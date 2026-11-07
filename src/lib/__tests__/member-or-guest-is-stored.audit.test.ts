import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * MEMBER OR GUEST, AGAINST REAL ROWS (the no-email player identity, PR 1; Ajay, 2026-11-07).
 *
 * The three organizer doors, pressed as the organizer, on a throwaway club in the development
 * database:
 *
 * - `addSignup` stores the choice; a guest's email and mobile are never stored, and a guest
 *   has no sign-in `Account` made for them; a member without an email on an email-only
 *   tournament is entered and turns Round Codes on;
 * - `importCsvSignups` stores Ajay's default per row and the organizer's switches, re-read
 *   (a switch it cannot trust is dropped, never applied), and keeps a guest's email off the entry;
 * - an entry made before A039 (`standing` "") still reads as a member.
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-GUEST1";
const EMAIL = "zz-audit-guest1@example.invalid";
const session = { email: EMAIL, name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createEvent, addStage, addSignup, importCsvSignups } = await import("@/app/actions/tournament");
const { entryStanding } = await import("@/lib/domain/entry-standing");

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function make(name: string) {
  await createEvent(`${TAG} ${name}`, "custom", "single");
  const ev = await prisma.event.findFirst({ where: { name: `${TAG} ${name}` } });
  expect(ev, `${name} was created`).not.toBeNull();
  session.eventId = ev!.id;
  await addStage("Stroke Play Round", { format: "Stroke Play" });
  return ev!;
}

const entry = (eventId: string, name: string) =>
  prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} ${name}` }, select: { standing: true, email: true, phone: true, ghin: true } });

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: EMAIL, name: session.name } });
  await prisma.organization.create({
    data: {
      name: `${TAG} organizer`,
      kind: "personal",
      subscription: { create: { plan: "free", planTermsApply: false } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
});
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("Add stores member or guest", () => {
  it("a guest is stored without an email, a mobile or a sign-in account", async () => {
    const ev = await make("add");
    // Read the fixture's fact: this tournament signs players in by email only.
    expect(ev.playerAccess).toBe("email");
    const res = await addSignup({ name: `${TAG} Dana`, handicap: 12, standing: "guest", email: "zz-dana@example.invalid", phone: "07700 900010" });
    expect(res.ok, res.error).toBe(true);
    expect(await entry(ev.id, "Dana")).toEqual({ standing: "guest", email: "", phone: "", ghin: "" });
    expect(await prisma.account.count({ where: { eventId: ev.id, email: "zz-dana@example.invalid" } })).toBe(0);
    // An entry without an email on an email-only tournament turned Round Codes on.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).playerAccess).toBe("both");
    expect(res.said).toMatch(/round codes are on now too/);
  });

  it("a member may be added without an email, and one with an email keeps it (control)", async () => {
    const ev = await make("add-members");
    const bare = await addSignup({ name: `${TAG} Rob`, handicap: 10, standing: "member" });
    expect(bare.ok, bare.error).toBe(true);
    expect((await entry(ev.id, "Rob")).standing).toBe("member");
    const withEmail = await addSignup({ name: `${TAG} Ann`, handicap: 9, standing: "member", email: "zz-ann@example.invalid" });
    expect(withEmail.ok, withEmail.error).toBe(true);
    expect(await entry(ev.id, "Ann")).toMatchObject({ standing: "member", email: "zz-ann@example.invalid" });
    expect(await prisma.account.count({ where: { eventId: ev.id, email: "zz-ann@example.invalid" } })).toBe(1);
  });

  it("refuses a standing this app does not have", async () => {
    await make("add-bad");
    const res = await addSignup({ name: `${TAG} Eve`, handicap: 9, standing: "admin" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Choose Member or Guest (not a club member).");
  });
});

describe("the CSV import stores Ajay's default and the organizer's switches", () => {
  it("row by row, re-reading every switch", async () => {
    const ev = await make("import");
    const csv = [
      "name,email,handicap,handicap id,member or guest",
      `${TAG} Ann,zz-imp-ann@example.invalid,10,,`,
      `${TAG} Ben,,12,1234567,`,
      `${TAG} Dev,,20,,`,
      `${TAG} Eve,zz-imp-eve@example.invalid,5,,guest`,
      `${TAG} Fay,,7,,`,
    ].join("\n");
    // Ben switched to guest; Fay's switch is not a standing and is dropped (she takes the default).
    const r = await importCsvSignups(csv, { 1: "guest", 4: "owner" } as Record<number, string>);
    expect(r.error).toBeUndefined();
    expect(r.imported).toBe(5);
    expect([r.members, r.guests, r.emailsDropped]).toEqual([1, 4, 1]);
    expect((await entry(ev.id, "Ann")).standing).toBe("member");
    expect(await entry(ev.id, "Ben")).toMatchObject({ standing: "guest", ghin: "1234567" });
    expect((await entry(ev.id, "Dev")).standing).toBe("guest");
    // A guest's email from the file never reaches the entry or an account.
    expect(await entry(ev.id, "Eve")).toMatchObject({ standing: "guest", email: "" });
    expect(await prisma.account.count({ where: { eventId: ev.id, email: "zz-imp-eve@example.invalid" } })).toBe(0);
    expect((await entry(ev.id, "Fay")).standing).toBe("guest");
  });

  it("CONTROL: an entry made before A039 reads as a member", async () => {
    const ev = await make("before");
    const p = await prisma.player.create({ data: { eventId: ev.id, name: `${TAG} Old`, seed: 1 } });
    const stored = await prisma.player.findUniqueOrThrow({ where: { id: p.id }, select: { standing: true } });
    expect(stored.standing).toBe("");
    expect(entryStanding(stored)).toBe("member");
  });
});
