import { describe, it, expect } from "vitest";
import {
  resultsCard,
  fitName,
  fitSubtitle,
  scoreOf,
  thruOf,
  CARD_ROWS,
  type BoardForCard,
} from "@/lib/domain/results-card";

/**
 * The share-link preview.
 *
 * The privacy half of this is the half that matters. A preview image is
 * fetched by servers nobody at the club chose — Meta, Slack, Apple — and
 * cached there. So the tests that would catch a leak come first and are
 * written as absolutes: not "shows less", but "contains no name at all".
 */

const board = (over: Partial<BoardForCard> = {}): BoardForCard => ({
  name: "Captain's Day",
  dates: "May 14, 2026",
  venue: "Blue Ash Golf Course",
  roundLabel: "Round 2",
  rows: [
    { rank: 1, name: "Hannah Voss", toPar: "-4", thru: "F", ranked: true },
    { rank: 2, name: "Jack Mercer", toPar: "-2", thru: "F", ranked: true },
    { rank: 3, name: "Diego Alvarez", toPar: "E", thru: "16", ranked: true },
    { rank: 4, name: "Tom Halloran", toPar: "+1", thru: "F", ranked: true },
    { rank: 5, name: "Grace Okafor", toPar: "+3", thru: "14", ranked: true },
    { rank: 6, name: "Lucia Romano", toPar: "+5", thru: "F", ranked: true },
    { rank: 7, name: "Aisha Rahman", toPar: "+6", thru: "F", ranked: true },
  ],
  ...over,
});

/** Everything a card could possibly render, flattened, so a leak cannot hide. */
const everythingOn = (card: ReturnType<typeof resultsCard>): string => JSON.stringify(card);

describe("a share card never shows what the board would not", () => {
  for (const visibility of ["staff", "participants", "", "PUBLIC", "public-ish", "anything"]) {
    it(`discloses nothing for visibility "${visibility}"`, () => {
      const card = resultsCard(board(), visibility, "Demo Golf Club");
      expect(card.kind).toBe("private");

      const text = everythingOn(card);
      for (const secret of [
        "Hannah",
        "Voss",
        "Mercer",
        "Captain",
        "Demo Golf Club",
        "Blue Ash",
        "Round 2",
      ]) {
        expect(text, `"${secret}" reached a card that must disclose nothing`).not.toContain(secret);
      }
    });
  }

  it("does not even leak how many people are playing", () => {
    // A count is a disclosure. "17 players" tells a competitor the size of a
    // club's field, and tells anyone the event is real and running.
    const card = resultsCard(board(), "participants", "Demo Golf Club");
    expect(everythingOn(card)).not.toMatch(/\b\d+\b/);
  });

  it("stays private when there is no board at all", () => {
    expect(resultsCard(null, "public", "Demo Golf Club").kind).toBe("private");
  });

  it("only opens up on exactly \"public\"", () => {
    expect(resultsCard(board(), "public", "Demo Golf Club").kind).toBe("standings");
  });
});

describe("a public card is worth looking at", () => {
  const card = () => resultsCard(board(), "public", "Demo Golf Club");

  it("leads with the leader", () => {
    const c = card();
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(c.rows[0]).toMatchObject({ rank: 1, name: "Hannah Voss", score: "-4", thru: "F" });
  });

  it("shows a glanceable number of rows, not the whole field", () => {
    const c = card();
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(c.rows).toHaveLength(CARD_ROWS);
    expect(c.more, "the rest of the field should be counted, not dropped silently").toBe(2);
  });

  it("names the club and the tournament", () => {
    const c = card();
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(c.club).toBe("Demo Golf Club");
    expect(c.event).toBe("Captain's Day");
    expect(c.subtitle).toBe("Round 2 · Blue Ash Golf Course · May 14, 2026");
  });

  it("leaves no stray separator when a tournament has no venue or dates", () => {
    const c = resultsCard(board({ venue: "", dates: "" }), "public", "Demo Golf Club");
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(c.subtitle).toBe("Round 2");
  });

  it("says live only while somebody is still out there", () => {
    const running = card();
    expect(running.kind === "standings" && running.live).toBe(true);

    const done = resultsCard(
      board({ rows: board().rows.map((r) => ({ ...r, thru: "F" })) }),
      "public",
      "Demo Golf Club",
    );
    // A finished tournament labelled "live" is a small lie, and a card that
    // lies about one thing is not trusted about the scores either.
    expect(done.kind === "standings" && done.live).toBe(false);
  });

  it("leaves unranked players off", () => {
    // Withdrawn, no-return, not started: they are not in the standings on the
    // page, so they are not in the picture of it.
    const c = resultsCard(
      board({ rows: [{ rank: 0, name: "Withdrawn Player", ranked: false }, ...board().rows] }),
      "public",
      "Demo Golf Club",
    );
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(everythingOn(c)).not.toContain("Withdrawn");
  });

  it("survives a tournament nobody has scored yet", () => {
    const c = resultsCard(board({ rows: [] }), "public", "Demo Golf Club");
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(c.rows).toEqual([]);
    expect(c.more).toBe(0);
    expect(c.live).toBe(false);
  });
});

describe("the score shown is the board's own", () => {
  it("uses a match-play record when there is one", () => {
    expect(scoreOf({ rank: 1, name: "A", record: "3-0-0", toPar: "-4" })).toBe("3-0-0");
  });

  it("uses points for a Stableford", () => {
    expect(scoreOf({ rank: 1, name: "A", points: 38 })).toBe("38 pts");
  });

  it("uses to-par for stroke play", () => {
    expect(scoreOf({ rank: 1, name: "A", toPar: "-4" })).toBe("-4");
  });

  it("keeps level par as the board writes it", () => {
    expect(scoreOf({ rank: 1, name: "A", toPar: "E" })).toBe("E");
  });

  it("says nothing rather than zero for a player who has not started", () => {
    // "0" and "E" are both claims about a round that has not happened.
    expect(scoreOf({ rank: 1, name: "A" })).toBe("");
    expect(scoreOf({ rank: 1, name: "A", toPar: null, points: null, record: "" })).toBe("");
  });
});

describe("names fit without becoming anonymous", () => {
  it("leaves an ordinary name alone", () => {
    expect(fitName("Hannah Voss")).toBe("Hannah Voss");
  });

  it("cuts a long name at a word boundary", () => {
    const out = fitName("Christopher Wetherby-Pemberton");
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("Christopher");
    // Cutting mid-word turns a person into a typo.
    expect(out).not.toMatch(/[a-z]…$/);
  });

  it("still cuts a single very long word", () => {
    const out = fitName("Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(out.length).toBeLessThanOrEqual(22);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not fall over on an empty name", () => {
    expect(fitName("")).toBe("");
  });
});
describe("the three things the first rendered card got wrong", () => {
  it("prints no through-count when the format has none", () => {
    /**
     * A match-play board carries thru: 0 on every row, and the first card
     * built from this printed a meaningless "0" beside every completed match.
     * Nought holes played and "this format does not count holes" are both
     * absences, and neither belongs next to somebody's name.
     */
    expect(thruOf(0)).toBe("");
    expect(thruOf("0")).toBe("");
    expect(thruOf(null)).toBe("");
    expect(thruOf(undefined)).toBe("");
    expect(thruOf("")).toBe("");
  });

  it("still prints a real through-count", () => {
    expect(thruOf(14)).toBe("14");
    expect(thruOf("14")).toBe("14");
    expect(thruOf("F")).toBe("F");
    expect(thruOf("f")).toBe("F");
  });

  it("does not call a finished match-play event live", () => {
    // Every row complete, thru: 0 because the format has no hole count. The
    // first version read that 0 as "out on the course" and stamped LIVE on a
    // finished tournament.
    const matchPlay = board({
      rows: [
        { rank: 1, name: "Hannah Voss", record: "3-0-0", thru: 0, ranked: true },
        { rank: 2, name: "Jack Mercer", record: "2-1-0", thru: 0, ranked: true },
      ],
    });
    const c = resultsCard(matchPlay, "public", "Demo Golf Club");
    expect(c.kind === "standings" && c.live).toBe(false);
    expect(c.kind === "standings" && c.rows[0].thru).toBe("");
  });

  it("keeps the header short enough to leave room for the standings", () => {
    /**
     * roundLabel can be a whole sentence — a round robin describes itself as
     * "Every player meets every other in their group over 3 rounds." — and
     * with a venue and dates after it the subtitle wrapped to three lines and
     * pushed the footer off the bottom of a fixed-height image.
     */
    const wordy = board({
      roundLabel: "Every player meets every other in their group over 3 rounds.",
      venue: "Blue Ash Golf Course, Blue Ash, OH",
      dates: "May 14-16, 2026",
    });
    const c = resultsCard(wordy, "public", "Demo Golf Club");
    if (c.kind !== "standings") throw new Error("expected standings");
    expect(c.subtitle.length).toBeLessThanOrEqual(80);
    expect(c.subtitle.endsWith("…")).toBe(true);
  });

  it("does not truncate a subtitle that already fits", () => {
    expect(fitSubtitle("Round 2 · Blue Ash")).toBe("Round 2 · Blue Ash");
  });

  it("leaves no dangling separator when it cuts", () => {
    // A cut must not end mid-separator, which reads as a rendering fault.
    const out = fitSubtitle("A".repeat(70) + " · Blue Ash Golf Course · May 2026");
    expect(out).not.toMatch(/[·\s]…$/);
  });
});
