import { describe, it, expect } from "vitest";
import { seriesStandings, type EventFinish } from "../series";
import { isGuestStandIn, STAND_IN_MARK } from "../attendance";

/**
 * B46 (Golf Pro + TD, 12 Nov): a GUEST who stood in for an absent member scores NO individual season points and takes
 * no place from anybody. Table 100/80/65, worked by hand: with the guest removed the members are re-ranked among
 * themselves.
 */
const TABLE = { pointsTable: [100, 80, 65], bestOf: 0, minEvents: 0 };
const week = (finishers: EventFinish["finishers"]): EventFinish => ({ eventId: "w1", eventName: "Week 1", finishers });
const m = (memberId: string, rank: number) => ({ memberId, name: memberId, rank, standIn: false });
const g = (rank: number) => ({ memberId: "guest", name: "guest", rank, standIn: true });
const total = (rows: ReturnType<typeof seriesStandings>, id: string) => rows.find((r) => r.memberId === id)?.total;

describe("a guest who stood in scores no individual season points", () => {
  it("is not in the table; a member 3rd behind the guest takes 2nd-place points", () => {
    // Ann 1st, the guest 2nd, Bob 3rd, Cat 4th -> among members Ann 1, Bob 2, Cat 3.
    const rows = seriesStandings([week([m("ann", 1), g(2), m("bob", 3), m("cat", 4)])], TABLE);
    expect(rows.find((r) => r.memberId === "guest")).toBeUndefined();
    expect(total(rows, "ann")).toBe(100);
    expect(total(rows, "bob")).toBe(80);
    expect(total(rows, "cat")).toBe(65);
  });
  it("a member tied with the stand-in takes the full points of that place", () => {
    // Ann and the guest tie for 1st: Ann alone among members, so 100 (not 90).
    const rows = seriesStandings([week([m("ann", 1), g(1), m("bob", 3)])], TABLE);
    expect(total(rows, "ann")).toBe(100);
    expect(total(rows, "bob")).toBe(80);
  });
  it("members tied with each other still split: 1st and 2nd share (100 + 80) / 2", () => {
    const rows = seriesStandings([week([g(1), m("ann", 2), m("bob", 2), m("cat", 4)])], TABLE);
    expect(total(rows, "ann")).toBe(90);
    expect(total(rows, "bob")).toBe(90);
    expect(total(rows, "cat")).toBe(65);
  });
  it("a guest who is NOT a stand-in is a season regular and scores", () => {
    expect(total(seriesStandings([week([m("csv", 1)])], TABLE), "csv")).toBe(100);
  });
  it("an event with no stand-in is scored exactly as before, gaps and all", () => {
    expect(total(seriesStandings([week([m("a", 1), m("b", 3)])], TABLE), "b")).toBe(65);
  });
});

describe("who is a guest stand-in", () => {
  it("a guest whose rows carry the mark Replace writes when it creates them", () => {
    expect(isGuestStandIn(true, [`Desk ${STAND_IN_MARK}Ann)`])).toBe(true);
    expect(isGuestStandIn(true, [`Desk ${STAND_IN_MARK}Week 2 only)`])).toBe(true);
  });
  it("a member is never a guest stand-in", () => {
    expect(isGuestStandIn(false, [`Desk ${STAND_IN_MARK}Ann)`])).toBe(false);
  });
  it("a guest entered another way, or picked from the field, has no mark", () => {
    expect(isGuestStandIn(true, [])).toBe(false);
    expect(isGuestStandIn(true, ["Desk (replacing Ann)"])).toBe(false);
  });
});
