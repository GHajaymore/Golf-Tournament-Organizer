import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A HOME CLUB, AND A HANDICAP NUMBER, REACH THE ENTRY THROUGH EVERY DOOR THAT TAKES ONE.
 *
 * The text-box crawl (2026-10-21) typed a home club into Entries' "Add someone new", pressed Add, and
 * found the row without it. The row HAD it — the screen drew it nowhere (fixed in RegistrationClient,
 * pinned in `the-text-box-crawl-found.test.tsx`). Checking every door that adds a player then found
 * two that did drop it: the entry CSV import recognised a "Home club" and a "GHIN" column by their
 * headers and wrote neither, and a member entering themselves came in without the club and the
 * number their own record holds — which the organizer's "Add to field" from Members copies.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

type Session = { email: string; name: string; id?: string; userId?: string; accountId?: string; eventId: string; role: string; viewRole?: string };
const session: { current: Session | null } = { current: null };
vi.mock("@/lib/auth", () => ({ getSession: async () => session.current, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addSignup, importCsvSignups } = await import("@/app/actions/tournament");
const { enterThisTournament } = await import("@/app/actions/enter");
const { addMembersToEvent } = await import("@/app/actions/roster");

const prisma = new PrismaClient();
const TAG = "zz-home-club";
const RUN = randomBytes(4).toString("hex");
const ids = { org: "", event: "", rosterMember: "" };
let admin: Session;
let member: Session;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: true,
      registrationApproval: "auto",
      registrationToken: randomBytes(6).toString("hex"),
      shareToken: randomBytes(10).toString("hex"),
      configUnlocked: true,
    },
  });
  ids.event = event.id;
  const adminEmail = `${TAG}-sec-${RUN}@example.invalid`;
  await prisma.account.create({ data: { eventId: event.id, email: adminEmail, name: `${TAG} secretary`, role: "admin" } });
  admin = { email: adminEmail, name: `${TAG} secretary`, eventId: event.id, role: "admin", viewRole: "admin", userId: "", accountId: "" };

  // A member with an account and a club record holding a home club and a number.
  const user = await prisma.user.create({ data: { email: `${TAG}-una-${RUN}@example.invalid`, name: `${TAG} Una` } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "member" } });
  await prisma.member.create({
    data: { organizationId: org.id, name: `${TAG} Una`, email: user.email, handicap: 14, handicapType: "18", handicapSource: "manual", phone: "07700 900131", homeClub: `${TAG} Una's club`, ghin: "9900131" },
  });
  member = { email: user.email, name: user.name ?? "", id: user.id, eventId: event.id, role: "player" };

  // And one on the roster with no account, for the organizer's "Add to field" — the door that already copied both.
  ids.rosterMember = (
    await prisma.member.create({
      data: { organizationId: org.id, name: `${TAG} Vic`, email: `${TAG}-vic-${RUN}@example.invalid`, handicap: 9, handicapType: "18", handicapSource: "manual", phone: "07700 900132", homeClub: `${TAG} Vic's club`, ghin: "9900132" },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const entry = (name: string) => prisma.player.findFirstOrThrow({ where: { eventId: ids.event, name: { contains: name } }, select: { homeClub: true, ghin: true, email: true } });

describe("every door that adds a player carries the home club it was given", () => {
  it("the organizer's Add form on Entries", async () => {
    session.current = admin;
    const res = await addSignup({
      name: `${TAG} Wyn ${RUN}`,
      handicap: 11,
      email: `${TAG}-wyn-${RUN}@example.invalid`,
      phone: "07700 900133",
      homeClub: `${TAG} Wyn's club`,
    });
    expect(res.ok, `refused: ${res.error ?? ""}`).toBe(true);
    expect(await entry("Wyn")).toEqual({ homeClub: `${TAG} Wyn's club`, ghin: "", email: `${TAG}-wyn-${RUN}@example.invalid` });
  });

  it("the entry list imported from a file, with a Home club and a GHIN column", async () => {
    session.current = admin;
    const csv = [
      "Name,Email,Phone,Handicap,Home club,GHIN",
      `${TAG} Xan ${RUN},${TAG}-xan-${RUN}@example.invalid,07700 900134,12.4,${TAG} Xan's club,9900134`,
      // CONTROL: a row with the cells empty is entered with nothing in them, not with a neighbour's.
      `${TAG} Yve ${RUN},${TAG}-yve-${RUN}@example.invalid,07700 900135,8,,`,
    ].join("\n");
    const res = await importCsvSignups(csv);
    expect(res.error ?? "", "the import was refused").toBe("");
    expect(res.imported).toBe(2);
    expect(await entry("Xan")).toEqual({ homeClub: `${TAG} Xan's club`, ghin: "9900134", email: `${TAG}-xan-${RUN}@example.invalid` });
    expect(await entry("Yve")).toEqual({ homeClub: "", ghin: "", email: `${TAG}-yve-${RUN}@example.invalid` });
  });

  it("a member entering themselves brings what their club record holds", async () => {
    session.current = member;
    const res = await enterThisTournament(ids.event);
    expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    expect(await entry("Una")).toEqual({ homeClub: `${TAG} Una's club`, ghin: "9900131", email: member.email });
  });

  it("CONTROL: the organizer adding the same kind of member from Members, which always did", async () => {
    session.current = admin;
    const res = await addMembersToEvent([ids.rosterMember]);
    expect(res.ok && res.added).toBe(1);
    expect(await entry("Vic")).toEqual({ homeClub: `${TAG} Vic's club`, ghin: "9900132", email: `${TAG}-vic-${RUN}@example.invalid` });
  });
});
