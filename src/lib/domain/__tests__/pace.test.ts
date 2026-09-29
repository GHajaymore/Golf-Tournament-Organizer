import { describe, it, expect } from "vitest";
import { holesEntered, hoursAndMinutes, minutesPerHole, paceOfPlay, teeInstant } from "../pace";

/**
 * Pace of play is judged against each group's OWN schedule — its tee time plus
 * a fixed allowance a hole — and the fixture below is built so each wrong
 * reading gives a different answer: a four-ball at the default 4h 15m is
 * allowed exactly 255/18 = 14.1666… minutes a hole.
 */
const DAY = "2026-09-28";
const at = (h: number, m: number) => new Date(2026, 8, 28, h, m);
const PER_HOLE = 255 / 18;

const one = (thru: number, now: Date, size = 4, holes = 18) =>
  paceOfPlay({ playedOn: DAY, holes, paceMinutes: 0, groups: [{ name: "G1", time: "8:00 AM", size, thru }], now })[0];

describe("reading a tee time", () => {
  it("takes the ways a sheet writes it, on the round's day, in local time", () => {
    expect(teeInstant(DAY, "8:10 AM")).toEqual(at(8, 10));
    expect(teeInstant(DAY, "8:10am")).toEqual(at(8, 10));
    expect(teeInstant(DAY, "1:30 PM")).toEqual(at(13, 30));
    expect(teeInstant(DAY, "14:30")).toEqual(at(14, 30));
    // The two that catch out a naive 12-hour parser.
    expect(teeInstant(DAY, "12:05 PM")).toEqual(at(12, 5));
    expect(teeInstant(DAY, "12:05 AM")).toEqual(at(0, 5));
  });

  it("is no time when there is nothing to read", () => {
    expect(teeInstant(DAY, "")).toBeNull();
    expect(teeInstant(DAY, "morning")).toBeNull();
    expect(teeInstant(DAY, "13:10 PM")).toBeNull();
    expect(teeInstant("", "8:10 AM")).toBeNull();
  });
});

describe("the time allowed", () => {
  it("is the four-ball target over eighteen, less for a smaller group", () => {
    expect(minutesPerHole(0, 4)).toBeCloseTo(PER_HOLE);
    expect(minutesPerHole(240, 4)).toBeCloseTo(240 / 18);
    expect(minutesPerHole(0, 3)).toBeLessThan(minutesPerHole(0, 4));
    expect(minutesPerHole(0, 2)).toBeLessThan(minutesPerHole(0, 3));
    expect(hoursAndMinutes(255)).toBe("4h 15m");
    expect(hoursAndMinutes(185)).toBe("3h 05m");
  });
});

describe("is a group keeping up", () => {
  it("before its tee time it has not started, and is not late", () => {
    const r = one(0, at(7, 55));
    expect(r.state).toBe("not-started");
    expect(r.behind).toBe(0);
  });

  it("on the first hole, within the time allowed for it, it is on pace", () => {
    expect(one(0, at(8, 14)).state).toBe("on-pace");
  });

  it("exactly on schedule after six holes it is on pace", () => {
    // Six holes done at 8:00 + 6 x 14.17 = 9:25; they are allowed the 7th.
    expect(one(6, at(9, 30)).state).toBe("on-pace");
  });

  it("once the time allowed for the hole it is on runs out, it is behind by the overrun", () => {
    // Thru 6 should be thru 7 by 8:00 + 7 x 14.17 = 9:39.2; at 9:44 that is 4 minutes over.
    const r = one(6, at(9, 44));
    expect(r.state).toBe("behind");
    expect(r.behind).toBe(4);
  });

  it("ten minutes over is out of position", () => {
    const r = one(6, at(9, 50));
    expect(r.state).toBe("out-of-position");
    expect(r.behind).toBe(10);
  });

  it("a three-ball is allowed less, so the same card at the same time is further behind", () => {
    expect(one(6, at(9, 44), 3).behind).toBeGreaterThan(one(6, at(9, 44), 4).behind);
  });

  it("a finished group is finished, however late, and says when it was due", () => {
    const r = one(18, at(15, 0));
    expect(r.state).toBe("finished");
    expect(r.dueIn).toEqual(new Date(at(8, 0).getTime() + 255 * 60_000));
  });

  it("long after it was due in, a group short of holes is cards to chase, not slow play", () => {
    // Due in at 12:15; at 13:40 it is 85 minutes over and still measured…
    expect(one(12, at(13, 40)).state).toBe("out-of-position");
    // …and at 13:50, 95 minutes over, nobody is out there to hurry.
    const r = one(12, at(13, 50));
    expect(r.state).toBe("overdue");
    expect(r.behind).toBe(0);
  });

  it("nothing entered after three holes' time is a group not entering, not one stuck on the 1st", () => {
    // Three holes is 42.5 minutes: at 8:40 a blank group could still be on the 3rd…
    expect(one(0, at(8, 40)).state).toBe("out-of-position");
    // …at 8:45 it cannot be measured, and is not priced at 45 minutes late.
    const r = one(0, at(8, 45));
    expect(r.state).toBe("no-scores");
    expect(r.behind).toBe(0);
    // CONTROL: one hole entered and it is measured again, honestly late —
    // 45 minutes out, two holes' time is 28.3, so 16 minutes over.
    expect(one(1, at(8, 45))).toMatchObject({ state: "out-of-position", behind: 16 });
  });

  it("a nine-hole round finishes at nine", () => {
    expect(one(9, at(11, 0), 4, 9).state).toBe("finished");
  });

  it("a group with no time on the sheet is left unmeasured rather than guessed", () => {
    const [r] = paceOfPlay({
      playedOn: DAY,
      holes: 18,
      paceMinutes: 0,
      groups: [{ name: "G9", time: "", size: 4, thru: 3 }],
      now: at(10, 0),
    });
    expect(r.state).toBe("untimed");
    expect(r.dueIn).toBeNull();
  });
});

describe("counting holes on a card", () => {
  it("counts entries wherever the group started — a shotgun off the 7th", () => {
    const card = [null, null, null, null, null, null, 4, 5, 3, null, null, null, null, null, null, null, null, null];
    expect(holesEntered(JSON.stringify(card))).toBe(3);
    expect(holesEntered("[]")).toBe(0);
    expect(holesEntered("garbage")).toBe(0);
  });
});
