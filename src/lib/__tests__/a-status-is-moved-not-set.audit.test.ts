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

const { setEventStatus, launchTournament } = await import("@/app/actions/tournament");

let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * A tournament at `status`, with the secretary on it; `ready` says whether it
 * could be launched. `players` is how many are entered when it is ready: a
 * knockout needs two (Golf Pro, panel 8.2), which the action asks since the
 * state machine's PR 4.
 */
async function tournament(name: string, status: string, ready = false, players = 2) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} ${name}`, status, dates: ready ? "Saturday" : "", course: "", city: "", address: "",
      regDeadline: "", shareToken: `${TAG}-${name}-${process.pid}`, configUnlocked: true,
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  if (ready) {
    // Match play needs no course card, so the launch gate asks only for a
    // round, somebody in the field and a date. A knockout, since an undrawn
    // round robin has no matches to score and launch refuses it (gap G3).
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
    for (let i = 0; i < players; i += 1) {
      await prisma.player.create({ data: { eventId: event.id, name: `${TAG} player ${i + 1}`, email: `${TAG}.p${i}@example.invalid`.toLowerCase(), handicap: 10, seed: i + 1, status: "confirmed" } });
    }
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
    const id = await tournament("ready", "draft", true);
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

describe("the move is asked of the state machine, as the dashboard's button is (PR 4)", () => {
  it("a knockout of ONE is refused at both doors, in the button's words — the old gate let it go live", async () => {
    const id = await tournament("knockout-of-one", "draft", true, 1);
    const words = "A knockout needs at least two players, and only one is entered. Add more on Entries, then launch.";
    expect(await setEventStatus("live")).toEqual({ ok: false, error: words });
    expect(await launchTournament()).toEqual({ ok: false, error: words });
    expect((await read(id))?.status).toBe("draft");
  });

  it("a launched tournament is not launched again — which re-stamped it and locked setup an organizer had unlocked", async () => {
    const id = await tournament("launched-twice", "live", true);
    await prisma.event.update({ where: { id }, data: { configUnlocked: true } });
    const res = await launchTournament();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("This tournament has already been launched, so there is nothing to launch.");
    expect((await read(id))?.configUnlocked, "a second launch locked setup again").toBe(true);
  });

  it("a draft is not completed by this door — there is nothing to complete until it is launched", async () => {
    const id = await tournament("complete-a-draft", "draft", true);
    const res = await setEventStatus("completed");
    expect(res).toEqual({ ok: false, error: "This tournament hasn’t been launched yet, so there is nothing to complete. Launch it from the dashboard first." });
    expect((await read(id))?.status).toBe("draft");
  });

  it("a completed tournament is not completed twice, and 'live' on a live one is not a reopen", async () => {
    await tournament("complete-twice", "completed", true);
    expect((await setEventStatus("completed")).error).toBe("This tournament is already completed. To change a result, reopen it on the dashboard.");
    const live = await tournament("reopen-a-live-one", "live", true);
    expect((await setEventStatus("live")).error).toBe("This tournament isn’t completed, so there is nothing to reopen.");
    expect((await read(live))?.status).toBe("live");
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
    for (const to of ["draft"]) {
      it(`${from} to ${to} is refused, and says what to use instead`, async () => {
        const id = await tournament(`${from}-${to}`, from);
        const res = await setEventStatus(to);
        expect(res.ok).toBe(false);
        expect(res.error ?? "").toMatch(/committee correction/);
        expect((await read(id))?.status).toBe(from);
      });
    }
  }

  it("CONTROL: before launch there is one Setting up step, so moves between its stored values are refused (G1)", async () => {
    // Ajay, 2026-10-31: draft, registration and ready read as one, and the bar
    // offers Launch only. A move between them gates nothing, so it is refused
    // and the stored value stays — the refusal is NOT the launched one.
    const id = await tournament("setting-up", "draft");
    const res = await setEventStatus("draft");
    expect(res.ok, "draft was written").toBe(false);
    expect(res.error ?? "").toMatch(/one Setting up step/);
    expect(res.error ?? "").not.toMatch(/committee correction/);
    // The old ladder's two later words are not statuses since A045 (state machine PR 8): refused as
    // unknown words, and nothing is written.
    for (const to of ["registration", "ready"]) {
      const old = await setEventStatus(to);
      expect(old.ok, `${to} was written`).toBe(false);
      expect(old.error ?? "").toMatch(/not a tournament status/);
    }
    expect((await read(id))?.status).toBe("draft");
  });
});
