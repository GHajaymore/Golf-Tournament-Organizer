import { describe, it, expect } from "vitest";
import { whatsNext, JOB_SCREENS, isJobScreen, LAUNCH_AHEAD_DAYS, TEE_SHEET_AHEAD_DAYS, type TournamentJobFacts } from "../needs-you-now";
import { addDays } from "../round-dates";
import { tournamentStatus, type TournamentFacts } from "../tournament-status";
import { FAMILIES, FAMILY_FIXTURES, completed, facts, launched, playedOut, round } from "./tournament-facts-fixtures";

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

/**
 * The machine's answer for a tournament, as the service hands it over:
 * `tournamentStatus` of the facts. Built from facts, never written by hand, so
 * a line cannot pass on a status the machine would never give.
 */
const told = (f: TournamentFacts) => ({ status: tournamentStatus(f), startOn: f.startOn, endOn: f.endOn });

/** A live medal in the middle of its round: the machine's next action is Complete, which is not a job yet. */
const quiet = (over: Partial<TournamentJobFacts> = {}): TournamentJobFacts => ({
  eventId: "e1",
  name: "zz-sechome Autumn Medal",
  awaitingApproval: 0,
  entriesClose: "",
  nextSheet: null,
  board: null,
  ...told(launched(facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] }))),
  ...over,
});

/** Every round played and closed: Play over. */
const ended = (f: TournamentFacts = facts()) => told(playedOut(f));

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

  it("results not released: only when play is over and the tournament is not completed", () => {
    const [j] = jobs(quiet(ended()));
    expect(j.key).toBe("results");
    expect(j.text).toBe("Every round closed · results not released");
    expect(j.href).toBe("/dashboard");
    // The dashboard's own button, in its own words.
    expect(j.action).toBe("Complete tournament");
    // Golf still being played: Complete is the dashboard's next action, and not a job.
    expect(quiet().status.nextAction?.kind).toBe("complete");
    expect(keys(quiet())).toEqual([]);
    // Completed: nothing.
    expect(keys(quiet(told(completed(facts()))))).toEqual([]);
  });
});

/**
 * THE TOURNAMENT'S OWN JOB IS THE MACHINE'S NEXT ACTION (state machine PR 6,
 * J15) — with its refusal, so the home never offers what the dashboard
 * refuses.
 */
describe("what's next: each tournament's next action, as the machine gives it", () => {
  it("D3: every round closed with a card still to sign off — the refusal and its way out, never Complete", () => {
    const pending = ended(facts({ review: { pendingConfirmations: 1, disputed: 0 } }));
    expect(pending.status.nextAction?.enabled).toBe(false);
    const [j] = jobs(quiet(pending));
    expect(j.key).toBe("results");
    expect(j.text).toBe(pending.status.refusals.complete);
    expect(j.text).toMatch(/signed off/);
    expect(j.action).toBe("Open Score entry");
    expect(j.href).toBe("/entry");
    // CONTROL: the same tournament with the card signed off offers Complete.
    expect(jobs(quiet(ended()))[0].action).toBe("Complete tournament");
  });

  it("D3: every round closed with nothing scored — refused, as the dashboard refuses it", () => {
    const empty = told({ ...launched(facts()), rounds: [round({ id: "r1", position: 0, closed: true })] });
    expect(empty.status.step).toBe("play-over");
    const [j] = jobs(quiet(empty));
    expect(j.text).toBe(empty.status.refusals.complete);
    expect(j.href).toBe("/entry");
  });

  it("D3k: a knockout whose Final is decided reaches the home — no Bracket Stage is ever closed", () => {
    const ko = ended(FAMILY_FIXTURES.knockout());
    const [j] = jobs(quiet(ko));
    expect(j.key).toBe("results");
    expect(j.text).toBe("Final decided · results not released");
    expect(j.action).toBe("Complete tournament");
    // CONTROL: its Final not yet decided — still being played, no line.
    const f = playedOut(FAMILY_FIXTURES.knockout());
    const undecided = told({ ...f, knockout: { ...f.knockout!, draws: f.knockout!.draws.map((d) => ({ ...d, finalDecided: false })) } });
    expect(undecided.status.step).toBe("live");
    expect(keys(quiet(undecided))).toEqual([]);
  });

  it("launch: within the fortnight before the first day, ready or refused in place", () => {
    const soon = told(facts({ startOn: "2026-10-24", endOn: "2026-10-24" }));
    const [j] = jobs(quiet(soon));
    expect(j.key).toBe("launch");
    expect(j.text).toBe("Starts Sat 24 Oct · ready to launch");
    expect(j.action).toBe("Launch tournament");
    expect(j.href).toBe("/dashboard");
    expect(j.due).toBe("2026-10-24");
    // The fortnight is the tee sheet's: the last day in, the day after out.
    const on = (d: string) => keys(quiet(told(facts({ startOn: d, endOn: d }))));
    expect(on(addDays(TODAY, LAUNCH_AHEAD_DAYS))).toEqual(["launch"]);
    expect(on(addDays(TODAY, LAUNCH_AHEAD_DAYS + 1))).toEqual([]);
    // Dates gone by unlaunched are the Tournaments list's "Dates passed", not a job.
    expect(on("2026-10-01")).toEqual([]);
    // Undated: not a job until it has a day.
    expect(keys(quiet(told(facts({ startOn: "", endOn: "" }))))).toEqual([]);
  });

  it("launch refused: the refusal said, and the way out pressed when it is a job's screen", () => {
    const nobody = told(facts({ confirmed: 0, startOn: "2026-10-24", endOn: "2026-10-24" }));
    expect(nobody.status.nextAction?.enabled).toBe(false);
    const [j] = jobs(quiet(nobody));
    expect(j.text).toBe(`Starts Sat 24 Oct · ${nobody.status.refusals.launch}`);
    expect(j.href).toBe("/registration");
    expect(j.action).toBe(nobody.status.nextAction?.wayOut?.says);
    // A way out on a screen no job opens (Tournament details): the dashboard, which says it in place.
    const undated = told(facts({ dated: false, startOn: "2026-10-24", endOn: "2026-10-24" }));
    expect(undated.status.nextAction?.wayOut?.href).toBe("/event");
    const [u] = jobs(quiet(undated));
    expect(u.href).toBe("/dashboard");
    expect(u.action).toBe("Finish setting up");
  });

  it("results in on a tournament never launched is a launch job at once, whatever its dates (D2, D5)", () => {
    const played = told(facts({ startOn: "2026-12-24", endOn: "2026-12-24", rounds: [round({ id: "r1", position: 0, hasResult: true })] }));
    expect(played.status.underWayUnlaunched).toBe(true);
    const [j] = jobs(quiet(played));
    expect(j.key).toBe("launch");
    expect(j.text).toBe("Results are in · not launched");
    expect(j.action).toBe("Launch tournament");
  });

  it("live: the next round's draw is the job when it is the machine's next action", () => {
    const rr = (r2: number) =>
      told(
        launched(
          facts({
            rounds: [
              round({ id: "r1", position: 0, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: 6, hasResult: true, closed: true, teeSheetSaved: null }),
              round({ id: "r2", position: 1, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: r2, teeSheetSaved: null }),
            ],
          }),
        ),
      );
    const [j] = jobs(quiet(rr(0)));
    expect(j.key).toBe("draw");
    expect(j.action).toBe("Generate Round 2 pairings");
    expect(j.href).toBe("/stages");
    expect(keys(quiet(rr(6)))).toEqual([]);
  });

  it("live league: the next week's day is the job when the next week has none", () => {
    const league = FAMILY_FIXTURES.league();
    const undated = told(launched({ ...league, rounds: league.rounds.map((r, i) => (i === 0 ? { ...r, scheduled: false } : r)) }));
    expect(undated.status.nextAction?.kind).toBe("schedule");
    const [j] = jobs(quiet(undated));
    expect(j.key).toBe("schedule");
    expect(j.action).toBe(undated.status.nextAction?.label);
    expect(j.href).toBe("/stages");
    expect(keys(quiet(told(launched(league))))).toEqual([]);
  });
});

describe("what's next: in the order the jobs fall due", () => {
  it("a late round's cards first, then today's, then the days ahead in date order", () => {
    const order = jobs(
      quiet({ eventId: "a", awaitingApproval: 2, entriesClose: "2026-10-30" }),
      quiet({ eventId: "b", nextSheet: { round: "Round 1", day: "2026-10-24", published: false } }),
      quiet({ eventId: "c", board: board({ day: "2026-10-19" }) }),
      quiet({ eventId: "d", ...ended() }),
    ).map((j) => `${j.eventId}:${j.key}`);
    expect(order).toEqual(["c:cards", "d:results", "b:tee-sheet", "a:entries"]);
  });

  it("on the same day, the job earlier in a tournament's life comes first", () => {
    expect(keys(quiet({ awaitingApproval: 1, board: board(), ...ended() }))).toEqual(["entries", "cards", "results"]);
  });
});

describe("a job's button goes only to a job's screen", () => {
  it("every line points at a screen on the list enterTournament honours", () => {
    const all = jobs(
      quiet({ awaitingApproval: 1, nextSheet: { round: "Round 1", day: "2026-10-22", published: false }, board: board(), ...ended() }),
    );
    expect(all.map((j) => j.key).sort()).toEqual(["cards", "entries", "results", "tee-sheet"]);
    for (const j of all) expect(JOB_SCREENS).toContain(j.href);
  });

  it("in every family, at every step, ready or refused, the machine's job opens a job's screen", () => {
    let seen = 0;
    for (const family of FAMILIES) {
      const base = { ...FAMILY_FIXTURES[family](), startOn: "2026-10-24", endOn: "2026-10-24" };
      const variants: TournamentFacts[] = [
        base,
        { ...base, confirmed: 0 },
        { ...base, dated: false },
        launched(base),
        playedOut(base),
        playedOut({ ...base, review: { pendingConfirmations: 2, disputed: 1 } }),
        completed(base),
      ];
      for (const f of variants) {
        for (const j of jobs(quiet({ eventId: family, ...told(f) }))) {
          seen += 1;
          expect(JOB_SCREENS, `${family} ${j.key}: ${j.href}`).toContain(j.href);
        }
      }
    }
    // CONTROL: the walk produced jobs to check.
    expect(seen).toBeGreaterThan(FAMILIES.length);
  });

  it("CONTROL: anything else is not a job screen", () => {
    for (const bad of ["/access", "https://example.invalid/dashboard", "/dashboard?x=1", "", null, 3]) {
      expect(isJobScreen(bad), String(bad)).toBe(false);
    }
  });
});
