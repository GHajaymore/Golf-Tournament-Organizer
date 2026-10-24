import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WHAT THE TEXT-BOX CRAWL STORED, REFUSED AT THE ACTION (2026-10-21).
 *
 * `e2e/every-text-box.spec.ts` tried every text box with nothing, too much,
 * junk and a good value, and these went in: an address with no @, an address
 * wrapped in `<b>…</b>`, a 2,000-character name on Access, Entries, Teams and
 * Club settings, a blank tournament name, "call me" as a mobile, a prize of
 * "-1". The screens now carry the same limits, but a `"use server"` export is
 * a public endpoint, so each rule is asked here of the ACTION, against real
 * rows, as the person who would press it — and each with a control that the
 * good value still goes in, so a rule that refuses everything cannot pass.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/email", () => ({
  sendStaffInviteEmail: async () => ({ ok: true }),
  sendPasswordResetEmail: async () => ({ ok: true }),
  emailConfig: () => ({ configured: false, sandboxSender: false, problem: null }),
}));

import { sign } from "@/lib/auth";
import { sessionValue } from "@/lib/domain/session-token";
import { addAccount, addSignup, updateSignup, saveEvent, addPrize, updatePrize } from "@/app/actions/tournament";
import { addOrganizationMember, saveOrganizationBranding } from "@/app/actions/organization";
import { renameTeam } from "@/app/actions/teams";
import { renameCupTeam, createCupTeams } from "@/app/actions/cup";

const prisma = new PrismaClient();
const MARK = `zz-textbox-${process.pid}`;
const at = (who: string) => `${MARK}-${who}@example.invalid`;
const LONG = `zz${"x".repeat(1998)}`;
const MARKUP = `<b>zz-tbx</b>${MARK}@example.invalid`;

let orgId = "";
let eventId = "";
let ownerId = "";

const asOwner = () => {
  jar.clear();
  jar.set("ng_session", sign(sessionValue(ownerId)));
  jar.set("ng_active_event", sign(eventId));
};

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} Club`, kind: "club" } });
  orgId = org.id;
  eventId = (
    await prisma.event.create({
      data: { organizationId: orgId, name: `${MARK} Medal`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${MARK}-tok` },
    })
  ).id;
  ownerId = (await prisma.user.create({ data: { email: at("owner"), name: "Zz Owner" } })).id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: ownerId, role: "owner" } });
  await prisma.account.create({ data: { eventId, email: at("owner"), name: "Zz Owner", role: "admin" } });
});

afterAll(async () => {
  try {
    // By the MARK, so a run that died half-way leaves nothing behind either.
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.member.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("Access: Add account", () => {
  it("refuses an address that is not one, an address in markup, and a name of 2,000 characters", async () => {
    asOwner();
    for (const [name, email] of [
      ["Zz Viewer", `${MARK}-not-an-address`],
      ["Zz Viewer", MARKUP],
      [LONG, at("long")],
    ]) {
      const said = await addAccount(name, email, "player");
      expect(said.ok, `${name.slice(0, 12)} / ${email}`).toBe(false);
      expect(said.error).toBeTruthy();
    }
    expect(await prisma.account.count({ where: { eventId, email: { not: at("owner") } } })).toBe(0);
  });

  it("CONTROL: a person's name and an address go in", async () => {
    asOwner();
    expect(await addAccount("Zz Viewer", at("viewer"), "player")).toEqual({ ok: true });
  });
});

describe("Tournament details: Save event", () => {
  const details = (name: string) => ({
    name, dates: "", format: "stroke", course: "", courseId: "", city: "", address: "", regDeadline: "",
    capacity: 0, playerCountMode: "registration", courseMode: "fixed",
  });
  const stored = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } })).name;

  it("refuses a blank name and a name of 2,000 characters, and keeps the one it has", async () => {
    asOwner();
    for (const name of ["", "   ", `${MARK} ${LONG}`]) {
      const said = await saveEvent(details(name));
      expect(said.ok, JSON.stringify(name.slice(0, 20))).toBe(false);
      expect(said.error).toBeTruthy();
    }
    expect(await stored()).toBe(`${MARK} Medal`);
  });

  it("CONTROL: a name is saved, trimmed", async () => {
    asOwner();
    expect(await saveEvent(details(`  ${MARK} Medal  `))).toEqual({ ok: true });
    expect(await stored()).toBe(`${MARK} Medal`);
  });
});

describe("Entries: Add to field, and a row's own boxes", () => {
  const entry = (over: Record<string, unknown>) => ({
    name: "Zz Entrant", email: at("entrant"), phone: "+44 7700 900123", handicap: 12.4, ...over,
  });

  it("refuses a name of 2,000 characters, an address in markup, and \"call me\" as a mobile", async () => {
    asOwner();
    for (const over of [{ name: LONG }, { email: MARKUP }, { phone: "call me" }, { homeClub: LONG }]) {
      const said = await addSignup(entry(over) as Parameters<typeof addSignup>[0]);
      expect(said.ok, JSON.stringify(over).slice(0, 40)).toBe(false);
      expect(said.error).toBeTruthy();
    }
    expect(await prisma.player.count({ where: { eventId } })).toBe(0);
  });

  it("CONTROL: a person with an address and a number is entered — and the row refuses markup and words after", async () => {
    asOwner();
    expect(await addSignup(entry({}) as Parameters<typeof addSignup>[0])).toEqual({ ok: true });
    const player = await prisma.player.findFirstOrThrow({ where: { eventId }, select: { id: true, email: true, phone: true } });
    for (const patch of [{ email: MARKUP }, { phone: "call me" }, { name: LONG }]) {
      const said = await updateSignup(player.id, patch);
      expect(said.ok, JSON.stringify(patch).slice(0, 30)).toBe(false);
    }
    expect(await prisma.player.findUniqueOrThrow({ where: { id: player.id }, select: { email: true, phone: true } })).toEqual({
      email: player.email,
      phone: player.phone,
    });
    // And a corrected address and number are kept.
    expect(await updateSignup(player.id, { email: at("entrant2"), phone: "07700 900456" })).toEqual({ ok: true });
  });
});

describe("Club settings", () => {
  it("refuses a name or a short name of 2,000 characters, and a town past 80 — said, not cut", async () => {
    asOwner();
    for (const [name, short, city] of [
      [LONG, "", ""],
      [`${MARK} Club`, LONG, ""],
      [`${MARK} Club`, "", "z".repeat(81)],
    ]) {
      const said = await saveOrganizationBranding(name, short, "", { city });
      expect(said.ok).toBe(false);
      expect(said.error).toBeTruthy();
    }
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } })).name).toBe(`${MARK} Club`);
  });

  it("CONTROL: a town of 80 is kept whole", async () => {
    asOwner();
    expect((await saveOrganizationBranding(`${MARK} Club`, "Zz", "", { city: "z".repeat(80) })).ok).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { city: true } })).city).toHaveLength(80);
  });

  it("Add staff refuses an address in markup", async () => {
    asOwner();
    const said = await addOrganizationMember(MARKUP, "Zz Staff", "member");
    expect(said.ok).toBe(false);
    expect(await prisma.user.count({ where: { email: MARKUP.toLowerCase() } })).toBe(0);
  });
});

describe("Teams and the cup", () => {
  it("a side's name of 2,000 characters is refused; a pair's long name is not", async () => {
    asOwner();
    const team = await prisma.team.create({ data: { eventId, name: "Zz Side", seed: 1 } });
    expect((await renameTeam(team.id, LONG)).ok).toBe(false);
    // CONTROL: two long names joined, as the app names a pair.
    const pair = `${"Zz Séamus O'Halloran-Whyte".padEnd(70, "e")} & ${"Zz Bernadette".padEnd(70, "e")}`;
    expect(await renameTeam(team.id, pair)).toEqual({ ok: true });
  });

  it("a cup team's name past 40 is refused, not cut", async () => {
    asOwner();
    await prisma.stage.create({ data: { eventId, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles" } });
    expect((await createCupTeams("z".repeat(41), "Whites")).ok).toBe(false);
    expect(await createCupTeams("Blues", "Whites")).toEqual({ ok: true });
    const blues = await prisma.group.findFirstOrThrow({ where: { eventId, name: "Blues" }, select: { id: true } });
    expect((await renameCupTeam(blues.id, "z".repeat(41))).ok).toBe(false);
    expect((await prisma.group.findUniqueOrThrow({ where: { id: blues.id }, select: { name: true } })).name).toBe("Blues");
    // CONTROL: forty is a name.
    expect(await renameCupTeam(blues.id, "z".repeat(40))).toEqual({ ok: true });
  });
});

describe("Prizes", () => {
  it("Add refuses a blank name and an impossible amount, in words", async () => {
    asOwner();
    for (const [category, amount] of [["", 10], ["   ", 10], ["Zz Longest drive", -1], ["Zz Longest drive", 1e9], ["Zz Longest drive", Number.NaN]] as const) {
      const said = await addPrize(category, amount);
      expect(said.ok, `${category} ${amount}`).toBe(false);
      expect(said.error).toBeTruthy();
    }
    expect(await prisma.prize.count({ where: { eventId } })).toBe(0);
  });

  it("CONTROL: a named prize, with or without an amount, is added — and its amount refuses -1", async () => {
    asOwner();
    expect(await addPrize("Zz Longest drive", 25)).toEqual({ ok: true });
    expect(await addPrize("Zz Nearest the pin", 0)).toEqual({ ok: true });
    const prize = await prisma.prize.findFirstOrThrow({ where: { eventId, category: "Zz Longest drive" }, select: { id: true } });
    expect((await updatePrize(prize.id, { amount: -1 })).ok).toBe(false);
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id }, select: { amount: true } })).amount).toBe(25);
  });
});
