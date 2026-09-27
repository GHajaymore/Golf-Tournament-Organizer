import { describe, it, expect } from "vitest";
import { roundDaysOf, roundSpanOf } from "../round-span";

/**
 * A tournament with no dates of its own is filed by its ROUNDS' dates on
 * Events (Ajay, 2026-09-26) — the member's calendar already read them, and the
 * two screens disagreed about the seeded knockout: "No dates yet" on one,
 * 5 September on the other.
 */
const r = (playedOn: string, type = "Stroke Play Round") => ({ playedOn, type });

describe("a tournament's days, read off its rounds", () => {
  it("takes the playing rounds' real dates, earliest first, whatever order they are stored in", () => {
    expect(roundDaysOf([r("2026-09-19", "Bracket Stage"), r("2026-09-05", "Round Robin")])).toEqual([
      "2026-09-05",
      "2026-09-19",
    ]);
  });

  it("ignores a stage nobody plays and a value that is not a date", () => {
    expect(roundDaysOf([r("2026-09-12", "Retired Stage Type"), r("next week"), r("")])).toEqual([]);
  });

  it("says the span in the calendar's own short form", () => {
    // en-GB writes September "Sept" — the same month name the app prints elsewhere.
    expect(roundSpanOf([r("2026-09-19"), r("2026-09-05")], "en-GB")).toBe("Sat 5 Sept – Sat 19 Sept");
    expect(roundSpanOf([r("2026-09-05")], "en-GB")).toBe("Sat 5 Sept");
  });

  it("says nothing when no round is dated (the control — no invented date)", () => {
    expect(roundSpanOf([r(""), r("tbc")])).toBe("");
  });
});
