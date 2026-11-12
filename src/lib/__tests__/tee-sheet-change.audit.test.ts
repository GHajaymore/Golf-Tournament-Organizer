import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE TEE-SHEET RULE ON REAL ROWS (J12, state machine PR 7c), through the real
 * actions and real sessions, at the SERVER (a button the screen drew shut proves
 * nothing about the endpoint):
 *
 *   a COMPLETED tournament   → every tee-sheet action is refused with the same sentence and the
 *                              way out; the stored sheet and its published flag are byte-identical
 *                              and Recent changes has no new line;
 *   a PUBLISHED sheet        → a re-save is made, says how many players were told, tells exactly
 *                              the player whose time moved (the push rail is watched), and writes one
 *                              Recent changes line by count, no name in it;
 *   a round WITH SCORES      → a re-draw that changes the group with a card in is refused; one that
 *                              keeps it and moves the rest is made; a move in a group not yet started
 *                              is made; a LATER round's sheet is its own, open;
 *   taking the sheet back    → says it hid the sheet; nobody is told.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/tee-sheet-change.audit.test.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
const pushed = vi.hoisted(() => ({ emails: [] as string[] }));
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/push")>()),
  sendPushToEmails: async (emails: string[]) => void pushed.emails.push(...emails),
}));

import { createSession, setActiveEvent } from "@/lib/auth";
import { moveInTeeSheet, placeInTeeGroup, replaceInTeeSheet, saveTeeSheet, setTeeSheetPublished } from "@/app/actions/tee-sheet";
import { COMPLETED_TEE_SHEET } from "@/lib/domain/tee-sheet-change";
import { clubToday } from "@/lib/domain/club-clock";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TEESHEETCHANGE";
const ZONE = "UTC";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let assistantId = "";
let eventId = "";
let stageId = "";
let laterId = "";
const ids: Record<string, string> = {};
const KEYS = ["ann", "bob", "cat", "dan", "eve", "fay", "gus", "hal", "ivy"];
const SAVED = "2026-11-28T18:00:00.000Z";

const clubDayFrom = (n: number) => {
  const [y, m, d] = clubToday(ZONE).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function asAssistant() {
  jar.clear();
  await createSession(assistantId);
  await setActiveEvent(eventId);
}

const row = () => prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { teeSheet: true, teeSheetPublished: true } });
const lines = async () => (await prisma.auditLog.findMany({ where: { eventId, action: "tee-sheet.changed" }, orderBy: { createdAt: "asc" } })).map((l) => l.detail);
const draft = (groups: string[][], times = ["8:00 AM", "8:10 AM", "8:20 AM"]) => ({
  savedAt: "",
  startType: "tee",
  groups: groups.map((g, i) => ({ name: `Group ${i + 1}`, startHole: 1, time: times[i], playerIds: g.map((k) => ids[k]) })),
});

async function reset(published = true) {
  await prisma.scorecard.deleteMany({ where: { eventId } });
  await prisma.event.update({ where: { id: eventId }, data: { status: "live" } });
  await prisma.auditLog.deleteMany({ where: { eventId, action: "tee-sheet.changed" } });
  await prisma.stage.update({
    where: { id: stageId },
    data: { playedOn: clubDayFrom(1), teeSheetPublished: published, teeSheet: JSON.stringify({ ...draft([["ann", "bob", "cat", "dan"], ["eve", "fay", "gus"], ["hal", "ivy"]]), savedAt: SAVED }) },
  });
  pushed.emails.length = 0;
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: ZONE } });
  orgId = org.id;
  assistantId = (await prisma.user.create({ data: { email: at("assistant"), name: `${TAG} Assistant`, password: "x", emailVerifiedAt: new Date() } })).id;
  const e = await prisma.event.create({
    data: { organizationId: orgId, name: `${TAG} medal`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${Date.now()}`, status: "live", configUnlocked: false },
  });
  eventId = e.id;
  stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: clubDayFrom(1) } })).id;
  laterId = (await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: clubDayFrom(8) } })).id;
  await prisma.account.create({ data: { eventId, email: at("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
  for (const [i, key] of KEYS.entries()) {
    ids[key] = (await prisma.player.create({ data: { eventId, name: `${TAG} ${key}`, email: at(key), handicap: 10 + i, seed: i + 1, status: "confirmed" } })).id;
  }
});

beforeEach(async () => {
  await reset();
  await asAssistant();
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a completed tournament's sheet is final, at the server", () => {
  it("refuses every tee-sheet action with the one sentence, and writes nothing", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
    const before = await row();
    const results = [
      await saveTeeSheet(stageId, draft([["ann", "bob", "cat", "dan"], ["eve", "fay", "gus", "hal", "ivy"]]), true),
      await saveTeeSheet(stageId, draft([["ann", "bob", "cat", "dan"], ["eve", "fay", "gus", "hal", "ivy"]]), false),
      await setTeeSheetPublished(stageId, true),
      await setTeeSheetPublished(stageId, false),
      await placeInTeeGroup(stageId, ids.ann, 0),
      await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.hal, toGroup: 1 }]),
      await replaceInTeeSheet(stageId, SAVED, ids.ann, { kind: "member", playerId: ids.ivy }, "no-show"),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, error: COMPLETED_TEE_SHEET });
    // The database, not only the answer: a refusal that still wrote would satisfy every line above.
    expect(await row()).toEqual(before);
    expect(await lines()).toEqual([]);
    expect(pushed.emails).toEqual([]);
  });
});

describe("a published sheet is changed and the change is said", () => {
  it("a re-save that moves one player tells that player and nobody else, and says so", async () => {
    // Hal (Group 3, 8:20) moves to Group 2 (8:10): the only time that changes.
    const res = await saveTeeSheet(stageId, draft([["ann", "bob", "cat", "dan"], ["eve", "fay", "gus", "hal"], ["ivy"]]), true);
    expect(res).toEqual({ ok: true, warning: "Players were already sent their times. 1 player has been told of the change." });
    expect(pushed.emails).toEqual([at("hal")]);
    expect((await row()).teeSheetPublished).toBe(true);
    const written = await lines();
    expect(written).toEqual(["Round 1 tee sheet changed after publish: 1 player re-told."]);
    expect(written[0]).not.toContain(TAG);
  });

  it("a move says it too, in the same words, and tells the moved player", async () => {
    const res = await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.hal, toGroup: 1 }]);
    expect(res.ok).toBe(true);
    expect(res.said).toContain("Players were already sent their times. 1 player has been told of the change.");
    expect(pushed.emails).toEqual([at("hal")]);
  });

  it("an unpublished sheet changes with no warning, no line, no push", async () => {
    await reset(false);
    const res = await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.hal, toGroup: 1 }]);
    expect(res).toEqual({ ok: true, said: "The sheet is saved with your changes." });
    expect(await lines()).toEqual([]);
    expect(pushed.emails).toEqual([]);
  });

  it("taking the sheet back says it hid the sheet, and tells nobody", async () => {
    const res = await setTeeSheetPublished(stageId, false);
    expect(res).toEqual({ ok: true, warning: "Players were already sent their times. The sheet is now hidden from them, and nobody is told." });
    expect((await row()).teeSheetPublished).toBe(false);
    expect(pushed.emails).toEqual([]);
  });
});

describe("a round with scores keeps its started groups, and nothing else", () => {
  it("a re-draw that changes the group with a card in is refused, in words, nothing written", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.hal, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    const before = await row();
    const res = await saveTeeSheet(stageId, draft([["ann", "bob", "cat", "dan"], ["eve", "fay", "gus", "hal"], ["ivy"]]), true);
    expect(res).toEqual({ ok: false, error: "Group 3 has a card in. Its players, time and hole stay as they are. Change the groups that have not started." });
    expect(await row()).toEqual(before);
  });

  it("a re-draw that keeps it and moves the rest is made", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.hal, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    const res = await saveTeeSheet(stageId, draft([["ann", "bob", "cat"], ["dan", "eve", "fay", "gus"], ["hal", "ivy"]]), true);
    expect(res.ok).toBe(true);
    expect(JSON.parse((await row()).teeSheet).groups[0].playerIds).toEqual([ids.ann, ids.bob, ids.cat]);
  });

  it("a move in a group that has not started is made, and the group with the card is held by its own lock", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.hal, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    expect((await moveInTeeSheet(stageId, SAVED, [{ kind: "group", from: 1, to: 0 }])).ok).toBe(true);
    await reset();
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.hal, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.hal, toGroup: 1 }])).toEqual({ ok: false, error: "Group 3 has a card in. Nobody moves out of it." });
  });

  it("a later round's sheet is its own, and open while this one has scores", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.hal, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    const res = await saveTeeSheet(laterId, draft([["ann", "bob", "cat", "dan"], ["eve", "fay", "gus", "hal", "ivy"]]), false);
    expect(res).toEqual({ ok: true });
  });
});
