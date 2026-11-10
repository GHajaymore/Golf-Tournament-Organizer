import { describe, it, expect } from "vitest";
import {
  KNOCKOUT_DRAWN,
  KNOCKOUT_LAUNCHED,
  ROUND_ROBIN_APPROVAL_NEEDS_A_FLIGHT,
  ROUND_ROBIN_NEEDS_A_FLIGHT,
  fieldBanner,
  fieldChangeAllowed,
  matchesDrawnWords,
  reserveWords,
  resultsLine,
  unplacedWords,
  withdrawConfirmation,
  type FieldChange,
  type FieldFacts,
} from "@/lib/domain/field-change";
import { DRIFT_PLACE_LINE, shortGroupLine, teedOffCaution } from "@/lib/domain/tee-sheet";
import { resultsLegend } from "@/components/LeaderboardTable";

/**
 * EVERY NEW DAY-OF SENTENCE READS AT A GLANCE (panel review of #1029, must-fix
 * 4): twelve words or fewer, on the desk's screen on the morning. Counted as a
 * reader counts: each sentence of each line, split at its full stop or question
 * mark, words by the spaces between them. Names are one word ("Sam"), as the
 * shortest a name can be — a longer name is the player's, not the sentence's.
 */
const MOST = 12;
const sentences = (text: string) => text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const live = (minutes: number): FieldFacts => ({
  status: "live",
  configUnlocked: false,
  correction: null,
  family: "stroke",
  playedRound: "Round 1",
  flightsConfirmed: false,
  flights: 0,
  knockoutDrawn: false,
  lastTee: { round: "Round 1", day: "2026-11-29", time: "10:40 AM" },
  now: { day: "2026-11-29", minutes },
});
const said = (f: FieldFacts, change: FieldChange) => {
  const v = fieldChangeAllowed(f, change);
  return v.ok ? "" : v.says;
};

const LINES: Record<string, string> = {
  "late entries closed at the tee time": said(live(11 * 60), "add"),
  "flights fixed at the tee time": said(live(11 * 60), "place-in-flight"),
  "the banner's close line": (fieldBanner(live(9 * 60)) ?? []).find((l) => l.startsWith("Late entries close")) ?? "",
  "the withdraw confirmation": withdrawConfirmation("Sam"),
  "the results line, DNS": resultsLine("Sam", false),
  "the results line, WD": resultsLine("Sam", true),
  "the short group": shortGroupLine("Round 2", { name: "Group 3", left: 2 }, { groupOfTwo: "twosome", groupOfThree: "threesome" }) ?? "",
  "the drift banner's pointer": DRIFT_PLACE_LINE,
  "the teed-off caution": teedOffCaution({ name: "Group 2", time: "8:10 AM" }),
  "the results legend": resultsLegend([{ didNotStart: true }, { withdrew: true }, { disqualified: true }] as never),
  // The upstream-change rules for the field (J12, state machine PR 7a).
  "a knockout whose draw is made": KNOCKOUT_DRAWN,
  "a launched knockout": KNOCKOUT_LAUNCHED,
  "a round robin's late entry with no flight": ROUND_ROBIN_NEEDS_A_FLIGHT,
  "a round robin's approval": ROUND_ROBIN_APPROVAL_NEEDS_A_FLIGHT,
  "the unplaced flag": unplacedWords(["Sam"]),
  "the unplaced flag, two": unplacedWords(["Sam", "Pat"]),
  "a round robin's matches drawn": matchesDrawnWords("Sam", "Flight A"),
  "a reserve added": reserveWords("Sam"),
  "a round robin's confirmed draw": said({ ...live(9 * 60), family: "roundRobinFlights", playedRound: null, flightsConfirmed: true, flights: 2 }, "add-to-flight"),
};

describe("the day-of words read at a glance", () => {
  for (const [what, text] of Object.entries(LINES)) {
    it(`${what}: every sentence ${MOST} words or fewer`, () => {
      expect(text, `${what} should have words`).not.toBe("");
      for (const s of sentences(text)) expect(words(s), s).toBeLessThanOrEqual(MOST);
    });
  }

  it("CONTROL: the count sees a long sentence", () => {
    const long = "The first card of Round 1 is in, so late entries are closed.";
    expect(sentences(`${long} Short one.`).map(words)).toEqual([13, 2]);
  });
});
