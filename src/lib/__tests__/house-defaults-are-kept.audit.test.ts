import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * EVERY HOUSE DEFAULT THE CLUB CAN SET IS KEPT, AND REACHES THE NEXT
 * TOURNAMENT (sweep 1, a1, 2026-10-10).
 *
 * The club's House defaults form is the tournament's own settings form in a
 * different mode, so it shows every setting a tournament has. Its save wrote
 * six of them. "Weekly sign-up" and "How many playing partners must confirm"
 * were shown, could be changed, were sent, and the save answered "Saved" —
 * having written neither, because the club had no column for either. Reload:
 * the old value. Next tournament: the app's default, not the club's.
 *
 * Three places each carried their own list of six — the save, the page that
 * draws the form, and `settingsForNewEvent` — so adding a setting meant
 * remembering all three, and twice nobody did. They read one map now
 * (`HOUSE_DEFAULT_COLUMNS`).
 *
 * THE RULE IS PINNED ON THE AXIS, not on the two settings that were missing:
 * every key a tournament's settings hold is either a house default that
 * round-trips, or is named below with the reason a club cannot set it once
 * for all its tournaments. A setting added later fails here until it is one
 * or the other.
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

import { createSession, setActiveEvent } from "@/lib/auth";
import { saveOrganizationDefaults } from "@/app/actions/settings";
import { settingsForNewEvent } from "@/lib/services/organization";
import {
  DEFAULT_SETTINGS,
  LEADERBOARD_VISIBILITY,
  SCORE_ENTRY_BY,
  SCORE_ENTRY_WINDOW,
  PLAYER_ACCESS,
  SCORE_APPROVAL,
  ATTEST_BY,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import { ATTENDANCE_MODES } from "@/lib/domain/attendance";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-HOUSEDEFAULTS";
const EMAIL = `${TAG}.owner@example.invalid`.toLowerCase();

/**
 * Settings a club does NOT set once for every tournament, and why. Anything
 * not here must round-trip.
 */
const NOT_A_HOUSE_DEFAULT: Partial<Record<keyof TournamentSettings, string>> = {
  teePolicy:
    "Asked beside a tournament's own tees and hidden when its course has none on file — the House defaults form never shows it.",
};

/** A value for each setting that is NOT the app's default, so a save that does nothing shows. */
const OFF_DEFAULT: Record<keyof TournamentSettings, readonly unknown[]> = {
  leaderboardVisibility: LEADERBOARD_VISIBILITY,
  scoreEntryBy: SCORE_ENTRY_BY,
  scoreEntryWindow: SCORE_ENTRY_WINDOW,
  voiceEntry: [true, false],
  playerAccess: PLAYER_ACCESS,
  scoreApproval: SCORE_APPROVAL,
  attestBy: ATTEST_BY,
  attendanceMode: ATTENDANCE_MODES,
  teePolicy: [],
};

let orgId = "";
let eventId = "";
let userId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
  eventId = (
    await prisma.event.create({
      data: { organizationId: orgId, name: `${TAG} medal`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}` },
    })
  ).id;
  userId = (await prisma.user.create({ data: { email: EMAIL, name: "Owner", password: "x:unusable" } })).id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role: "owner" } });
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("every house default is kept, and reaches the next tournament", () => {
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof TournamentSettings)[];

  it("CONTROL: the sweep covers the settings there are, and exempts only what it names", () => {
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const key of Object.keys(NOT_A_HOUSE_DEFAULT)) expect(keys).toContain(key);
  });

  for (const key of keys) {
    if (NOT_A_HOUSE_DEFAULT[key]) continue;
    const value = OFF_DEFAULT[key].find((v) => v !== DEFAULT_SETTINGS[key]);

    it(`${key}: saved as ${String(value)}, a new tournament starts with ${String(value)}`, async () => {
      expect(value, `no off-default value to try for ${key}`).not.toBeUndefined();
      expect(await saveOrganizationDefaults({ [key]: value })).toEqual({ ok: true });
      const fresh = await settingsForNewEvent(orgId);
      expect(fresh[key]).toBe(value);
      // And back, so each case starts from the app's defaults and a value
      // left behind by the one before cannot pass this one.
      expect(await saveOrganizationDefaults({ [key]: DEFAULT_SETTINGS[key] })).toEqual({ ok: true });
      expect((await settingsForNewEvent(orgId))[key]).toBe(DEFAULT_SETTINGS[key]);
    });
  }
});
