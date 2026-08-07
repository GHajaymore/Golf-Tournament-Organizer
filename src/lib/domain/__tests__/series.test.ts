import { describe, it, expect } from "vitest";
import {
  seriesStandings,
  pointsForRank,
  countback,
  describeTable,
  DEFAULT_POINTS_TABLE,
  type EventFinish,
  type SeriesConfig,
} from "../series";

const TABLE = [100, 80, 65, 55, 50];
const cfg = (over: Partial<SeriesConfig> = {}): SeriesConfig => ({
  pointsTable: TABLE,
  bestOf: 0,
  minEvents: 0,
  ...over,
});

const ev = (id: string, order: Array<[string, number]>): EventFinish => ({
  eventId: id,
  eventName: `Round ${id}`,
  finishers: order.map(([memberId, rank]) => ({ memberId, name: memberId.toUpperCase(), rank })),
});

const find = (rows: ReturnType<typeof seriesStandings>, id: string) =>
  rows.find((r) => r.memberId === id)!;

describe("points for a finishing position", () => {
  it("awards the table straight when nobody ties", () => {
    expect(pointsForRank(TABLE, 1, 1)).toBe(100);
    expect(pointsForRank(TABLE, 3, 1)).toBe(65);
  });

  it("splits what tied positions are collectively worth", () => {
    // Two tied for 2nd occupy 2nd and 3rd: (80 + 65) / 2 = 72.5 each. The pair
    // receives exactly what those two places were worth.
    expect(pointsForRank(TABLE, 2, 2)).toBe(72.5);
  });

  it("never invents points a congested event didn't allocate", () => {
    // Three tied for 1st take 1st, 2nd and 3rd between them. Awarding all three
    // 100 would let a messy event outscore a clean one.
    const each = pointsForRank(TABLE, 1, 3);
    expect(each * 3).toBe(100 + 80 + 65);
  });

  it("scores nothing past the end of the table", () => {
    expect(pointsForRank(TABLE, 99, 1)).toBe(0);
    // A tie straddling the end takes only what exists.
    expect(pointsForRank(TABLE, 5, 2)).toBe(50 / 2);
  });
});

describe("a season adds up", () => {
  const events = [
    ev("a", [["ann", 1], ["bob", 2], ["cal", 3]]),
    ev("b", [["bob", 1], ["ann", 2], ["cal", 3]]),
  ];

  it("aggregates one member across many events", () => {
    // The point of using Member and not Player: the same golfer entering two
    // rounds is two Player rows and must be one line here.
    const rows = seriesStandings(events, cfg());
    expect(rows).toHaveLength(3);
    expect(find(rows, "ann").total).toBe(180);
    expect(find(rows, "ann").played).toBe(2);
  });

  it("ranks by total and numbers the table", () => {
    const rows = seriesStandings(events, cfg());
    expect(rows[0].position).toBe(1);
    expect(rows[0].total).toBe(180);
    expect(rows[2].memberId).toBe("cal");
  });

  it("keeps every result, dropped or not, for the organizer to see", () => {
    const rows = seriesStandings(events, cfg());
    expect(find(rows, "ann").entries.map((e) => e.eventName)).toEqual(["Round a", "Round b"]);
  });

  it("handles a season with no events at all", () => {
    expect(seriesStandings([], cfg())).toEqual([]);
  });
});

describe("best N of M", () => {
  const four = [
    ev("1", [["ann", 1]]),
    ev("2", [["ann", 5]]),
    ev("3", [["ann", 2]]),
    ev("4", [["ann", 4]]),
  ];

  it("counts only the best results", () => {
    // 100 + 80 = 180, dropping the 55 and the 50.
    const rows = seriesStandings(four, cfg({ bestOf: 2 }));
    expect(find(rows, "ann").total).toBe(180);
  });

  it("marks what was dropped rather than hiding it", () => {
    const s = find(seriesStandings(four, cfg({ bestOf: 2 })), "ann");
    expect(s.entries.filter((e) => e.counted).map((e) => e.rank).sort()).toEqual([1, 2]);
    expect(s.entries.filter((e) => !e.counted)).toHaveLength(2);
    expect(s.played).toBe(4); // played is everything, not just what counted
  });

  it("counts everything when best-of is off", () => {
    expect(find(seriesStandings(four, cfg()), "ann").total).toBe(100 + 50 + 80 + 55);
  });

  it("does not penalise someone who played fewer than the best-of", () => {
    // Best 5 of a season where they only played twice is just their two.
    const rows = seriesStandings(four.slice(0, 2), cfg({ bestOf: 5 }));
    expect(find(rows, "ann").total).toBe(150);
    expect(find(rows, "ann").entries.every((e) => e.counted)).toBe(true);
  });
});

describe("a minimum number of events to qualify", () => {
  const events = [
    ev("a", [["ann", 1], ["bob", 2]]),
    ev("b", [["bob", 1]]),
    ev("c", [["bob", 1]]),
  ];

  it("leaves someone short of the minimum unranked", () => {
    // A player who turned up once and won should not top a season. Ann has 100
    // and Bob 260, but the rule matters even when it doesn't change the order.
    const rows = seriesStandings(events, cfg({ minEvents: 2 }));
    expect(find(rows, "ann").position).toBeNull();
    expect(find(rows, "bob").position).toBe(1);
  });

  it("still shows them, because hiding them looks like a bug to the player", () => {
    const rows = seriesStandings(events, cfg({ minEvents: 2 }));
    expect(rows.map((r) => r.memberId)).toContain("ann");
    expect(find(rows, "ann").total).toBe(100);
  });

  it("sorts the unqualified after everyone ranked", () => {
    const oneWin = [ev("a", [["solo", 1]]), ev("b", [["reg", 2]]), ev("c", [["reg", 2]])];
    const rows = seriesStandings(oneWin, cfg({ minEvents: 2 }));
    expect(rows[0].memberId).toBe("reg");
    expect(rows[rows.length - 1].memberId).toBe("solo");
  });

  it("ranks everyone when there is no minimum", () => {
    const rows = seriesStandings(events, cfg());
    expect(rows.every((r) => r.position !== null)).toBe(true);
  });
});

describe("ties in the season table", () => {
  it("separates equal totals on most wins", () => {
    // A table where a win-plus-a-poor-round exactly equals two middling ones:
    //   Ann  1st + 4th = 100 + 50 = 150
    //   Bob  2nd + 3rd =  90 + 60 = 150
    // Level on points, but Ann has the win, so Ann takes it.
    const table = [100, 90, 60, 50];
    const events = [
      ev("a", [["ann", 1], ["bob", 2]]),
      ev("b", [["bob", 3], ["ann", 4]]),
    ];
    const rows = seriesStandings(events, cfg({ pointsTable: table }));
    expect(find(rows, "ann").total).toBe(150);
    expect(find(rows, "bob").total).toBe(150);
    expect(rows[0].memberId).toBe("ann");
    expect(rows[0].position).toBe(1);
    expect(rows[1].position).toBe(2);
  });

  it("goes deeper when wins are level", () => {
    expect(countback([1, 3], [1, 4])).toBeLessThan(0); // a has a 3rd, b a 4th
    expect(countback([1, 2], [1, 2])).toBe(0);
    expect(countback([1, 1], [1, 2])).toBeLessThan(0);
  });

  it("shares a position when even the countback is level", () => {
    // Identical seasons should read as a genuine tie, not an arbitrary order.
    const events = [
      ev("a", [["ann", 1], ["bob", 1]]),
      ev("b", [["ann", 3], ["bob", 3]]),
    ];
    const rows = seriesStandings(events, cfg());
    expect(rows[0].total).toBe(rows[1].total);
    expect(rows[0].position).toBe(1);
    expect(rows[1].position).toBe(1);
  });
});

describe("robustness", () => {
  it("uses the default table when none is configured", () => {
    const rows = seriesStandings([ev("a", [["ann", 1]])], cfg({ pointsTable: [] }));
    expect(find(rows, "ann").total).toBe(DEFAULT_POINTS_TABLE[0]);
  });

  it("shows the current roster name rather than a stale one", () => {
    const events: EventFinish[] = [
      { eventId: "a", eventName: "A", finishers: [{ memberId: "m", name: "Old Name", rank: 1 }] },
      { eventId: "b", eventName: "B", finishers: [{ memberId: "m", name: "New Name", rank: 1 }] },
    ];
    expect(seriesStandings(events, cfg())[0].name).toBe("New Name");
  });

  it("copes with an event nobody finished", () => {
    const rows = seriesStandings([ev("a", [["ann", 1]]), { eventId: "b", eventName: "B", finishers: [] }], cfg());
    expect(find(rows, "ann").played).toBe(1);
  });

  it("describes a table an organizer can check", () => {
    expect(describeTable(TABLE)).toBe("100, 80, 65… down to 50 for 5th");
    expect(describeTable([10, 5])).toBe("10, 5 points");
  });
});
