import { describe, it, expect } from "vitest";
import { needsYouNow } from "@/lib/domain/needs-you-now";

/**
 * WHAT NEEDS THE ORGANIZER, IN ONE PLACE — Ajay, 2026-10-05 ("I just want a
 * clean user experience"). On the day, the dashboard said it in three places:
 * a disputed-result paragraph, an "Awaiting review" tile and "1 disputed"
 * under the round. Each was right, and an organizer on a phone had to find all
 * three. This is the list: one line per thing to do, each with where to do it.
 *
 * Built only from a fact the dashboard already computes — `state.reviewing` —
 * so it cannot disagree with the counts beside it. A cut ready to approve is
 * its own card inside the same section (`CutReadyCard`, with its preview and
 * button), so it is not repeated here as a line.
 */

const quiet = { matches: 0, cards: 0, knockouts: 0, total: 0, disputed: 0 };

describe("the organizer's to-do list on the day", () => {
  it("is empty when nothing needs anybody — the control", () => {
    expect(needsYouNow({ reviewing: quiet })).toEqual([]);
  });

  it("puts a disputed result first, and sends it to Score entry", () => {
    const items = needsYouNow({ reviewing: { ...quiet, disputed: 1, cards: 2, total: 2 } });
    expect(items[0]).toEqual({ key: "disputed", text: "1 disputed result to settle", href: "/entry", action: "Settle it" });
  });

  it("counts cards and match results to approve as one line, worded for both", () => {
    const items = needsYouNow({ reviewing: { ...quiet, cards: 3, matches: 1, total: 4 } });
    expect(items).toEqual([{ key: "review", text: "3 cards and 1 match result to approve", href: "/entry", action: "Review" }]);
  });

  it("singular and plural read right", () => {
    expect(needsYouNow({ reviewing: { ...quiet, cards: 1, total: 1 } })[0].text).toBe("1 card to approve");
    expect(needsYouNow({ reviewing: { ...quiet, matches: 2, total: 2 } })[0].text).toBe(
      "2 match results to approve",
    );
  });

  it("sends a reported knockout result to the draw, where it is approved", () => {
    const items = needsYouNow({ reviewing: { ...quiet, knockouts: 1, total: 1 } });
    expect(items).toEqual([{ key: "knockouts", text: "1 knockout result reported", href: "/bracket", action: "Review" }]);
  });

  it("orders them: settle disputes first, then approve", () => {
    const keys = needsYouNow({
      reviewing: { matches: 0, cards: 1, knockouts: 1, total: 2, disputed: 1 },
    }).map((i) => i.key);
    expect(keys).toEqual(["disputed", "review", "knockouts"]);
  });
});
