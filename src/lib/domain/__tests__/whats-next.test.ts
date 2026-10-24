import { describe, it, expect } from "vitest";
import { whatsNext, JOB_SCREENS, isJobScreen, TEE_SHEET_AHEAD_DAYS, type TournamentJobFacts } from "../needs-you-now";
import { addDays } from "../round-dates";

/**
 * THE SECRETARY'S HOME, ITS LINES (2026-10-24). For each kind of job, a state
 * where it MUST appear and one where it must NOT — a list that shows every job
 * all the time passes the first half of every case, and a list that shows none
 * passes the second, so each case is both.
 *
 * The facts are handed in exactly as the service reads them off the screens'
 * own functions; this pins only the wording, the conditions and the order.
 */

const TODAY = "2026-10-21"; // a Wednesday
const LOCALE = "en-GB";

const quiet = (over: Partial<TournamentJobFacts> = {}): TournamentJobFacts => ({
  eventId: "e1",
  name: "zz-sechome Autumn Medal",
  awaitingApproval: 0,
  entriesClose: "",
  nextSheet: null,
  board: null,
  resultsWaiting: false,
  ...over,
});

const board = (over: Partial<NonNullable<TournamentJobFacts["board"]>> = {}): NonNullable<TournamentJobFacts["board"]> => ({
  round: "Round 2",
  day: TODAY,
  closed: false,
  unit: "cards",
  started: 12,
  certified: 8,
  total: 12,
  ...over,
});

const jobs = (...t: TournamentJobFacts[]) => whatsNext({ tournaments: t, today: TODAY, locale: LOCALE });
const keys = (...t: TournamentJobFacts[]) => jobs(...t).map((j) => j.key);

describe("what's next: one line per job, only when it is a job", () => {
  it("CONTROL: a tournament waiting on nothing has no line", () => {
    expect(jobs(quiet())).toEqual([]);
  });

  it("entries awaiting approval: said with the closing day, and not when none are waiting", () => {
    const [j] = jobs(quiet({ awaitingApproval: 3, entriesClose: "2026-10-23" }));
    expect(j.text).toBe("Entries close Fri 23 Oct · 3 entries awaiting approval");
    expect(j.href).toBe("/registration");
    expect(j.due).toBe("2026-10-23");
    expect(jobs(quiet({ awaitingApproval: 1 }))[0].text).toBe("1 entry awaiting approval");
    // A deadline already gone is not "closes"; the entries still wait.
    expect(jobs(quiet({ awaitingApproval: 2, entriesClose: "2026-10-01" }))[0].text).toBe("2 entries awaiting approval");
    // The deadline day itself is open until midnight at the club.
    expect(jobs(quiet({ awaitingApproval: 2, entriesClose: TODAY }))[0].text).toMatch(/^Entries close Wed 21 Oct/);
    expect(keys(quiet({ awaitingApproval: 0, entriesClose: "2026-10-23" }))).toEqual([]);
  });

  it("an unpublished tee sheet for a round coming up — not a published one, a past one, or one a month off", () => {
    const sheet = (day: string, published = false) => quiet({ nextSheet: { round: "Round 1", day, published } });
    const [j] = jobs(sheet("2026-10-24"));
    expect(j.text).toBe("Round 1 tee sheet for Sat 24 Oct is not published");
    expect(j.href).toBe("/foursomes");
    expect(keys(sheet("2026-10-24", true))).toEqual([]);
    expect(keys(sheet("2026-10-20"))).toEqual([]);
    expect(keys(sheet(addDays(TODAY, TEE_SHEET_AHEAD_DAYS)))).toEqual(["tee-sheet"]);
    expect(keys(sheet(addDays(TODAY, TEE_SHEET_AHEAD_DAYS + 1)))).toEqual([]);
    expect(keys(quiet({ nextSheet: { round: "Round 1", day: "", published: false } }))).toEqual([]);
  });

  it("cards not returned: the board's own count, once the round is being played", () => {
    const [j] = jobs(quiet({ board: board() }));
    expect(j.text).toBe("Round 2: 4 cards not returned");
    expect(j.href).toBe("/entry");
    expect(jobs(quiet({ board: board({ unit: "sides", total: 8, certified: 7 }) }))[0].text).toBe("Round 2: 1 side not returned");
    // Every card in, the round closed, a knockout's ties or a round scored by hand: no line.
    expect(keys(quiet({ board: board({ certified: 12 }) }))).toEqual([]);
    expect(keys(quiet({ board: board({ closed: true }) }))).toEqual([]);
    expect(keys(quiet({ board: board({ unit: "ties" }) }))).toEqual([]);
    expect(keys(quiet({ board: board({ unit: "manual" }) }))).toEqual([]);
    // Before its day, with nobody out, nobody is late.
    expect(keys(quiet({ board: board({ day: "2026-10-25", started: 0, certified: 0 }) }))).toEqual([]);
    // On its day with nobody started yet, the whole field is still out.
    expect(jobs(quiet({ board: board({ started: 0, certified: 0 }) }))[0].text).toBe("Round 2: 12 cards not returned");
  });

  it("results not released: only when the golf is over and the tournament is not completed", () => {
    const [j] = jobs(quiet({ resultsWaiting: true }));
    expect(j.text).toBe("Every round is closed · results not released");
    expect(j.href).toBe("/dashboard");
    expect(keys(quiet({ resultsWaiting: false }))).toEqual([]);
  });
});

describe("what's next: in the order the jobs fall due", () => {
  it("a late round's cards first, then today's, then the days ahead in date order", () => {
    const order = jobs(
      quiet({ eventId: "a", awaitingApproval: 2, entriesClose: "2026-10-30" }),
      quiet({ eventId: "b", nextSheet: { round: "Round 1", day: "2026-10-24", published: false } }),
      quiet({ eventId: "c", board: board({ day: "2026-10-19" }) }),
      quiet({ eventId: "d", resultsWaiting: true }),
    ).map((j) => `${j.eventId}:${j.key}`);
    expect(order).toEqual(["c:cards", "d:results", "b:tee-sheet", "a:entries"]);
  });

  it("on the same day, the job earlier in a tournament's life comes first", () => {
    expect(keys(quiet({ awaitingApproval: 1, board: board(), resultsWaiting: true }))).toEqual(["entries", "cards", "results"]);
  });
});

describe("a job's button goes only to a job's screen", () => {
  it("every line points at a screen on the list enterTournament honours", () => {
    const all = jobs(
      quiet({ awaitingApproval: 1, nextSheet: { round: "Round 1", day: "2026-10-22", published: false }, board: board(), resultsWaiting: true }),
    );
    expect(all.map((j) => j.key).sort()).toEqual(["cards", "entries", "results", "tee-sheet"]);
    for (const j of all) expect(JOB_SCREENS).toContain(j.href);
  });

  it("CONTROL: anything else is not a job screen", () => {
    for (const bad of ["/access", "https://example.invalid/dashboard", "/dashboard?x=1", "", null, 3]) {
      expect(isJobScreen(bad), String(bad)).toBe(false);
    }
  });
});
