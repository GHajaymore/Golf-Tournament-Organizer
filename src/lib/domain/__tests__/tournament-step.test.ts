import { describe, it, expect } from "vitest";
import { tournamentStatus, STEP_TAG, type TournamentFacts } from "../tournament-status";
import { stepOf, listWordOf, DATES_PASSED_WORD } from "../tournament-step";
import { FAMILIES, FAMILY_FIXTURES, completed, facts, launched, playedOut, round } from "./tournament-facts-fixtures";

/**
 * THE STEP ALONE, AND THE TOURNAMENTS LIST'S WORD (state machine PR 6).
 *
 * `stepOf` narrows the machine's answer to where the tournament is; it must
 * never decide anything itself, so every field is held to `tournamentStatus`
 * across every family at every step. The list's word is the machine's chip,
 * except "Dates passed, not launched", which is the machine's own warning —
 * worked here from the Tournaments list's rule (the last day, endOn or startOn,
 * before the club's today, and never launched), by a route the code does not
 * take.
 */

const word = (f: TournamentFacts) => listWordOf(stepOf(tournamentStatus(f)));

describe("stepOf is the machine's step, and nothing of its own", () => {
  it("agrees with tournamentStatus in every family at every step", () => {
    for (const family of FAMILIES) {
      const base = FAMILY_FIXTURES[family]();
      for (const f of [base, launched(base), playedOut(base), completed(base)]) {
        const st = tournamentStatus(f);
        const s = stepOf(st);
        expect(s.step, family).toBe(st.step);
        expect(s.chip, family).toBe(st.chip);
        expect(s.tag, family).toBe(STEP_TAG[st.step]);
        expect(s.journey, family).toBe(st.journey);
        expect(s.chipDetail, family).toBe(st.chipDetail);
        expect(s.underWayUnlaunched, family).toBe(st.underWayUnlaunched);
      }
    }
  });
});

describe("the Tournaments list's status word", () => {
  it("is the dashboard's chip at every step", () => {
    expect(word(facts())).toEqual({ label: "Setting up", tag: "tag-neutral" });
    expect(word(launched(facts()))).toEqual({ label: "Live", tag: "tag-accent-2" });
    expect(word(playedOut(facts()))).toEqual({ label: "Play over", tag: "tag-accent" });
    expect(word(completed(facts()))).toEqual({ label: "Completed", tag: "tag-neutral" });
  });

  it("a knockout with its Final decided is Play over — the stored word said Live (D3)", () => {
    const ko = playedOut(FAMILY_FIXTURES.knockout());
    expect(ko.status).toBe("live");
    expect(word(ko).label).toBe("Play over");
  });

  it("a draft with results in says so (D2, D5)", () => {
    expect(word(facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] })).label).toBe("Setting up · results in");
  });

  it("says Dates passed, not launched exactly when the last day went by unlaunched", () => {
    const today = "2026-11-03";
    // The rule, by hand: last = endOn || startOn; passed when last < today and not launched.
    const cases: { startOn: string; endOn: string; status: string; passed: boolean }[] = [
      { startOn: "2026-09-26", endOn: "2026-09-26", status: "draft", passed: true },
      { startOn: "2026-07-30", endOn: "2026-09-26", status: "registration", passed: true },
      // The last day itself is still today's.
      { startOn: "2026-11-03", endOn: "2026-11-03", status: "draft", passed: false },
      // A multi-day event whose first day went by but last day has not.
      { startOn: "2026-11-01", endOn: "2026-11-05", status: "draft", passed: false },
      // No end day: the first day is the last.
      { startOn: "2026-11-02", endOn: "", status: "ready", passed: true },
      // Undated has passed nothing.
      { startOn: "", endOn: "", status: "draft", passed: false },
      // Launched: never "not launched".
      { startOn: "2026-09-26", endOn: "2026-09-26", status: "live", passed: false },
      { startOn: "2026-09-26", endOn: "2026-09-26", status: "completed", passed: false },
    ];
    for (const c of cases) {
      const w = word(facts({ today, startOn: c.startOn, endOn: c.endOn, status: c.status }));
      expect(w.label === DATES_PASSED_WORD.label, JSON.stringify(c)).toBe(c.passed);
      if (c.passed) expect(w.tag).toBe("tag-outline");
    }
  });
});
