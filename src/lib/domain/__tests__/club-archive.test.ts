import { describe, it, expect } from "vitest";
import {
  ARCHIVE_MONTHS,
  ARCHIVE_NOTICE_DAYS,
  archiveEndsAt,
  archiveRefusal,
  archiveState,
  archiveStep,
} from "../club-archive";

/**
 * A LAPSED PAID CLUB'S ARCHIVE, from the rule as Ajay ruled it (2026-10-21,
 * A4): read-only for twelve months from the day the plan ended, the owners told
 * 30 days and 7 days before, then deleted; resubscribing lifts it.
 *
 * Every expected date below is written out by hand from that sentence — a
 * calendar read, not the code's own arithmetic — so the test cannot agree with
 * a wrong implementation by sharing its formula.
 */

const at = (iso: string) => new Date(iso);
const DAY = 24 * 3600 * 1000;

describe("how long the archive is kept", () => {
  it("is twelve calendar months, to the day and the minute", () => {
    expect(ARCHIVE_MONTHS).toBe(12);
    expect(archiveEndsAt(at("2026-11-03T15:30:00Z")).toISOString()).toBe("2027-11-03T15:30:00.000Z");
    expect(archiveEndsAt(at("2026-01-31T00:00:00Z")).toISOString()).toBe("2027-01-31T00:00:00.000Z");
    expect(archiveEndsAt(at("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-12-31T23:59:59.000Z");
  });

  it("a lapse on 29 February is kept until 28 February — not into March", () => {
    expect(archiveEndsAt(at("2028-02-29T09:00:00Z")).toISOString()).toBe("2029-02-28T09:00:00.000Z");
  });

  it("is not 365 days: across a leap day the year is 366", () => {
    // 1 March 2027 to 1 March 2028 holds 29 February 2028.
    const lapsed = at("2027-03-01T12:00:00Z");
    expect(archiveEndsAt(lapsed).getTime() - lapsed.getTime()).toBe(366 * DAY);
  });
});

describe("whether a tournament is archived", () => {
  const lapsed = at("2026-11-03T10:00:00Z");

  it("not without the stamp: a club that pays, or a Par tournament made after the lapse", () => {
    expect(archiveState({ archivedAt: null, status: "live" }, at("2027-01-01T00:00:00Z"))).toEqual({ archived: false });
  });

  it("from the lapse, completed and unfinished alike, and until twelve months on", () => {
    const live = archiveState({ archivedAt: lapsed, status: "live" }, at("2026-11-04T00:00:00Z"));
    expect(live).toMatchObject({ archived: true, unfinished: true });
    if (!live.archived) throw new Error("unreachable");
    expect(live.lapsedAt.toISOString()).toBe("2026-11-03T10:00:00.000Z");
    expect(live.until.toISOString()).toBe("2027-11-03T10:00:00.000Z");
    expect(archiveState({ archivedAt: lapsed, status: "completed" }, at("2026-11-04T00:00:00Z"))).toMatchObject({
      archived: true,
      unfinished: false,
    });
  });

  it("one day either side of the twelve months it is STILL archived — it ends when the sweep deletes it, never by becoming editable", () => {
    for (const now of [at("2027-11-02T10:00:00Z"), at("2027-11-04T10:00:00Z")]) {
      expect(archiveState({ archivedAt: lapsed, status: "live" }, now).archived).toBe(true);
    }
  });

  it("resubscribing clears the stamp, and the same tournament is not archived", () => {
    expect(archiveState({ archivedAt: null, status: "live" }, at("2027-05-01T00:00:00Z")).archived).toBe(false);
  });
});

describe("what it says", () => {
  const words = { lapsed: "3 Nov 2026", until: "3 Nov 2027" };
  const unfinished = archiveState({ archivedAt: at("2026-11-03T10:00:00Z"), status: "live" }, at("2026-12-01T00:00:00Z"));
  const completed = archiveState({ archivedAt: at("2026-11-03T10:00:00Z"), status: "completed" }, at("2026-12-01T00:00:00Z"));

  it("to an organizer: when it ended, until when it is kept, and how to carry on", () => {
    const s = archiveRefusal(completed, words, "organizer")!;
    expect(s).toBe(
      "This club's subscription ended on 3 Nov 2026. Its tournaments are kept read-only until 3 Nov 2027, then deleted. Resubscribe in Club settings to carry on.",
    );
    const p = archiveRefusal(unfinished, words, "organizer")!;
    expect(p).toContain("paused where it stands");
    expect(p).toContain("3 Nov 2027");
    expect(p).toContain("Resubscribe");
  });

  it("to a player: paused, still viewable, and nothing about a plan they cannot buy", () => {
    const s = archiveRefusal(unfinished, words, "player")!;
    expect(s).toContain("paused");
    expect(s).toContain("3 Nov 2026");
    expect(s).toContain("stay open to view until 3 Nov 2027");
    expect(s).not.toContain("Club settings");
  });

  it("nothing at all for a tournament that is not archived", () => {
    expect(archiveRefusal({ archived: false }, words, "organizer")).toBeNull();
    expect(archiveRefusal({ archived: false }, words, "player")).toBeNull();
  });
});

describe("the notices, and the delete", () => {
  // Lapsed 3 Nov 2026 10:00; kept until 3 Nov 2027 10:00. Thirty days before is
  // 4 Oct 2027 10:00 (October has 31 days); seven days before is 27 Oct 2027 10:00.
  const lapsedAt = at("2026-11-03T10:00:00Z");
  const fresh = { lapsedAt, notice30At: null, notice7At: null };

  it("are the 30 and 7 days the ruling names", () => {
    expect([...ARCHIVE_NOTICE_DAYS]).toEqual([30, 7]);
  });

  it("nothing in the first eleven months", () => {
    expect(archiveStep(fresh, at("2026-11-04T10:00:00Z"))).toEqual({ notice: null, delete: false });
    expect(archiveStep(fresh, at("2027-10-04T09:59:59Z"))).toEqual({ notice: null, delete: false });
  });

  it("the 30-day notice from 30 days before, once", () => {
    expect(archiveStep(fresh, at("2027-10-04T10:00:00Z"))).toEqual({ notice: 30, delete: false });
    const told30 = { ...fresh, notice30At: at("2027-10-04T10:00:00Z") };
    expect(archiveStep(told30, at("2027-10-20T10:00:00Z"))).toEqual({ notice: null, delete: false });
  });

  it("the 7-day notice from 7 days before", () => {
    const told30 = { ...fresh, notice30At: at("2027-10-04T10:00:00Z") };
    expect(archiveStep(told30, at("2027-10-27T09:59:59Z"))).toEqual({ notice: null, delete: false });
    expect(archiveStep(told30, at("2027-10-27T10:00:00Z"))).toEqual({ notice: 7, delete: false });
  });

  it("deletes on the day it was kept until — not a second before — once both notices went on time", () => {
    const told = { lapsedAt, notice30At: at("2027-10-04T10:00:00Z"), notice7At: at("2027-10-27T10:00:00Z") };
    expect(archiveStep(told, at("2027-11-03T09:59:59Z")).delete).toBe(false);
    expect(archiveStep(told, at("2027-11-03T10:00:00Z")).delete).toBe(true);
  });

  it("a sweep that missed the window sends the 7-day notice only, and then waits the full week", () => {
    // Nothing ran until 2 Nov 2027, a day before the end.
    const late = archiveStep(fresh, at("2027-11-02T10:00:00Z"));
    expect(late).toEqual({ notice: 7, delete: false });
    const told = { lapsedAt, notice30At: at("2027-11-02T10:00:00Z"), notice7At: at("2027-11-02T10:00:00Z") };
    // The end has passed, but the owners were promised seven days: 9 Nov 2027.
    expect(archiveStep(told, at("2027-11-05T10:00:00Z")).delete).toBe(false);
    expect(archiveStep(told, at("2027-11-09T09:59:59Z")).delete).toBe(false);
    expect(archiveStep(told, at("2027-11-09T10:00:00Z")).delete).toBe(true);
  });

  it("never deletes without the 7-day notice, however late", () => {
    const told30Only = { ...fresh, notice30At: at("2027-10-04T10:00:00Z") };
    const step = archiveStep(told30Only, at("2028-06-01T00:00:00Z"));
    expect(step.delete).toBe(false);
    expect(step.notice).toBe(7);
  });
});
