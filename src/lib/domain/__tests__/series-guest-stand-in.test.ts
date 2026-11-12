import { describe, it, expect } from "vitest";
import { seriesStandings, type EventFinish } from "../series";
import { isGuestStandIn, REPLACING_MARK, STAND_IN_MARK } from "../attendance";

/** B46 (Golf Pro + TD, 12 Nov): a GUEST who stood in for an absent member scores NO individual season points; table 100/80/65, a member keeps the place they finished (Bob 3rd scores 65). */
const TABLE = { pointsTable: [100, 80, 65], bestOf: 0, minEvents: 0 };
const week = (finishers: EventFinish["finishers"]): EventFinish => ({ eventId: "w1", eventName: "Week 1", finishers });

describe("a guest who stood in scores no individual season points", () => {
  const rows = seriesStandings(
    [week([
      { memberId: "ann", name: "Ann", rank: 1, standIn: false },
      { memberId: "guest", name: "Guest", rank: 2, standIn: true },
      { memberId: "bob", name: "Bob", rank: 3, standIn: false },
    ])],
    TABLE,
  );
  it("leaves the guest out of the table", () => {
    expect(rows.find((r) => r.memberId === "guest")).toBeUndefined();
  });
  it("scores the members by the place they finished", () => {
    expect(rows.find((r) => r.memberId === "ann")!.total).toBe(100);
    expect(rows.find((r) => r.memberId === "bob")!.total).toBe(65);
  });
  it("a tie with a stand-in is shared as it was played: 1st and 2nd split 100 and 80", () => {
    const tied = seriesStandings(
      [week([
        { memberId: "ann", name: "Ann", rank: 1, standIn: false },
        { memberId: "guest", name: "Guest", rank: 1, standIn: true },
      ])],
      TABLE,
    );
    expect(tied.find((r) => r.memberId === "ann")!.total).toBe(90);
  });
  it("a guest who is NOT a stand-in is a season regular and scores", () => {
    const regular = seriesStandings([week([{ memberId: "csv", name: "Csv Guest", rank: 1, standIn: false }])], TABLE);
    expect(regular[0].total).toBe(100);
  });
});

describe("who is a guest stand-in", () => {
  it("a guest with the in-row Replace writes", () => {
    expect(isGuestStandIn(true, [`Desk ${REPLACING_MARK}Ann)`])).toBe(true);
  });
  it("a guest with the out-row Replace writes for the other weeks", () => {
    expect(isGuestStandIn(true, [`Desk ${STAND_IN_MARK}Week 2 only)`])).toBe(true);
  });
  it("a member substitute is not a guest stand-in", () => {
    expect(isGuestStandIn(false, [`Desk ${REPLACING_MARK}Ann)`])).toBe(false);
  });
  it("a guest entered another way has no mark", () => {
    expect(isGuestStandIn(true, [])).toBe(false);
    expect(isGuestStandIn(true, ["Desk"])).toBe(false);
  });
});
