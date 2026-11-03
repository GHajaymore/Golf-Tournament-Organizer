import { describe, it, expect } from "vitest";
import {
  defaultAnswers,
  draftAllowances,
  draftFromAnswers,
  nextSaturday,
  parseSetupAnswers,
  reconcile,
  scoringChoices,
  type SetupAnswers,
} from "@/lib/domain/setup-questions";

/**
 * THE SETUP QUESTIONNAIRE'S DRAFTS, one per setup the panel agreed (2 Nov).
 *
 * The allowance each round is played off is worked from the Rules of
 * Handicapping, Appendix C, and written here as a FIGURE — never read back
 * from `recommendedAllowance` — so a change to the app's table that breaks
 * the Rules turns this red:
 *
 *   individual stroke play / Stableford           95%
 *   four-ball stroke play                         85%
 *   foursomes                                     50% of the side's combined
 *   singles match play                            100%
 *   four-ball match play                          90%
 *   four-person scramble                          25% (the app carries the
 *                                                 first share of 25/20/15/10)
 */

// Wednesday 4 November 2026 at the club. The next Saturday is the 7th.
const TODAY = "2026-11-04";
const base = (patch: Partial<SetupAnswers>): SetupAnswers =>
  reconcile({ ...defaultAnswers("us", TODAY), name: "zz-setup", ...patch }, "us");

describe("the questionnaire's defaults", () => {
  it("starts on the next Saturday of the CLUB's day, a week ahead when today is one", () => {
    expect(nextSaturday(TODAY)).toBe("2026-11-07");
    expect(nextSaturday("2026-11-07")).toBe("2026-11-14");
    expect(nextSaturday("2026-11-08")).toBe("2026-11-14");
  });

  it("offers medal first in US golf and Stableford first in British and Australian golf", () => {
    expect(scoringChoices("day", "own", "us")[0].value).toBe("stroke");
    expect(scoringChoices("day", "own", "uk")[0].value).toBe("stableford");
    expect(scoringChoices("day", "own", "au")[0].value).toBe("stableford");
  });

  it("makes a real tournament when every default is kept", () => {
    const d = draftFromAnswers(base({}));
    expect(d.setup).toBe("medal");
    expect(d.rounds).toHaveLength(1);
    expect(d.rounds[0].playedOn).toBe("2026-11-07");
  });
});

describe("one draft per setup", () => {
  it("1 · one-day medal: one stroke play round, net, 95%", () => {
    const d = draftFromAnswers(base({ running: "day", sides: "own", scoring: "stroke", basis: "net" }));
    expect(d.setup).toBe("medal");
    expect(d.shape).toBe("single");
    expect(d.rounds).toEqual([
      expect.objectContaining({ type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "net", holes: 18, playedOn: "2026-11-07" }),
    ]);
    expect(draftAllowances(d).map((a) => a.percent)).toEqual([95]);
    expect([d.startOn, d.endOn]).toEqual(["2026-11-07", "2026-11-07"]);
  });

  it("2 · one-day Stableford: points off handicap, 95%, never gross", () => {
    const d = draftFromAnswers(base({ scoring: "stableford", basis: "gross" }));
    expect(d.setup).toBe("stableford");
    expect(d.rounds[0]).toMatchObject({ format: "Stableford", scoringBasis: "net" });
    expect(draftAllowances(d)[0].percent).toBe(95);
  });

  it("3 · four-ball better ball: four-ball STROKE play, 85%", () => {
    const d = draftFromAnswers(base({ sides: "pairs", scoring: "four-ball" }));
    expect(d.setup).toBe("four-ball");
    expect(d.rounds[0]).toMatchObject({ type: "Stroke Play Round", format: "Four-Ball" });
    expect(draftAllowances(d)[0].percent).toBe(85);
  });

  it("4 · foursomes: 50% of the pair's combined", () => {
    const d = draftFromAnswers(base({ sides: "pairs", scoring: "foursomes" }));
    expect(d.setup).toBe("foursomes");
    expect(d.rounds[0].format).toBe("Foursomes");
    expect(draftAllowances(d)[0].percent).toBe(50);
  });

  it("5 · scramble: teams of four, 25%, players score on their phones", () => {
    const d = draftFromAnswers(base({ sides: "teams" }));
    expect(d.setup).toBe("scramble");
    expect(d.rounds[0]).toMatchObject({ type: "Stroke Play Round", format: "Scramble", scoringBasis: "net" });
    expect(draftAllowances(d)[0].percent).toBe(25);
    expect(d.settings.scoreEntryBy).toBe("players");
  });

  it("6 · two-day outing: two rounds on consecutive days, one result", () => {
    const d = draftFromAnswers(base({ running: "days", count: 2, scoring: "stroke" }));
    expect(d.setup).toBe("outing");
    expect(d.shape).toBe("series");
    expect(d.rounds.map((r) => r.playedOn)).toEqual(["2026-11-07", "2026-11-08"]);
    expect(d.rounds.map((r) => r.description)).toEqual(["Day 1 of 2", "Day 2 of 2"]);
    expect([d.startOn, d.endOn]).toEqual(["2026-11-07", "2026-11-08"]);
    expect(draftAllowances(d).map((a) => a.percent)).toEqual([95]);
  });

  it("6b · three days runs across a month end", () => {
    const d = draftFromAnswers(base({ running: "days", count: 3, firstDay: "2026-11-29" }));
    expect(d.rounds.map((r) => r.playedOn)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
  });

  it("7 · weekly league: one round a week, regulars in unless they say", () => {
    const d = draftFromAnswers(base({ running: "league", count: 10, scoring: "stableford" }));
    expect(d.setup).toBe("league");
    expect(d.rounds).toHaveLength(10);
    expect(d.rounds[1].playedOn).toBe("2026-11-14");
    expect(d.rounds[9].playedOn).toBe("2027-01-09");
    expect(d.settings.attendanceMode).toBe("opt-out");
  });

  it("8 · singles knockout: one bracket, match play, 100%", () => {
    const d = draftFromAnswers(base({ running: "knockout", sides: "own" }));
    expect(d.setup).toBe("knockout");
    expect(d.shape).toBe("knockout");
    expect(d.rounds).toEqual([expect.objectContaining({ type: "Bracket Stage", format: "Match Play", playedOn: "" })]);
    expect(draftAllowances(d)[0].percent).toBe(100);
  });

  it("8b · four-ball knockout: four-ball MATCH play, 90%", () => {
    const d = draftFromAnswers(base({ running: "knockout", sides: "pairs" }));
    expect(d.rounds[0]).toMatchObject({ type: "Bracket Stage", format: "Four-Ball" });
    expect(draftAllowances(d)[0].percent).toBe(90);
  });

  it("9 · team cup: three sessions over the days asked, 90 / 50 / 100", () => {
    const d = draftFromAnswers(base({ running: "cup", count: 2 }));
    expect(d.setup).toBe("team-cup");
    expect(d.rounds.map((r) => [r.type, r.format, r.playedOn])).toEqual([
      ["Team Session", "Four-Ball", "2026-11-07"],
      ["Team Session", "Foursomes", "2026-11-08"],
      ["Team Session", "Match Play", "2026-11-08"],
    ]);
    expect(draftAllowances(d).map((a) => a.percent)).toEqual([90, 50, 100]);
  });

  it("scratch is stored gross; who keeps the scores is laid over the template", () => {
    const d = draftFromAnswers(base({ basis: "gross", keeper: "committee" }));
    expect(d.rounds[0].scoringBasis).toBe("gross");
    expect(d.settings).toMatchObject({ scoreEntryBy: "staff", scoreEntryWindow: "after", scoreApproval: "staff" });
    // A field scoring on its phones sees its own board — never the championship's blind one.
    expect(draftFromAnswers(base({ keeper: "players" })).settings.leaderboardVisibility).not.toBe("staff");
  });
});

describe("the boundary", () => {
  const ok = { ...base({}), name: "zz-setup" };
  it("takes what the screen sends", () => {
    expect(parseSetupAnswers(ok, "us").ok).toBe(true);
  });
  it.each([
    ["not an object", null, "could not be read"],
    ["an unknown kind of event", { ...ok, running: "pub-crawl" }, "what you are running"],
    ["a casual round", { ...ok, running: "casual" }, "own screen"],
    ["a format the event does not offer", { ...ok, sides: "teams", scoring: "stroke" }, "not one of the choices"],
    ["no date", { ...ok, firstDay: "soon" }, "first day"],
    ["a league of 400 weeks", { ...ok, running: "league", count: 400 }, "Between 2 and 26"],
    ["a course without tees named", { ...ok, courseId: "c1", teeId: "" }, "tees"],
    ["a course whose card nobody checked", { ...ok, courseId: "c1", teeId: "t1", cardChecked: false }, "Check the card"],
    ["no name", { ...ok, name: "  " }, "name"],
  ])("refuses %s, in words", (_, raw, words) => {
    const r = parseSetupAnswers(raw, "us");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(words);
  });
});

describe("fixing the card on the course's own screen", () => {
  const ok = { ...base({}), name: "zz-setup" };
  it("takes a course with no tees chosen when the organizer will fix the card after the draft is made", () => {
    const r = parseSetupAnswers({ ...ok, courseId: "c1", teeId: "", fixCard: true }, "us");
    expect(r.ok).toBe(true);
    // Never "checked": the tick is given on the card screen, after the fix.
    if (r.ok) expect([r.answers.fixCard, r.answers.cardChecked]).toEqual([true, false]);
  });
  it("does not let a fix-later card arrive marked checked", () => {
    const r = parseSetupAnswers({ ...ok, courseId: "c1", teeId: "t1", cardChecked: true, fixCard: true }, "us");
    expect(r.ok && r.answers.cardChecked).toBe(false);
  });
});

describe("going back keeps the answers", () => {
  it("changing what is run keeps the date and the keeper, and fixes only what no longer fits", () => {
    const a = base({ sides: "teams", firstDay: "2026-12-05", keeper: "committee" });
    const b = reconcile({ ...a, running: "knockout" }, "us");
    expect(b.sides).toBe("own");
    expect(b.firstDay).toBe("2026-12-05");
    expect(b.keeper).toBe("committee");
  });
});
