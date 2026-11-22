import { afterEach, describe, expect, it, vi } from "vitest";
import { proposedDayWords, proposedRoundDays } from "@/lib/domain/round-dates";
import { readSource } from "./source";

/**
 * "USE THE DEFAULT" ON A LEAGUE'S ROUND WRITES THE RIGHT DAY (R4 review, 22 Nov).
 *
 * A league is made with its `endOn` at the entry window's last day (`setup-questions.ts`), so a proposal that ignored
 * "weekly" put week 2 on the day after week 1, and the Day field's "Use the default" stored it. The proposal is a
 * calendar worked by hand (a week is 7 days; 2026-10-07 is a Wednesday), and it is a DAY, not an instant: it must not move
 * with the club's zone or with how near midnight the server's clock is (`docs/claude/club-clock.md`). The page asks the
 * league question of the machine's `family`, and a source check holds it to that.
 */

const REAL_TZ = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("a league's proposed days", () => {
  it("are a week apart, however short the entry window is", () => {
    expect(proposedRoundDays("2026-10-07", "2026-10-07", 3, true)).toEqual(["2026-10-07", "2026-10-14", "2026-10-21"]);
  });

  it("cross a month and a year the calendar's way", () => {
    expect(proposedRoundDays("2026-12-23", "2026-12-23", 3, true)).toEqual(["2026-12-23", "2026-12-30", "2027-01-06"]);
  });

  it("a one-off event keeps one round a day, capped at the last day", () => {
    expect(proposedRoundDays("2026-10-10", "2026-10-11", 3, false)).toEqual(["2026-10-10", "2026-10-11", "2026-10-11"]);
  });

  // The zones are the two ends of the world (Kiritimati +14, Pago Pago -11) and the clock is a half-minute either side
  // of midnight UTC, the hour at which a helper that read the server's day would be a day out for one club or the other.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
    for (const now of ["2026-10-06T23:59:30Z", "2026-10-07T00:00:30Z"]) {
      it(`are the same days in ${zone} at ${now}`, () => {
        process.env.TZ = zone;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
        expect(proposedRoundDays("2026-10-07", "2026-10-07", 3, true)).toEqual(["2026-10-07", "2026-10-14", "2026-10-21"]);
        expect(proposedRoundDays("2026-10-07", "2026-10-08", 3, false)).toEqual(["2026-10-07", "2026-10-08", "2026-10-08"]);
      });
    }
  }

  it("are cited the league's way, and the event's way for anything else", () => {
    expect(proposedDayWords(true)).toBe("The league's first week, one round a week");
    expect(proposedDayWords(false)).toBe("The event's first day, one round a day");
  });
});

describe("the Rounds page asks the league question of the machine", () => {
  const page = readSource("src/app/(app)/stages/page.tsx");
  it("passes the status's family, through the one proposal function and the one set of words", () => {
    expect(page).toMatch(/const weekly = status\.family === "league"/);
    expect(page).toMatch(/proposedRoundDays\(state\.event\.startOn, state\.event\.endOn, playingNow\.length, weekly\)/);
    expect(page).toMatch(/proposedDayWords\(weekly\)/);
    expect(page).not.toMatch(/defaultRoundDays\(/);
  });
});
