import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A GUEST'S PLAYER LINK REACHES ITS OWN ENTRY AND NOTHING ELSE (J39/J40 PR 1;
 * the Security & TD review's abuse cases, against real rows).
 *
 * Two clubs and three events. One guest holds a link to one entry of one
 * event. Beside it in that event: a member with NO email and a second guest
 * with no link — the two entries an empty address would match (the
 * `byAddress("")` hazard). Every case below is something a link holder, a
 * forwarded link or a guessing script would try:
 *
 *   - the link's card actions with another entry's, another event's or
 *     another club's ids                                      refused
 *   - a waitlisted or pending entry writing its own card (S5) refused
 *   - turned off, rotated, withdrawn, made a member, expired   refused, and
 *     the old code finds nothing
 *   - a browser holding a SIGN-IN for club B and the link for club A (S4)
 *     reaches exactly its own B entry plus the one A entry, never merged
 *   - staff of the link's own event keep their own powers there
 *   - guessing (S2): twenty failed opens per client, never cleared by a real
 *     open (a success gives back one), the code never in the counter table
 *   - the code never in the record (S3/S7)
 *
 * Fixtures: `zz-guest-audit` clubs, invented names, `@example.invalid`,
 * deleted in `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-guest-reaches-only-its-entry.audit.test.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
const head = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => head.get(name.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession } from "@/lib/auth";
import { ensurePass, rotatePass, revokePass, passForCode, livePass, lookupOf } from "@/lib/services/player-link";
import { setGuestCookie, getGuestSession, choosePlayerViewCookie } from "@/lib/guest-auth";
import { playerViewSwitch, guestViewer, guestActorFor, myPlayerIdsFor } from "@/lib/player-viewer";
import { saveScorecard, certifyScorecard, disputeScorecard } from "@/app/actions/tournament";
import { openPlayerLink, showPlayerLink } from "@/app/actions/player-link";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
const MARK = "zz-guest-audit";
const PARS = Array.from({ length: 18 }, () => 4);
const CARD = PARS.map((p) => p + 1);

type Ev = { eventId: string; stageId: string };
let A1: Ev, A2: Ev, B1: Ev;
let guest = "";
let noEmailMember = "";
let otherGuest = "";
let a2Guest = "";
let b1Member = "";
let bUserId = "";
let staffUserId = "";
const B_EMAIL = `${MARK}-bmember@example.invalid`;
const STAFF_EMAIL = `${MARK}-staff@example.invalid`;

async function club(name: string) {
  return prisma.organization.create({ data: { name: `${MARK} ${name}`, kind: "club", timeZone: "UTC" }, select: { id: true } });
}

async function event(orgId: string, name: string): Promise<Ev> {
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${name}`,
      organizationId: orgId,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${name.replace(/\W/g, "")}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(PARS.map((_, i) => i + 1)),
    },
    select: { id: true },
  });
  const stage = await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" },
    select: { id: true },
  });
  return { eventId: ev.id, stageId: stage.id };
}

let seed = 1;
async function entry(eventId: string, name: string, extra: { email?: string; standing?: string; status?: string } = {}) {
  const p = await prisma.player.create({
    data: { eventId, name, email: extra.email ?? "", standing: extra.standing ?? "", status: extra.status ?? "confirmed", handicap: 10, seed: seed++ },
    select: { id: true },
  });
  return p.id;
}

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

/** Hold a guest cookie for this pass, as a tap on /p would set. */
async function holdLink(playerId: string) {
  const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId }, select: { id: true, version: true } });
  await setGuestCookie(pass.id, pass.version);
}

const refusedWith = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

describe("a guest's player link reaches its own entry and nothing else", () => {
  let code = "";

  beforeAll(async () => {
    await cleanUp();
    const a = await club("Larkfield");
    const b = await club("Brackenmoor");
    A1 = await event(a.id, "Spring Outing");
    A2 = await event(a.id, "Summer Medal");
    B1 = await event(b.id, "Autumn Cup");
    guest = await entry(A1.eventId, "Robin Vale", { standing: "guest" });
    noEmailMember = await entry(A1.eventId, "Esme Fairholt");
    otherGuest = await entry(A1.eventId, "Tobin Quarrie", { standing: "guest" });
    a2Guest = await entry(A2.eventId, "Robin Vale", { standing: "guest" });
    b1Member = await entry(B1.eventId, "Wren Calloway", { email: B_EMAIL });
    const bUser = await prisma.user.create({ data: { email: B_EMAIL, name: "Wren Calloway", password: "x:unusable", emailVerifiedAt: new Date() } });
    bUserId = bUser.id;
    await prisma.account.create({ data: { eventId: B1.eventId, name: "Wren Calloway", email: B_EMAIL, role: "player" } });
    const staff = await prisma.user.create({ data: { email: STAFF_EMAIL, name: "Corin Abernethy", password: "x:unusable", emailVerifiedAt: new Date() } });
    staffUserId = staff.id;
    await prisma.account.create({ data: { eventId: A1.eventId, name: "Corin Abernethy", email: STAFF_EMAIL, role: "admin" } });
    const shown = await ensurePass(A1.eventId, guest, "Corin Abernethy");
    if (!shown.ok) throw new Error("the fixture's guest got no link");
    code = shown.code;
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    jar.clear();
    head.clear();
    // Every case starts confirmed and live.
    await prisma.player.update({ where: { id: guest }, data: { status: "confirmed", standing: "guest" } });
    await prisma.event.update({ where: { id: A1.eventId }, data: { endOn: "" } });
  });

  it("a link is made only for a guest of the event it is asked in (D12)", async () => {
    expect(await ensurePass(A1.eventId, noEmailMember, "x")).toEqual({ ok: false, reason: "not-a-guest" });
    expect(await ensurePass(A2.eventId, guest, "x"), "another event's id for the guest").toEqual({ ok: false, reason: "not-a-guest" });
    expect(await ensurePass(A1.eventId, b1Member, "x"), "another club's entry").toEqual({ ok: false, reason: "not-a-guest" });
    const again = await ensurePass(A1.eventId, guest, "x");
    expect(again, "re-showing is not rotating (D3)").toEqual({ ok: true, code });
  });

  it("the code finds its one entry, and is stored only hashed and sealed", async () => {
    const pass = await passForCode(code);
    expect(pass?.playerId).toBe(guest);
    expect(pass?.eventId).toBe(A1.eventId);
    const row = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } });
    expect(row.lookup).toBe(lookupOf(code));
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it("a guest viewer never resolves another email-less entry: the byAddress(\"\") hazard", async () => {
    await holdLink(guest);
    const held = await getGuestSession();
    expect(held?.playerId).toBe(guest);
    const viewer = guestViewer(held!);
    expect(viewer.email).toBe("");
    expect([...(await myPlayerIdsFor(viewer, A1.eventId))]).toEqual([guest]);
    expect([...(await myPlayerIdsFor(viewer, A2.eventId))], "the same name in another event").toEqual([]);
    expect([...(await myPlayerIdsFor(viewer, B1.eventId))]).toEqual([]);
  });

  it("writes its own card, and nobody else's in any event or club", async () => {
    await holdLink(guest);
    const own = await saveScorecard(A1.stageId, guest, CARD);
    expect(own.ok).toBe(true);
    expect(await refusedWith(saveScorecard(A1.stageId, noEmailMember, CARD))).toMatch(/only keep score for yourself|only enter your own/);
    expect(await refusedWith(saveScorecard(A1.stageId, otherGuest, CARD))).toMatch(/only keep score for yourself|only enter your own/);
    expect(await refusedWith(saveScorecard(A2.stageId, a2Guest, CARD)), "another event of the club").toBe("Not authenticated");
    expect(await refusedWith(saveScorecard(B1.stageId, b1Member, CARD)), "another club").toBe("Not authenticated");
    expect(await refusedWith(saveScorecard(A1.stageId, b1Member, CARD)), "another club's entry in this round").not.toBe("");
    expect(await refusedWith(certifyScorecard(A1.stageId, noEmailMember))).toMatch(/only enter your own/);
    expect(await refusedWith(disputeScorecard(A1.stageId, noEmailMember))).toMatch(/only enter your own/);
    expect(await prisma.scorecard.count({ where: { playerId: { in: [noEmailMember, otherGuest, a2Guest, b1Member] } } })).toBe(0);
    // The guest certifies their own, signed by name (no address).
    await certifyScorecard(A1.stageId, guest);
    const card = await prisma.scorecard.findFirstOrThrow({ where: { stageId: A1.stageId, playerId: guest } });
    expect(card.status).toBe("certified");
    expect(card.certifiedBy).toBe("Robin Vale");
    // The organizer's own actions are not the guest's.
    expect(await refusedWith(showPlayerLink(otherGuest, "shown"))).toBe("Not authenticated");
  });

  it("S5: a waitlisted or pending entry's link opens, but writes nothing", async () => {
    for (const status of ["waitlisted", "pending"]) {
      await prisma.player.update({ where: { id: guest }, data: { status } });
      await holdLink(guest);
      expect(await getGuestSession(), `${status}: the link still opens Today`).not.toBeNull();
      expect(await refusedWith(saveScorecard(A1.stageId, guest, CARD)), status).toMatch(/only keep score for yourself|only enter your own|only the players/i);
      expect(await refusedWith(certifyScorecard(A1.stageId, guest)), status).toMatch(/only enter your own/);
    }
  });

  it("withdrawn, made a member, or 90 club days past the last round: the link is nothing", async () => {
    const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } });
    await prisma.player.update({ where: { id: guest }, data: { status: "withdrawn" } });
    expect(await livePass(pass.id, pass.version)).toBeNull();
    expect(await passForCode(code)).toBeNull();
    await prisma.player.update({ where: { id: guest }, data: { status: "disqualified" } });
    expect(await livePass(pass.id, pass.version)).toBeNull();
    await prisma.player.update({ where: { id: guest }, data: { status: "confirmed", standing: "member" } });
    expect(await livePass(pass.id, pass.version), "made a member (S14)").toBeNull();
    await prisma.player.update({ where: { id: guest }, data: { standing: "guest" } });
    await prisma.event.update({ where: { id: A1.eventId }, data: { endOn: "2020-01-01" } });
    expect(await livePass(pass.id, pass.version), "90 days past the last round").toBeNull();
    await prisma.event.update({ where: { id: A1.eventId }, data: { endOn: "" } });
    expect(await livePass(pass.id, pass.version), "CONTROL: live again once nothing ends it").not.toBeNull();
  });

  it("New link ends the old code and every cookie holding it; Turn off ends the new one", async () => {
    await holdLink(guest);
    expect(await getGuestSession()).not.toBeNull();
    const rotated = await rotatePass(A1.eventId, guest, "Corin Abernethy");
    if (!rotated.ok) throw new Error("no new link");
    expect(rotated.code).not.toBe(code);
    expect(await passForCode(code), "the old code").toBeNull();
    expect(await getGuestSession(), "a phone holding the old link").toBeNull();
    expect(await refusedWith(saveScorecard(A1.stageId, guest, CARD))).toBe("Not authenticated");
    expect((await passForCode(rotated.code))?.playerId).toBe(guest);
    await holdLink(guest);
    expect(await getGuestSession()).not.toBeNull();
    expect(await revokePass(A1.eventId, guest, "Corin Abernethy")).toBe(true);
    expect(await getGuestSession(), "turned off").toBeNull();
    expect(await passForCode(rotated.code)).toBeNull();
    expect(await ensurePass(A1.eventId, guest, "x"), "a turned-off link is not shown again").toEqual({ ok: false, reason: "turned-off" });
    const fresh = await rotatePass(A1.eventId, guest, "Corin Abernethy");
    if (!fresh.ok) throw new Error("no fresh link");
    code = fresh.code;
  });

  it("S4: a browser signed in to club B and holding the link for club A reaches exactly B's entry plus the one A entry", async () => {
    expect(await createSession(bUserId)).toBe(true);
    await holdLink(guest);
    const both = await playerViewSwitch();
    expect(both.viewer?.guest?.playerId, "the link answers for its own event beside a sign-in").toBe(guest);
    expect(both.other).toEqual({ kind: "account", name: "Wren Calloway" });
    // The link writes its own entry in its own event; the account writes its own in B. Never merged.
    expect((await saveScorecard(A1.stageId, guest, CARD)).ok).toBe(true);
    expect((await saveScorecard(B1.stageId, b1Member, CARD)).ok).toBe(true);
    expect(await refusedWith(saveScorecard(A1.stageId, noEmailMember, CARD))).not.toBe("");
    expect(await refusedWith(saveScorecard(A2.stageId, a2Guest, CARD)), "the account never borrows the link's club").not.toBe("");
    expect([...(await myPlayerIdsFor(both.viewer!, B1.eventId))], "the guest viewer never borrows the account's events").toEqual([]);
    // Choosing the account: it looks through the account, offered the link beside it.
    await choosePlayerViewCookie("account");
    const chosen = await playerViewSwitch();
    expect(chosen.viewer?.guest).toBeNull();
    expect(chosen.viewer?.email).toBe(B_EMAIL);
    expect(chosen.other).toEqual({ kind: "guest", name: "Robin Vale" });
    expect([...(await myPlayerIdsFor(chosen.viewer!, A1.eventId))], "the account never borrows the link's entry").toEqual([]);
    expect([...(await myPlayerIdsFor(chosen.viewer!, B1.eventId))]).toEqual([b1Member]);
  });

  it("staff of the link's own event keep their own powers there", async () => {
    expect(await createSession(staffUserId)).toBe(true);
    await holdLink(guest);
    const { getSession } = await import("@/lib/auth");
    expect(await guestActorFor(A1.eventId, await getSession()), "staff are never demoted to the guest").toBeNull();
    expect((await playerViewSwitch()).viewer?.guest).toBeNull();
    // As staff, the panel's press shows the link, on the record without the code.
    const shown = await showPlayerLink(guest, "copied");
    expect(shown).toEqual({ ok: true, code });
    const line = await prisma.auditLog.findFirst({ where: { eventId: A1.eventId, action: "player-link.handed" }, orderBy: { createdAt: "desc" } });
    expect(line?.detail).toBe(`${guest}'s player link copied`);
    expect(line?.actor).toBe("Corin Abernethy");
    expect(await showPlayerLink(noEmailMember, "shown"), "a member is never given a link").toMatchObject({ ok: false });
  });

  it("S2: twenty failed opens per client, never cleared by a real one, and no code in the counters", async () => {
    // A fresh client each run (a counting window outlives one run): a random address in 10/8.
    const r = () => Math.floor(Math.random() * 250) + 1;
    const address = `10.${r()}.${r()}.${r()}`;
    head.set("x-forwarded-for", address);
    const wrong = () => openPlayerLink(`${code.slice(0, 11)}${code.endsWith("Z") ? "Y" : "Z"}`);
    for (let i = 0; i < 19; i += 1) expect((await wrong()).ok).toBe(false);
    // The real link opens, and gives back only its own attempt: the 19 failures stay counted.
    expect(await openPlayerLink(code)).toEqual({ ok: true });
    expect(await wrong()).toEqual({ ok: false, error: "This link no longer works. Ask your organizer for a new one." });
    const refused = await wrong();
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/Too many link attempts/);
    // Refused before the lookup: even the real code is refused now, by the same words.
    const real = await openPlayerLink(code);
    expect(!real.ok && real.error).toMatch(/Too many link attempts/);
    // Another client is not blocked by this one.
    head.set("x-forwarded-for", `10.${r()}.${r()}.${r()}`);
    expect(await openPlayerLink(code)).toEqual({ ok: true });
    const keys = (await prisma.rateLimitHit.findMany({ where: { key: { startsWith: "player-link" } }, select: { key: true } })).map((k) => k.key);
    const bare = createHash("sha256").update(code).digest("hex");
    for (const k of keys) {
      expect(k).not.toContain(code);
      expect(k).not.toContain(bare);
      expect(k).not.toContain(lookupOf(code));
    }
  });

  it("an open is recorded by browser and on the record, never with the code", async () => {
    head.set("x-forwarded-for", `172.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`);
    const before = await prisma.playerPassDevice.count({ where: { pass: { playerId: guest } } });
    expect(await openPlayerLink(code)).toEqual({ ok: true });
    expect(await prisma.playerPassDevice.count({ where: { pass: { playerId: guest } } })).toBe(before + 1);
    expect(jar.get("ng_guest")).toBeTruthy();
    expect(jar.get("ng_guest")).not.toContain(code);
    const lines = await prisma.auditLog.findMany({ where: { eventId: A1.eventId, action: { startsWith: "player-link." } }, select: { detail: true } });
    expect(lines.some((l) => l.detail.includes("opened on a new phone or browser"))).toBe(true);
    for (const l of lines) expect(l.detail).not.toContain(code);
  });
});
