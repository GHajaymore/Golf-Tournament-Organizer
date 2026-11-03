import { describe, expect, it } from "vitest";
import { reportCard, reportNewsLine, type ReportCardInput } from "../report-card";

/**
 * THE REPORT'S SHARE CARD AND NEWS LINE (2026-10-23): the club, the event,
 * the champion — "Leads" until it is over — and the figure; a private board's
 * card names nobody; and nothing on it is ever an amount.
 */
const medal: ReportCardInput = {
  event: "Spring Medal",
  club: "Larchfield Golf Club",
  venue: "Braid Hollow",
  completed: true,
  names: ["Jane Doe"],
  figure: "gross 71",
  margin: "by 3",
  highlight: "Eagle · Bob Roe",
};

describe("the report's share card", () => {
  it("names the champion, on the figure, with the club large", () => {
    expect(reportCard(medal, "public")).toEqual({
      kind: "report",
      club: "Larchfield Golf Club",
      event: "Spring Medal",
      label: "Champion",
      names: "Jane Doe",
      figure: "gross 71",
      highlight: "Eagle · Bob Roe",
    });
  });

  it("never says Champion while it is still being played", () => {
    const card = reportCard({ ...medal, completed: false }, "public");
    expect(card.kind === "report" && card.label).toBe("Leads");
    expect(JSON.stringify(card)).not.toMatch(/Champion/);
  });

  it("a shared first place is joint winners, never one name", () => {
    const card = reportCard({ ...medal, names: ["Jane Doe", "Ann Poe"] }, "public");
    expect(card.kind === "report" && [card.label, card.names]).toEqual(["Joint winners", "Jane Doe and Ann Poe"]);
  });

  it("a board that is not public gets a card naming nobody and no tournament", () => {
    for (const v of ["participants", "staff", ""]) {
      const card = reportCard(medal, v);
      expect(card.kind).toBe("private");
      const s = JSON.stringify(card);
      for (const said of ["Jane Doe", "Spring Medal", "Larchfield", "Bob Roe"]) expect(s, v).not.toContain(said);
    }
    // Control: the same input on a public board does name them.
    expect(JSON.stringify(reportCard(medal, "public"))).toContain("Jane Doe");
  });

  it("has no field an amount could be handed in through", () => {
    const card = reportCard(medal, "public");
    expect(Object.keys(card).sort()).toEqual(["club", "event", "figure", "highlight", "kind", "label", "names"]);
  });
});

describe("the news line", () => {
  it("says who won what, by how much, and where", () => {
    expect(reportNewsLine(medal, "public")).toBe("Jane Doe wins the Spring Medal by 3 at Braid Hollow.");
    expect(reportNewsLine({ ...medal, margin: "after a play-off" }, "public")).toBe(
      "Jane Doe wins the Spring Medal after a play-off at Braid Hollow.",
    );
  });

  it("leads, not wins, while it is played; shares, when first is shared", () => {
    expect(reportNewsLine({ ...medal, completed: false }, "public")).toBe("Jane Doe leads the Spring Medal at Braid Hollow.");
    expect(reportNewsLine({ ...medal, names: ["Jane Doe", "Ann Poe"] }, "public")).toBe(
      "Jane Doe and Ann Poe share first place in the Spring Medal at Braid Hollow.",
    );
  });

  it("names nobody on a private board", () => {
    expect(reportNewsLine(medal, "participants")).toBe("Golf results on TourneyHQ.");
  });

  it("a cup is its verdict and its score", () => {
    expect(reportNewsLine({ ...medal, names: [], cup: { score: "5½–2½", verdict: "Reds win the cup" } }, "public")).toBe(
      "Reds win the cup, 5½–2½ at Braid Hollow.",
    );
  });
});
