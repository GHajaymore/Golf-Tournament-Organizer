import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * B46 AGAINST REAL ROWS: A GUEST WHO STANDS IN SCORES NO INDIVIDUAL SEASON POINTS.
 *
 * Golf Pro + Tournament Director, 12 Nov. A league week (weekly sign-up) where a typed-in guest takes an absent
 * member's place through the real Replace action, then every card is returned. The season table (`seriesTable`) must show
 *
 *   the guest stand-in       → not in the table: no individual points
 *   the absent member        → no points for the week (no card: they did not play)
 *   the pair's week          → not read here at all: the table reads individual finishing places only (the swap itself is `tee-sheet-replace.audit.test.ts`)
 *   a CSV guest who plays    → a season regular: in the table, with points
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { replaceInTeeSheet } from "@/app/actions/tee-sheet";
import { seriesTable } from "@/lib/services/series";
import { clubToday } from "@/lib/domain/club-clock";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SEASON-STANDIN";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const SAVED = "2026-11-28T18:00:00.000Z";
let orgId = "";

async function cleanup() {
  await prisma.series.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.member.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: "UTC" } })).id;
  await prisma.subscription.create({ data: { organizationId: orgId, plan: "society", status: "active" } });
});
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * One league week through the real Replace action, then every card and the season table. `mode` is the club's weekly
 * sign-up ("opt-out" asks each week; "everyone" asks nothing). `how` is who steps in for Ann: a guest CREATED by the press
 * ("new") or a season-regular guest PICKED from the field ("picked").
 */
async function season(mode: "opt-out" | "everyone", how: "new" | "picked") {
  const key = `${mode}-${how}`;
  const [y, m, d] = clubToday("UTC").split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
  const series = await prisma.series.create({ data: { organizationId: orgId, name: `${TAG} Season ${key}` } });
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, seriesId: series.id, name: `${TAG} Week ${key}`, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${key}-${Date.now()}`, status: "live", configUnlocked: false, attendanceMode: mode, format: "stroke",
    },
  });
  const eventId = event.id;
  const adminUser = await prisma.user.create({ data: { email: at(`admin-${key}`), name: `${TAG} Organizer`, password: "x", emailVerifiedAt: new Date() } });
  await prisma.account.create({ data: { eventId, email: at(`admin-${key}`), name: `${TAG} Organizer`, role: "admin" } });
  const stage = await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: tomorrow } });

  const person = async (name: string, i: number, guest: boolean) => {
    const member = await prisma.member.create({ data: { organizationId: orgId, name: `${TAG} ${name}` } });
    return (await prisma.player.create({ data: { eventId, memberId: member.id, name: `${TAG} ${name}`, email: guest ? "" : at(`${name}-${key}`), handicap: 10, seed: i, status: "confirmed", standing: guest ? "guest" : "member" } })).id;
  };
  const ann = await person("ann", 1, false); // absent
  const bob = await person("bob", 2, false);
  const cat = await person("cat", 3, false);
  const csv = await person("csvguest", 4, true); // a guest entered by CSV, plays the season
  const pick = await person("pickguest", 5, true); // a season-regular guest on the field, not on the sheet
  await prisma.stage.update({
    where: { id: stage.id },
    data: {
      teeSheetPublished: true,
      teeSheet: JSON.stringify({ savedAt: SAVED, startType: "tee", groups: [{ name: "Group 1", startHole: 1, time: "9:00 AM", playerIds: [ann, bob, cat, csv] }] }),
    },
  });
  jar.clear();
  await createSession(adminUser.id);
  await setActiveEvent(eventId);
  const done = await replaceInTeeSheet(stage.id, SAVED, ann, how === "new" ? { kind: "guest", name: `${TAG} Standin`, index: "12" } : { kind: "member", playerId: pick }, "no-show");
  expect(done.ok, JSON.stringify(done)).toBe(true);
  const subId = how === "new" ? (await prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} Standin` } })).id : pick;

  // The sub plays best of all, then Bob, Cat, the CSV guest. Ann has no card.
  const card = (per: number) => JSON.stringify(Array.from({ length: 18 }, () => per));
  for (const [pid, per] of [[subId, 3], [bob, 4], [cat, 5], [csv, 6]] as const) {
    await prisma.scorecard.create({ data: { eventId, stageId: stage.id, playerId: pid, strokes: card(per) } });
  }
  await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
  const table = await seriesTable(series.id);
  expect(table?.allowed, JSON.stringify(table?.reason)).toBe(true);
  const pts = (n: string) => table!.standings.find((s) => s.name === `${TAG} ${n}`)?.total;
  return { table: table!, pts, eventId };
}

describe("a league week where a guest stands in, read from the season table (table 100/80/65/55...)", () => {
  for (const mode of ["opt-out", "everyone"] as const) {
    it(`${mode}: a guest CREATED by Replace has no points and takes no place; members move up; the CSV guest still scores; the absentee has none`, async () => {
      const { table, pts } = await season(mode, "new");
      const names = table.standings.map((s) => s.name);
      expect(names, "the guest stand-in is in the season table").not.toContain(`${TAG} Standin`);
      expect(names, "the absentee scored for a week they did not play").not.toContain(`${TAG} ann`);
      // Among the eligible: Bob 1st = 100, Cat 2nd = 80, the CSV guest 3rd = 65 (a regular scores as one).
      expect(pts("bob")).toBe(100);
      expect(pts("cat")).toBe(80);
      expect(pts("csvguest")).toBe(65);
    });
    it(`${mode}: a season-regular guest PICKED from the field is not a stand-in and scores in full`, async () => {
      const { pts } = await season(mode, "picked");
      expect(pts("pickguest"), "a picked guest lost their points").toBe(100);
      expect(pts("bob")).toBe(80);
      expect(pts("cat")).toBe(65);
      expect(pts("csvguest")).toBe(55);
    });
  }
});
