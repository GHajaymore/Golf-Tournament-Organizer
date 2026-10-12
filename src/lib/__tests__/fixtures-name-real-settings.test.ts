import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import {
  ATTEST_BY,
  LEADERBOARD_VISIBILITY,
  PLAYER_ACCESS,
  SCORE_APPROVAL,
  SCORE_ENTRY_BY,
  SCORE_ENTRY_WINDOW,
  TEE_POLICY,
} from "@/lib/tournament-settings";
import { ATTENDANCE_MODES } from "@/lib/domain/attendance";

/**
 * A FIXTURE NAMES A SETTING VALUE THE APP ACTUALLY HAS (2026-10-11).
 *
 * Four audit tests set `teePolicy: "single"` under the comment "Everyone off
 * the one set of tees". There is no such policy. Every reader falls back to
 * the default for a value it does not know, and the default is `own` — so each
 * of those tests exercised "the organizer assigns each player's tees" while
 * saying it was testing the ordinary medal. Two render fixtures did the same
 * with five settings at once, behind an `as any`.
 *
 * Nothing failed, which is the point: a fixture holding a value the app cannot
 * store tests a state no club can be in, and passes.
 *
 * So every literal value of a list-valued tournament setting, in every test,
 * spec and script, is one the list holds.
 */
const SETTINGS: Record<string, readonly string[]> = {
  teePolicy: TEE_POLICY,
  attendanceMode: ATTENDANCE_MODES,
  attestBy: ATTEST_BY,
  leaderboardVisibility: LEADERBOARD_VISIBILITY,
  scoreEntryBy: SCORE_ENTRY_BY,
  scoreEntryWindow: SCORE_ENTRY_WINDOW,
  scoreApproval: SCORE_APPROVAL,
  playerAccess: PLAYER_ACCESS,
};

/**
 * Where a value outside the list is the subject: the cleaner's own test hands
 * it nonsense to prove nonsense is turned away.
 */
const HANDS_OVER_NONSENSE_ON_PURPOSE = ["src/lib/__tests__/tournament-settings.test.ts"];

function filesUnder(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = `${dir}/${name}`;
    if (statSync(join(process.cwd(), path)).isDirectory()) filesUnder(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

const isCode = (p: string) => p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".mjs");
const FIXTURES = [
  ...filesUnder("src", (p) => isCode(p) && p.includes("__tests__/")),
  ...filesUnder("e2e", isCode),
  ...filesUnder("scripts", isCode),
].filter((p) => !HANDS_OVER_NONSENSE_ON_PURPOSE.includes(p) && !p.endsWith("fixtures-name-real-settings.test.ts"));

function strays(source: string): string[] {
  const found: string[] = [];
  for (const [key, allowed] of Object.entries(SETTINGS)) {
    for (const piece of source.split(`${key}: "`).slice(1)) {
      const value = piece.slice(0, piece.indexOf('"'));
      // `defaultTeePolicy` and its like are the club's column for the setting
      // (`HOUSE_DEFAULT_COLUMNS`), not a value of it.
      if (value.toLowerCase() === `default${key}`.toLowerCase()) continue;
      if (!allowed.includes(value)) found.push(`${key}: "${value}"`);
    }
  }
  return found;
}

describe("a fixture's tournament settings", () => {
  it("are values the app can store", () => {
    const wrong = FIXTURES.flatMap((file) => strays(readSource(...file.split("/"))).map((s) => `${file} — ${s}`));
    expect(wrong).toEqual([]);
  });

  it("CONTROL: the sweep reads the files that set them, and knows a stray when it sees one", () => {
    expect(FIXTURES.length).toBeGreaterThan(400);
    const setting = FIXTURES.filter((file) => readSource(...file.split("/")).includes('teePolicy: "'));
    expect(setting.length, "no fixture sets a tee policy — the sweep is reading nothing").toBeGreaterThanOrEqual(5);
    expect(setting).toContain("src/lib/__tests__/board-handicaps.audit.test.ts");
    expect(strays('const e = { teePolicy: "single", attestBy: "marker", attendanceMode: "optin" };')).toEqual([
      'teePolicy: "single"',
      'attendanceMode: "optin"',
    ]);
  });
});
