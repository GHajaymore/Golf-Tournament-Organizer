import { describe, it, expect } from "vitest";
import { eventLinks, eventPhase, eventSections, finalReportReady } from "../event-page";
import { tournamentStatus, type TournamentFacts } from "../tournament-status";
import { stepOf } from "../tournament-step";
import { FAMILIES, FAMILY_FIXTURES, completed, facts, launched, playedOut } from "./tournament-facts-fixtures";

/**
 * What the event page leads with on each day of a tournament's life
 * (2026-10-24). The browser half — the secretary finding the link, a visitor
 * opening it signed out, and a held board answering 404 — is
 * `e2e/clubhouse-and-event-page.spec.ts`.
 */

/** The page's phase, as the page reads it: the machine's journey for these facts (state machine PR 6). */
const phaseOf = (f: TournamentFacts) => eventPhase(stepOf(tournamentStatus(f)).journey);
const played = (f: TournamentFacts) => ({ ...f, rounds: f.rounds.map((r) => ({ ...r, hasResult: true })) });

describe("where the tournament is — the machine's journey", () => {
  it("is before the day until it is launched or a result is in", () => {
    expect(phaseOf(facts({ status: "draft" }))).toBe("before");
    // A card typed in before launch is play, as the dashboard says.
    expect(phaseOf(played(facts({ status: "draft" })))).toBe("during");
    expect(phaseOf(launched(facts()))).toBe("during");
  });

  it("is after only once the committee has completed it", () => {
    expect(phaseOf(facts({ status: "completed" }))).toBe("after");
    expect(phaseOf(completed(facts()))).toBe("after");
    expect(phaseOf(played(launched(facts())))).toBe("during");
    // Play over is still during: the results are not released until it is completed.
    expect(tournamentStatus(playedOut(facts())).step).toBe("play-over");
    expect(phaseOf(playedOut(facts()))).toBe("during");
  });

  it("a match played before launch is during, in every family — not only a card or a knockout tie (D2)", () => {
    // The page counted stroke cards, side cards and knockout winners, and never
    // a match's holes: a round robin played unlaunched led with "before". A
    // round's `hasResult` is the one definition, and the machine reads it.
    for (const family of FAMILIES.filter((x) => x !== "casual")) {
      const f = FAMILY_FIXTURES[family]();
      expect(phaseOf(f), `${family}, nothing played`).toBe("before");
      expect(phaseOf(played(f)), `${family}, a result in`).toBe("during");
    }
  });
});

describe("what the page shows, in order", () => {
  it("before the day: the entry link first, while entries are open", () => {
    expect(eventSections({ phase: "before", entriesOpen: true, reportReady: false })).toEqual(["entries", "board"]);
    expect(eventSections({ phase: "before", entriesOpen: false, reportReady: false })).toEqual(["board"]);
  });

  it("on the day: the board and the clubhouse screen, late entries after them", () => {
    expect(eventSections({ phase: "during", entriesOpen: false, reportReady: false })).toEqual(["board", "clubhouse"]);
    expect(eventSections({ phase: "during", entriesOpen: true, reportReady: false })).toEqual(["board", "clubhouse", "entries"]);
  });

  it("afterwards: the report first, no entries and no clubhouse screen", () => {
    expect(eventSections({ phase: "after", entriesOpen: true, reportReady: true })).toEqual(["report", "board"]);
    expect(eventSections({ phase: "after", entriesOpen: false, reportReady: false })).toEqual(["board"]);
  });

  it("a decided cup's report leads even before the committee completes it", () => {
    expect(eventSections({ phase: "during", entriesOpen: false, reportReady: true })).toEqual(["report", "board", "clubhouse"]);
  });
});

describe("whether there is a report to link — the board's rule", () => {
  it("a tournament once complete; never a casual round", () => {
    expect(finalReportReady({ status: "completed", casual: false, cupVerdict: null })).toBe(true);
    expect(finalReportReady({ status: "live", casual: false, cupVerdict: null })).toBe(false);
    expect(finalReportReady({ status: "completed", casual: true, cupVerdict: null })).toBe(false);
  });

  it("a cup once decided, whatever the tournament's status", () => {
    expect(finalReportReady({ status: "live", casual: false, cupVerdict: "won" })).toBe(true);
    expect(finalReportReady({ status: "completed", casual: false, cupVerdict: "open" })).toBe(false);
  });
});

describe("the addresses", () => {
  it("all sit under the board's own token, so New link replaces every one", () => {
    expect(eventLinks("tok")).toEqual({
      event: "/live/tok/event",
      board: "/live/tok",
      clubhouse: "/live/tok?screen=clubhouse",
      report: "/live/tok/report",
    });
  });
});
