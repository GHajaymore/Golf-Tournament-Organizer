import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A GUEST IS IN MESSAGES BY WHO-KEY, NEVER BY AN ADDRESS (J39/J40 PR 2; the
 * test plan's A1–A9 and A11, against real rows).
 *
 * One club's event holds an organizer, a member with an email, a guest with a
 * live link, a waitlisted guest with a link, and a member with no email at
 * all. A second club's member is signed in on the phone that holds the
 * guest's link (the SF-1/D-1 case, for messaging). Every case is a press the
 * guest, the member or the organizer would make:
 *
 *   A1  the organizer posts to the round; the guest reads it, replies, and is
 *       marked "Guest"
 *   A2  the guest never reads or posts in the club's threads, a direct thread
 *       between two others (by thread id, by stored key, by outward key),
 *       another player's desk; and starts no direct thread at all (D7)
 *   A3  a waitlisted guest gets no messaging context and no badge (S5)
 *   A4  Message the organizer: the guest's desk is read by staff, not by a member
 *   A5  the guest's post budget: twenty in fifteen minutes, never cleared
 *   A7  the organizer and a member open a direct thread WITH the guest; the
 *       guest reads and replies
 *   A8  the guest turns direct messages off: gone from the picker, refused in words
 *   A9  the organizer mutes the guest: round posts refused in words, desk open;
 *       refused for a player, another club's staff and a member's entry
 *   A11 one browser, two identities: the console's sends act as the account,
 *       the player app's as the guest, never crossed
 *   a `guest:` key never matches an email row
 *
 * Fixtures: `zz-guest-msg` clubs, invented names, `@example.invalid`, deleted
 * in `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-guest-is-messaged-by-key.audit.test.ts
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
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession } from "@/lib/auth";
import { ensurePass } from "@/lib/services/player-link";
import { setGuestCookie } from "@/lib/guest-auth";
import { getPlayerViewer } from "@/lib/player-viewer";
import { membershipFor, threadsFor, threadView, messageableField, composableScopes } from "@/lib/services/messaging";
import { readThread, sendMessage, markThreadRead, startDirectThread, setMyMessagesOptOut, broadcastToScope } from "@/app/actions/messaging";
import { muteGuestInMessages } from "@/app/actions/player-link";
import { guestWhoKey } from "@/lib/domain/messaging";

const prisma = new PrismaClient();
const MARK = "zz-guest-msg";
const STAFF = `${MARK}-staff@example.invalid`;
const MEMBER = `${MARK}-member@example.invalid`;
const OTHER_STAFF = `${MARK}-bstaff@example.invalid`;
const B_MEMBER = `${MARK}-bmember@example.invalid`;

let eventA = "";
let stageA = "";
let eventB = "";
let stageB = "";
let guest = "";
let waiting = "";
let member = "";
let noEmail = "";
const users: Record<string, string> = {};

async function club(name: string) {
  return prisma.organization.create({ data: { name: `${MARK} ${name}`, kind: "club", timeZone: "UTC" }, select: { id: true } });
}

async function eventIn(orgId: string, name: string) {
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
    },
    select: { id: true },
  });
  const st = await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" },
    select: { id: true },
  });
  return { eventId: ev.id, stageId: st.id };
}

let seed = 1;
async function entry(eventId: string, name: string, extra: { email?: string; standing?: string; status?: string } = {}) {
  const p = await prisma.player.create({
    data: { eventId, name, email: extra.email ?? "", standing: extra.standing ?? "", status: extra.status ?? "confirmed", handicap: 10, seed: seed++ },
    select: { id: true },
  });
  return p.id;
}

async function person(email: string, name: string, eventId: string, role: "admin" | "player") {
  const u = await prisma.user.create({ data: { email, name, password: "x:unusable", emailVerifiedAt: new Date() } });
  await prisma.account.create({ data: { eventId, name, email, role } });
  return u.id;
}

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

async function holdLink(playerId: string) {
  const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId }, select: { id: true, version: true } });
  await setGuestCookie(pass.id, pass.version);
}

/** A fresh browser: nothing held. */
const fresh = () => jar.clear();
async function as(email: string) {
  fresh();
  expect(await createSession(users[email])).toBe(true);
}
async function asGuest(playerId = guest) {
  fresh();
  await holdLink(playerId);
}
const refused = async (p: Promise<unknown>) => {
  try {
    const r = (await p) as { ok?: boolean } | null;
    return r === null || r?.ok === false;
  } catch {
    return true;
  }
};

describe("a guest is in messages by who-key", () => {
  beforeAll(async () => {
    await cleanUp();
    const a = await club("Larkfield");
    const b = await club("Brackenmoor");
    ({ eventId: eventA, stageId: stageA } = await eventIn(a.id, "Spring Outing"));
    ({ eventId: eventB, stageId: stageB } = await eventIn(b.id, "Autumn Cup"));
    users[STAFF] = await person(STAFF, "Corin Abernethy", eventA, "admin");
    users[MEMBER] = await person(MEMBER, "Esme Fairholt", eventA, "player");
    member = await entry(eventA, "Esme Fairholt", { email: MEMBER });
    guest = await entry(eventA, "Robin Vale", { standing: "guest" });
    waiting = await entry(eventA, "Tobin Quarrie", { standing: "guest", status: "waitlisted" });
    noEmail = await entry(eventA, "Alder Pennick");
    users[OTHER_STAFF] = await person(OTHER_STAFF, "Wren Calloway", eventB, "admin");
    users[B_MEMBER] = await person(B_MEMBER, "Hollis Marrow", eventB, "player");
    await entry(eventB, "Hollis Marrow", { email: B_MEMBER });
    for (const id of [guest, waiting]) {
      const shown = await ensurePass(eventA, id, "Corin Abernethy");
      if (!shown.ok) throw new Error("the fixture's guest got no link");
    }
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    fresh();
    await prisma.playerPass.updateMany({ where: { playerId: guest }, data: { mutedAt: null, mutedBy: "", messagesOptOut: false } });
    await prisma.rateLimitHit.deleteMany({});
  });

  it("A1: the organizer posts to the round; the guest sees it unread, reads it, replies, and is marked Guest", async () => {
    await as(STAFF);
    const posted = await sendMessage(`round:${stageA}`, "zz Greens are slow today.");
    expect(posted.ok).toBe(true);
    await asGuest();
    const viewer = await getPlayerViewer();
    const ctx = (await membershipFor(viewer!, eventA))!;
    expect(ctx.whoKey).toBe(guestWhoKey(guest));
    expect(ctx.guest).toBe(true);
    const listed = (await threadsFor(ctx)).find((t) => t.id === posted.threadId);
    expect(listed?.unread, "the guest's badge").toBe(1);
    expect((await readThread(posted.threadId!))?.messages.map((m) => m.body)).toEqual(["zz Greens are slow today."]);
    await markThreadRead(posted.threadId!);
    expect((await threadsFor(ctx)).find((t) => t.id === posted.threadId)?.unread, "read").toBe(0);
    expect((await sendMessage(`round:${stageA}`, "zz Thanks, noted.")).ok).toBe(true);
    const row = await prisma.message.findFirst({ where: { threadId: posted.threadId, body: "zz Thanks, noted." } });
    expect(row?.authorKey).toBe(guestWhoKey(guest));
    expect(row?.authorName).toBe("Robin Vale");
    await as(STAFF);
    const seen = await readThread(posted.threadId!);
    const reply = seen?.messages.find((m) => m.body === "zz Thanks, noted.");
    expect(reply?.guest, "marked Guest for the organizer").toBe(true);
    expect(seen?.messages.find((m) => m.body === "zz Greens are slow today.")?.guest).toBe(false);
  });

  it("A2: the guest never reaches the club's threads, a direct thread of two others, or another player's desk", async () => {
    await as(STAFF);
    const clubPost = await broadcastToScope("club:", "zz Course closed Monday.");
    expect(clubPost.ok).toBe(true);
    const direct = await startDirectThread([member], "zz A word, Esme.");
    expect(direct.ok).toBe(true);
    const stored = (await prisma.thread.findUniqueOrThrow({ where: { id: direct.threadId! } })).scopeKey;
    await asGuest();
    const ctx = (await membershipFor((await getPlayerViewer())!, eventA))!;
    const ids = (await threadsFor(ctx)).map((t) => t.id);
    expect(ids, "the club's thread reached a guest").not.toContain(clubPost.threadId);
    expect(ids).not.toContain(direct.threadId);
    expect(await readThread(clubPost.threadId!)).toBeNull();
    expect(await readThread(direct.threadId!)).toBeNull();
    expect(await refused(sendMessage("club:", "zz hello club"))).toBe(true);
    expect(await refused(sendMessage(stored, "zz in your thread"))).toBe(true);
    expect(await refused(sendMessage(`direct:~${direct.threadId}`, "zz in your thread"))).toBe(true);
    expect(await refused(sendMessage(`desk:${member}`, "zz as Esme"))).toBe(true);
    expect(await refused(sendMessage(`round:${stageB}`, "zz another club's round"))).toBe(true);
    // D7: no direct-start door for a guest at all, and no picker.
    expect(await refused(startDirectThread([member], "zz hi"))).toBe(true);
    expect(await messageableField(ctx)).toEqual([]);
    // A2's own sweep (A6): nothing a guest receives holds an address.
    const payload = JSON.stringify([await threadsFor(ctx), await composableScopes(ctx), ...(await Promise.all(ids.map((id) => threadView(ctx, id))))]);
    expect(payload, "an address reached a guest").not.toContain("@");
  });

  it("A3: a waitlisted guest gets no messaging context and no badge", async () => {
    await asGuest(waiting);
    const viewer = await getPlayerViewer();
    expect(viewer?.guest?.playerId).toBe(waiting);
    expect(await membershipFor(viewer!, eventA)).toBeNull();
    expect(await refused(sendMessage(`desk:${waiting}`, "zz am I in?"))).toBe(true);
  });

  it("A4: Message the organizer — staff read the guest's desk and reply; a member cannot read it", async () => {
    await asGuest();
    const sent = await sendMessage(`desk:${guest}`, "zz Can I bring a trolley?");
    expect(sent.ok).toBe(true);
    const guestCtx = (await membershipFor((await getPlayerViewer())!, eventA))!;
    expect((await threadsFor(guestCtx)).find((t) => t.id === sent.threadId)?.title, "the guest sees the organizers").toBe("The organizers");
    await as(STAFF);
    const staffCtx = (await membershipFor((await getPlayerViewer())!, eventA))!;
    expect((await threadsFor(staffCtx)).find((t) => t.id === sent.threadId)?.title, "staff see whose desk").toBe("Robin Vale");
    expect((await sendMessage(`desk:${guest}`, "zz Yes, trolleys are fine.")).ok).toBe(true);
    await as(MEMBER);
    expect(await readThread(sent.threadId!)).toBeNull();
    expect(await refused(sendMessage(`desk:${guest}`, "zz me too"))).toBe(true);
    // A member gets the same button.
    expect((await sendMessage(`desk:${member}`, "zz Where do I park?")).ok).toBe(true);
  });

  it("A5: a guest may post twenty times in fifteen minutes; the twenty-first is refused in words, and posting never clears it", async () => {
    await asGuest();
    for (let i = 1; i <= 20; i += 1) expect((await sendMessage(`desk:${guest}`, `zz note ${i}`)).ok, `post ${i}`).toBe(true);
    const over = await sendMessage(`desk:${guest}`, "zz note 21");
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/Too many messages/);
  });

  it("A7: the organizer and a member open a direct thread with the guest; the guest reads and replies", async () => {
    await as(STAFF);
    const fromStaff = await startDirectThread([guest], "zz Robin, your tee time is 8:10.");
    expect(fromStaff.ok).toBe(true);
    await as(MEMBER);
    const people = (await messageableField((await membershipFor((await getPlayerViewer())!, eventA))!)).map((p) => p.id);
    expect(people, "a guest is reachable by id").toContain(guest);
    expect(people, "a member with no email has no key").not.toContain(noEmail);
    const fromMember = await startDirectThread([guest], "zz Fancy a practice round?");
    expect(fromMember.ok).toBe(true);
    await asGuest();
    expect((await readThread(fromStaff.threadId!))?.messages[0].body).toBe("zz Robin, your tee time is 8:10.");
    const view = await readThread(fromMember.threadId!);
    expect(view?.scopeKey, "the outward key masks every participant").toBe(`direct:~${fromMember.threadId}`);
    expect((await sendMessage(view!.scopeKey, "zz Yes please.")).ok).toBe(true);
    const stored = (await prisma.thread.findUniqueOrThrow({ where: { id: fromMember.threadId! } })).scopeKey;
    expect(stored).toContain(guestWhoKey(guest));
    // A `guest:` key never matches an email row: the member's own context holds only their own directs.
    const memberCtx = await membershipFor({ email: MEMBER, role: "player", guest: null }, eventA);
    expect(memberCtx?.whoKey).toBe(MEMBER);
    expect(await prisma.threadParticipant.count({ where: { whoKey: guestWhoKey(guest), thread: { scopeKey: { not: { contains: guestWhoKey(guest) } } } } })).toBe(0);
  });

  it("A8: the guest turns direct messages off — gone from the picker, refused in words — and back on", async () => {
    await asGuest();
    expect((await setMyMessagesOptOut(true, "player")).ok).toBe(true);
    expect((await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } })).messagesOptOut).toBe(true);
    await as(MEMBER);
    const ctx = (await membershipFor((await getPlayerViewer())!, eventA))!;
    expect((await messageableField(ctx)).map((p) => p.id)).not.toContain(guest);
    const tried = await startDirectThread([guest], "zz hello again");
    expect(tried.ok).toBe(false);
    expect(tried.error).toContain("turned off direct messages");
    // Structural threads and the desk still work.
    await asGuest();
    expect((await sendMessage(`round:${stageA}`, "zz still here")).ok).toBe(true);
    expect((await setMyMessagesOptOut(false, "player")).ok).toBe(true);
    await as(MEMBER);
    expect((await messageableField(ctx)).map((p) => p.id)).toContain(guest);
  });

  it("A9: the organizer mutes the guest — round posts refused in words, the desk still open, on the record", async () => {
    await as(STAFF);
    expect((await muteGuestInMessages(guest, true)).ok).toBe(true);
    const line = await prisma.auditLog.findFirst({ where: { eventId: eventA, action: "player-link.muted" }, orderBy: { createdAt: "desc" } });
    expect(line?.detail).toContain("muted in messages by Corin Abernethy");
    await asGuest();
    const muted = await sendMessage(`round:${stageA}`, "zz loud");
    expect(muted.ok).toBe(false);
    expect(muted.error).toMatch(/turned off your posts/);
    expect((await sendMessage(`desk:${guest}`, "zz sorry")).ok, "the desk stays open").toBe(true);
    // Refused: a player, another club's staff with this player's id, and a member's entry.
    await as(MEMBER);
    expect(await refused(muteGuestInMessages(guest, false))).toBe(true);
    await as(OTHER_STAFF);
    expect(await refused(muteGuestInMessages(guest, false))).toBe(true);
    await as(STAFF);
    expect(await refused(muteGuestInMessages(member, true))).toBe(true);
    expect((await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } })).mutedAt, "still muted").not.toBeNull();
    expect((await muteGuestInMessages(guest, false)).ok).toBe(true);
    await asGuest();
    expect((await sendMessage(`round:${stageA}`, "zz back")).ok).toBe(true);
  });

  it("A11: one browser signed in to club B and holding the guest's link for club A — the console acts as the account, the player app as the guest", async () => {
    await as(B_MEMBER);
    await holdLink(guest);
    const asAccount = await sendMessage(`round:${stageB}`, "zz from my own club");
    expect(asAccount.ok).toBe(true);
    expect((await prisma.message.findFirst({ where: { threadId: asAccount.threadId, body: "zz from my own club" } }))?.authorKey).toBe(B_MEMBER);
    const asGuestToo = await sendMessage(`round:${stageA}`, "zz as the guest");
    expect(asGuestToo.ok).toBe(true);
    expect((await prisma.message.findFirst({ where: { threadId: asGuestToo.threadId, body: "zz as the guest" } }))?.authorKey).toBe(guestWhoKey(guest));
    // Never crossed: the account cannot read the guest's desk, and the guest's context holds nothing of club B.
    const guestCtx = (await membershipFor((await getPlayerViewer())!, eventA))!;
    expect((await threadsFor(guestCtx)).map((t) => t.id)).not.toContain(asAccount.threadId);
  });
});
