import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cardTrustNote } from "@/lib/domain/card-trust";
import { readSource } from "./source";

/**
 * A DAY SOMEBODY READS IS THE CLUB'S DAY, WRITTEN THE CLUB'S WAY.
 *
 * Four screens took a timestamp, cut the first ten characters off its ISO
 * form, and showed that: a recorded handover on both money screens, "Card
 * checked on 2026-09-30" under every scorecard (a player's included), the day a
 * free tournament closes, and the day a cancelled plan is held until. Ten
 * characters, two faults: it is the day by the SERVER's clock — UTC, so
 * tomorrow for a club in New York from eight in the evening — and it is the
 * notation a database uses, or (passed on to `formatDay` with no locale) the
 * American one, whichever club is reading.
 *
 * Found on 2026-10-13 by reading the organizer's ledger while writing the
 * first browser test of settling up, and then swept: this is the sweep. The
 * one answer is `dayAtClubForEvent` (services/club-clock), or `clubToday` and
 * `formatDay` where there is a club and no tournament.
 *
 * What it cannot see: a day cut some other way. It finds the spelling that was
 * used four times; `a-handover-is-dated-by-the-club.audit.test.ts` holds the
 * VALUE, with clubs either side of midnight.
 */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
};
/** The first ten characters of an ISO timestamp, however the ten is spelled. */
const cutsADay = (code: string) => /toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*10\s*\)/.test(code) || /toISOString\(\)\s*\.split\(\s*["']T["']\s*\)/.test(code);

describe("no screen shows a day cut off the server's clock", () => {
  const files = walk("src");

  it("CONTROL: the sweep sees the spelling it is looking for, and reads the source", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(cutsADay("settledAt: s.settledAt.toISOString().slice(0, 10),")).toBe(true);
    expect(cutsADay('const day = at.toISOString().split("T")[0];')).toBe(true);
    expect(cutsADay("const day = clubToday(zone, at);")).toBe(false);
    expect(readSource("src/lib/services/club-clock.ts")).toContain("export async function dayAtClubForEvent(");
  });

  it("nothing in the app does it", () => {
    expect(
      files.filter((file) => cutsADay(readSource(file))),
      "a day somebody will read is the club's: use dayAtClubForEvent(eventId), or clubToday(zone, at) with formatDay(day, locale)",
    ).toEqual([]);
  });
});

describe("the day a course card was checked", () => {
  const checked = { source: "manual", verifiedAt: "2026-04-03T09:00:00.000Z", verifiedBy: "the secretary" };
  const today = new Date("2026-05-01T12:00:00Z");

  it("is written by whoever draws it, in the club's own way", () => {
    const british = (d: Date) => `the ${d.getUTCDate()}rd of April`;
    expect(cardTrustNote(checked, today, british)?.short).toBe("Card checked on the 3rd of April.");
    expect(cardTrustNote(checked, today, british)?.text).toBe("Card checked on the 3rd of April by the secretary.");
  });

  it("and with nobody to ask, is still never the form a database writes", () => {
    const note = cardTrustNote(checked, today);
    expect(note?.short).toBe("Card checked on Apr 3, 2026.");
    expect(note?.text ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // The stale sentence carries the day as well.
    const stale = cardTrustNote({ ...checked, verifiedAt: "2024-04-03T09:00:00.000Z" }, today);
    expect(stale?.warn).toBe(true);
    expect(stale?.text ?? "").toContain("last checked on Apr 3, 2024");
  });
});
