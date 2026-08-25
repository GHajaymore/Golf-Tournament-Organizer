import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A refusal has to come back as a SENTENCE, not as a crash.
 *
 * Found in the browser rather than in a test: a player named a bet after a
 * fourball they were not in, picked two people, pressed the button — and the
 * screen was replaced by a Next.js runtime error. The rule was right and the
 * refusal was correct; it simply travelled as a thrown Error, which escapes a
 * server action and reaches the client as an unhandled rejection.
 *
 * The screens already know how to render `{ ok: false, error }`. Every one of
 * these actions returns that shape for a bad stake or an unknown game, and the
 * one thing that did not was the access check — the refusal a player is most
 * likely to see, because it is the one they can trigger by making an ordinary
 * mistake.
 *
 * `requirePotAccess` returning a union rather than throwing is what fixes it,
 * and the compiler enforces the handling. This file pins the OUTCOME: what a
 * caller actually gets back. A type can be widened; this cannot be satisfied
 * by anything except the action answering.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-REFUSAL";

let session: { eventId: string; email: string; viewRole: string; name: string } | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

const { saveSideGame, setSideGameEntrants } = await import("@/app/actions/side-games");
const { saveSkinsPot } = await import("@/app/actions/skins");

let eventId = "";
let stageId = "";
let otherGameId = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;

  for (const [i, who] of ["ann", "bob", "cat"].entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.ann] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.bob, player.cat] },
        ],
      }),
    },
  });
});

beforeEach(async () => {
  await prisma.sideGame.deleteMany({ where: { eventId } });
  await prisma.skinsPot.deleteMany({ where: { stageId } });
  const g = await prisma.sideGame.create({
    data: { eventId, stageId, kind: "birdies", buyInCents: 500, groupKey: "Group 2" },
  });
  otherGameId = g.id;
  session = { eventId, email: email.ann, viewRole: "player", name: "ann" };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * Ran it without letting a throw past.
 *
 * `rejects` rather than a bare await, because the whole point is the
 * difference between the two: a thrown refusal is what crashed the screen.
 */
async function outcome<T>(run: () => Promise<T>): Promise<T | { threw: string }> {
  try {
    return await run();
  } catch (e) {
    return { threw: e instanceof Error ? e.message : String(e) };
  }
}

describe("a player who is refused gets an answer, not an exception", () => {
  it("refuses another fourball's side game without throwing", async () => {
    // Ann is in Group 1. This is the exact sequence that crashed the browser.
    const r = await outcome(() => saveSideGame(stageId, "birdies", 500, "Group 2"));
    expect(r, "the action threw instead of answering").not.toHaveProperty("threw");
    expect(r).toEqual({ ok: false, error: "Only somebody in that group can run its game" });
  });

  it("refuses another fourball's skins pot without throwing", async () => {
    const r = await outcome(() =>
      saveSkinsPot(stageId, { buyInCents: 500, net: true, scope: "full", groupKey: "Group 2" }),
    );
    expect(r, "the action threw instead of answering").not.toHaveProperty("threw");
    expect(r).toEqual({ ok: false, error: "Only somebody in that group can run its game" });
  });

  it("refuses the field's game to a player without throwing", async () => {
    // The tournament's money is the committee's, and saying so is not an
    // exceptional condition.
    const r = await outcome(() => saveSideGame(stageId, "birdies", 500, ""));
    expect(r).toEqual({
      ok: false,
      error: "Only an organizer or assistant can run the field's pot",
    });
  });

  it("refuses to stake people in a game that is not the caller's", async () => {
    const r = await outcome(() => setSideGameEntrants(otherGameId, [player.ann]));
    expect(r, "the action threw instead of answering").not.toHaveProperty("threw");
    expect(r).toMatchObject({ ok: false });
  });

  it("answers rather than throwing when nobody is signed in", async () => {
    // A session can expire between loading a screen and pressing a button.
    // That is a sentence — "sign in again" — not a stack trace.
    session = null;
    const r = await outcome(() => saveSideGame(stageId, "birdies", 500, "Group 1"));
    expect(r).toEqual({ ok: false, error: "Not signed in" });
  });

  it("answers rather than throwing for a round in another tournament", async () => {
    const r = await outcome(() => saveSideGame("not-a-real-stage", "birdies", 500, "Group 1"));
    expect(r).toEqual({ ok: false, error: "Round not found" });
  });

  it("still lets the group run its OWN game", async () => {
    // Without this the file would pass on an action that refused everything.
    const r = await outcome(() => saveSideGame(stageId, "birdies", 500, "Group 1"));
    expect(r).toMatchObject({ ok: true });
  });
});
