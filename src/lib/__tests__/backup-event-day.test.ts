import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE EVENT-DAY BACKUP'S QUESTION (B21): "is any real club playing today, by its own clock?"
 *
 * `aTournamentIsOnToday` decides whether the hourly trigger takes a copy. It asks the same rows the
 * deploy window asks (`tournamentsNearToday`) and the same rule (`onToday`), so the backup and the
 * freeze cannot disagree about what "an event day" is. Here the rows are stand-ins and the instant
 * is passed in: each case is pinned at an INSTANT and asked of clubs on either side of the date line,
 * because the day belongs to the club, not to the server (docs/claude/club-clock.md).
 */

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { event: { findMany } } }));

const { aTournamentIsOnToday, tournamentsNearToday } = await import("@/lib/services/deploy-window");

// Saturday 2026-10-24 at 20:30 UTC: already Sunday 09:30 in Auckland, still Saturday 13:30 in Los Angeles.
const SAT_EVENING_UTC = new Date("2026-10-24T20:30:00Z");

type Row = { organizationId: string; startOn: string; endOn: string; organization: { timeZone: string }; stages: { playedOn: string }[] };
const row = (timeZone: string, over: Partial<Row> = {}): Row => ({
  organizationId: `zz-club-${timeZone}`,
  startOn: "",
  endOn: "",
  organization: { timeZone },
  stages: [],
  ...over,
});

beforeEach(() => {
  findMany.mockReset();
});

describe("is a real club playing today (the hourly backup's decision)", () => {
  it("no tournament near today: no event-day copy", async () => {
    findMany.mockResolvedValue([]);
    expect(await aTournamentIsOnToday(SAT_EVENING_UTC)).toBe(false);
  });

  it("a round on Sunday counts in Auckland, where it is already Sunday", async () => {
    findMany.mockResolvedValue([row("Pacific/Auckland", { stages: [{ playedOn: "2026-10-25" }] })]);
    expect(await aTournamentIsOnToday(SAT_EVENING_UTC)).toBe(true);
  });

  it("the same Sunday round in Los Angeles does not count yet: it is still Saturday there", async () => {
    findMany.mockResolvedValue([row("America/Los_Angeles", { stages: [{ playedOn: "2026-10-25" }] })]);
    expect(await aTournamentIsOnToday(SAT_EVENING_UTC)).toBe(false);
  });

  it("a tournament whose dates take in today counts, even with no round dated", async () => {
    findMany.mockResolvedValue([row("America/Los_Angeles", { startOn: "2026-10-23", endOn: "2026-10-25" })]);
    expect(await aTournamentIsOnToday(SAT_EVENING_UTC)).toBe(true);
  });

  it("one club playing among several that are not is enough", async () => {
    findMany.mockResolvedValue([
      row("America/Los_Angeles", { stages: [{ playedOn: "2026-10-25" }] }),
      row("Europe/London", { stages: [{ playedOn: "2026-10-24" }] }),
    ]);
    expect(await aTournamentIsOnToday(SAT_EVENING_UTC)).toBe(true);
  });

  it("asks only REAL clubs' unfinished tournaments, within a day either side of the instant", async () => {
    findMany.mockResolvedValue([]);
    await tournamentsNearToday(SAT_EVENING_UTC);
    const where = findMany.mock.calls[0][0].where;
    // The demo club has a tournament on every day of the year: counting it would back up hourly forever.
    expect(where.organization).toEqual({ isDemo: false });
    expect(where.status).toEqual({ notIn: ["completed"] });
    expect(where.OR[0]).toEqual({ stages: { some: { playedOn: { in: ["2026-10-23", "2026-10-24", "2026-10-25"] } } } });
  });
});
