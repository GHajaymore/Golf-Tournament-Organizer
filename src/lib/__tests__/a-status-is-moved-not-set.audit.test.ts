import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TOURNAMENT'S STATUS IS MOVED, NOT SET (sweep 1, c6, 2026-10-10).
 *
 * The lifecycle bar offers five moves: start taking entries, mark ready,
 * launch, complete, reopen. `setEventStatus` took any string from any staff
 * caller and wrote it — and it is a `"use server"` export, so "any caller" is
 * a browser with a session and nothing more.
 *
 *   "live" on a draft        went live with no rounds and nobody in it: the
 *                            launch gate (`launchRefusal`) was never asked,
 *                            `launchedAt` stayed empty, setup stayed unlocked
 *   anything unrecognised    was read as "draft" — so a typo took a tournament
 *                            being played back to setting up, off its members'
 *                            screens, and unlocked its structure
 *   "draft" on a live one    the same, on purpose
 *
 * Launching is one act with one gate, whichever door it is asked through. A
 * status nobody recognises is refused, not guessed at. And a tournament that
 * has been launched does not go back to setting up: correcting it is what
 * Unlock setup is for, and its members keep seeing it while that happens.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STATUSMOVE";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setEventStatus } = await import("@/app/actions/tournament");

let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A tournament at `status`, with the secretary on it; `ready` says whether it could be launched. */
async function tournament(name: string, status: string, ready = false) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} ${name}`, status, dates: ready ? "Saturday" : "", course: "", city: "", address: "",
      regDeadline: "", shareToken: `${TAG}-${name}-${process.pid}`, configUnlocked: true,
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  if (ready) {
    // Match play needs no course card, so the launch gate asks only for a
    // round, somebody in the field and a date.
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", holes: 18 } });
    await prisma.player.create({ data: { eventId: event.id, name: `${TAG} player`, email: `${TAG}.p@example.invalid`.toLowerCase(), handicap: 10, seed: 1, status: "confirmed" } });
  }
  session.eventId = event.id;
  return event.id;
}

const read = (id: string) => prisma.event.findUnique({ where: { id }, select: { status: true, launchedAt: true, configUnlocked: true } });

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("going live is launching, whichever door asks", () => {
  it("refuses an empty tournament, with the launch gate's own reason", async () => {
    const id = await tournament("empty", "draft");
    const res = await setEventStatus("live");
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toMatch(/no rounds yet/i);
    expect((await read(id))?.status).toBe("draft");
  });

  it("launches a tournament that can be launched: stamped and locked", async () => {
    const id = await tournament("ready", "ready", true);
    expect(await setEventStatus("live")).toEqual({ ok: true });
    const after = await read(id);
    expect(after?.status).toBe("live");
    expect(after?.launchedAt, "went live without a launch time").not.toBeNull();
    expect(after?.configUnlocked, "went live with its setup still unlocked").toBe(false);
  });

  it("CONTROL: reopening a finished tournament is not a launch, and is still allowed", async () => {
    const id = await tournament("finished", "completed");
    expect(await setEventStatus("live")).toEqual({ ok: true });
    expect((await read(id))?.status).toBe("live");
  });
});

describe("a status nobody recognises is refused, not read as draft", () => {
  for (const sent of ["LIVE", "archived", "", "constructor"]) {
    it(`"${sent}" on a live tournament changes nothing`, async () => {
      const id = await tournament(`unknown-${sent || "blank"}`, "live");
      const res = await setEventStatus(sent);
      expect(res.ok).toBe(false);
      expect((await read(id))?.status).toBe("live");
    });
  }
});

describe("a launched tournament does not go back to setting up", () => {
  for (const from of ["live", "completed"]) {
    for (const to of ["draft", "registration", "ready"]) {
      it(`${from} to ${to} is refused, and says what to use instead`, async () => {
        const id = await tournament(`${from}-${to}`, from);
        const res = await setEventStatus(to);
        expect(res.ok).toBe(false);
        expect(res.error ?? "").toMatch(/Unlock setup/);
        expect((await read(id))?.status).toBe(from);
      });
    }
  }

  it("CONTROL: the moves the bar offers before launch still work, in both directions", async () => {
    const id = await tournament("setting-up", "draft");
    expect(await setEventStatus("registration")).toEqual({ ok: true });
    expect(await setEventStatus("ready")).toEqual({ ok: true });
    expect((await read(id))?.status).toBe("ready");
    // Not offered as a button, and harmless: nothing has been published yet.
    expect(await setEventStatus("draft")).toEqual({ ok: true });
    expect((await read(id))?.status).toBe("draft");
  });
});
