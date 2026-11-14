import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * PLAY SUSPENDED REACHES A ROUND CODE'S PHONE (2026-11-14, safety sweep G-1;
 * Rule 5.7a).
 *
 * `/play` is the phone a group's scorer keeps the whole group's card on, and
 * the door a player with no email is sent to. It drew no banner and mounted no
 * siren, and the siren's poll (`currentPlayStatus`) asked `getSession()`, which
 * a round-code phone does not hold: it read "not suspended" every 20 seconds
 * through a lightning suspension. Against real rows:
 *
 *   - a round-code phone, no account, the player with NO email: suspended, then
 *     resumed, in the round its code opened
 *   - a phone signed in to club B's tournament that also holds club A's round
 *     code: each kind of screen is asked about its own round, never the other's
 *   - a reissued code is no longer anybody's round, suspended or not
 *   - anything else a client sends as the screen is read as the player app
 *   - nobody: never suspended
 *
 * Fixtures: `zz-siren-code` clubs, invented names, `@example.invalid`, deleted
 * in `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/the-siren-reaches-a-round-code.audit.test.ts
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
import { createPlaySession } from "@/lib/play-auth";
import { currentPlayStatus } from "@/app/actions/play-status";
import { playStatusForScreen } from "@/lib/services/play-status-screen";

const prisma = new PrismaClient();
const MARK = "zz-siren-code";
const MEMBER_EMAIL = `${MARK}-member@example.invalid`;

let aEvent = "";
let aStage = "";
let aCode = "";
let bEvent = "";
let holder = "";
let memberUserId = "";

async function clubWithEvent(name: string, playerAccess: "code" | "email") {
  const org = await prisma.organization.create({ data: { name: `${MARK} ${name}`, kind: "club", timeZone: "UTC" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${name} Medal`,
      organizationId: org.id,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      playerAccess,
      shareToken: `${MARK}-${name.replace(/\W/g, "")}-${Date.now()}`,
    },
    select: { id: true },
  });
  const code = playerAccess === "code" ? `ZS${Math.random().toString(36).slice(2, 8).toUpperCase()}` : "";
  const st = await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", accessCode: code },
    select: { id: true },
  });
  return { eventId: ev.id, stageId: st.id, code };
}

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

const suspend = (eventId: string, note: string) =>
  prisma.event.update({ where: { id: eventId }, data: { playSuspendedAt: new Date(), playSuspendedNote: note } });
const resume = (eventId: string) => prisma.event.update({ where: { id: eventId }, data: { playSuspendedAt: null, playSuspendedNote: "" } });

describe("the suspension reaches a round code's phone (G-1)", () => {
  beforeAll(async () => {
    await cleanUp();
    const a = await clubWithEvent("Fennick Heath", "code");
    aEvent = a.eventId;
    aStage = a.stageId;
    aCode = a.code;
    bEvent = (await clubWithEvent("Oxlow Vale", "email")).eventId;
    // The round-code holder has no email at all: the player the 7 Nov ruling sends to the cart's QR.
    const h = await prisma.player.create({
      data: { eventId: aEvent, name: "Tamsin Reedbourne", email: "", status: "confirmed", handicap: 14, seed: 1 },
      select: { id: true },
    });
    holder = h.id;
    const member = await prisma.user.create({ data: { email: MEMBER_EMAIL, name: "Ilsa Marrow", password: "x:unusable", emailVerifiedAt: new Date() } });
    memberUserId = member.id;
    await prisma.account.create({ data: { eventId: bEvent, name: "Ilsa Marrow", email: MEMBER_EMAIL, role: "player" } });
    await prisma.player.create({ data: { eventId: bEvent, name: "Ilsa Marrow", email: MEMBER_EMAIL, status: "confirmed", handicap: 9, seed: 1 } });
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
    await resume(aEvent);
    await resume(bEvent);
  });

  it("a round-code phone with no account hears it, and hears it lifted", async () => {
    await createPlaySession(aStage, holder, aCode);
    expect(await currentPlayStatus("play"), "CONTROL: suspended before anybody suspended it").toEqual({ suspended: false, note: "" });

    await suspend(aEvent, "Lightning within five miles");
    expect(await currentPlayStatus("play"), "the /play poll did not hear the committee stop play").toEqual({
      suspended: true,
      note: "Lightning within five miles",
    });
    // The banner /play draws asks the same function, and is told the same round.
    expect(await playStatusForScreen("play")).toEqual({ suspended: true, note: "Lightning within five miles", eventId: aEvent });

    await resume(aEvent);
    expect(await currentPlayStatus("play"), "the /play poll did not hear play resume").toEqual({ suspended: false, note: "" });
  });

  it("each kind of screen is asked about its own round, on a phone holding both", async () => {
    expect(await createSession(memberUserId), "the fixture member could not sign in").toBe(true);
    await createPlaySession(aStage, holder, aCode);

    await suspend(bEvent, "Fog");
    expect((await currentPlayStatus("player")).suspended, "the player app missed its own tournament's suspension").toBe(true);
    expect((await currentPlayStatus("play")).suspended, "/play reported another club's suspension as its round's").toBe(false);

    await resume(bEvent);
    await suspend(aEvent, "Lightning");
    expect((await currentPlayStatus("play")).suspended, "/play missed its round's suspension beside a signed-in member").toBe(true);
    expect((await currentPlayStatus("player")).suspended, "the player app reported the round code's round as its own").toBe(false);
    expect((await playStatusForScreen("player")).eventId).toBe(bEvent);
    expect((await playStatusForScreen("play")).eventId).toBe(aEvent);
  });

  it("a reissued code is nobody's round any more, suspended or not", async () => {
    await createPlaySession(aStage, holder, aCode);
    await suspend(aEvent, "Lightning");
    expect((await currentPlayStatus("play")).suspended).toBe(true);
    await prisma.stage.update({ where: { id: aStage }, data: { accessCode: `${aCode}X` } });
    try {
      expect(await playStatusForScreen("play")).toEqual({ suspended: false, note: "", eventId: null });
    } finally {
      await prisma.stage.update({ where: { id: aStage }, data: { accessCode: aCode } });
    }
  });

  it("the client names a kind of screen, never an event: anything else is the player app", async () => {
    await createPlaySession(aStage, holder, aCode);
    await suspend(aEvent, "Lightning");
    // With no account, the player app has no round, whatever the client sends.
    for (const forged of [undefined, "", "PLAY", aEvent, { screen: "play" }, ["play"]]) {
      expect((await currentPlayStatus(forged)).suspended, `screen ${JSON.stringify(forged)} reached the round code's round`).toBe(false);
    }
  });

  it("nobody is never suspended", async () => {
    await suspend(aEvent, "Lightning");
    await suspend(bEvent, "Fog");
    expect(await currentPlayStatus("play")).toEqual({ suspended: false, note: "" });
    expect(await currentPlayStatus("player")).toEqual({ suspended: false, note: "" });
  });
});
