import { describe, it, expect } from "vitest";
import { roundDueDay } from "@/lib/domain/knockout-play-by";

/**
 * WHEN A ROUND IS DUE (design 2.1): a knockout's latest play-by day, else its deadline. Worked by hand.
 */
describe("roundDueDay", () => {
  it("a knockout with no deadline is due on the latest play-by day (the final's)", () => {
    expect(roundDueDay({ type: "Bracket Stage", deadline: "", knockoutPlayBy: '{"0":"2027-06-27","1":"2027-06-20"}' })).toBe("2027-06-27");
  });

  it("a map holding only the semi-finals is due on the semi-finals' day", () => {
    expect(roundDueDay({ type: "Bracket Stage", deadline: "", knockoutPlayBy: '{"1":"2027-06-20"}' })).toBe("2027-06-20");
  });

  it("an empty map falls back to the deadline", () => {
    expect(roundDueDay({ type: "Bracket Stage", deadline: "2027-06-30", knockoutPlayBy: "" })).toBe("2027-06-30");
    expect(roundDueDay({ type: "Bracket Stage", deadline: "2027-06-30", knockoutPlayBy: null })).toBe("2027-06-30");
  });

  it("junk JSON falls back to the deadline", () => {
    expect(roundDueDay({ type: "Bracket Stage", deadline: "2027-06-30", knockoutPlayBy: "{nope" })).toBe("2027-06-30");
    expect(roundDueDay({ type: "Bracket Stage", deadline: "", knockoutPlayBy: '{"0":"not a day"}' })).toBe("");
  });

  it("a Stroke Play Round carrying a stale map is due on its deadline only", () => {
    expect(roundDueDay({ type: "Stroke Play Round", deadline: "2027-05-01", knockoutPlayBy: '{"0":"2027-06-27"}' })).toBe("2027-05-01");
    expect(roundDueDay({ type: "Stroke Play Round", deadline: "", knockoutPlayBy: '{"0":"2027-06-27"}' })).toBe("");
  });
});
