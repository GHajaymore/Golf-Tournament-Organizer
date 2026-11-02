import { describe, it, expect } from "vitest";
import { contestTitle, shownOnBoard, sponsorUrl, sponsorsToThank } from "../contest-board";

/**
 * The contests a public board announces, and their sponsors (2026-10-17). The
 * browser half — the organizer saving a sponsor, a refusal said beside the
 * press, the board showing winner and sponsor — is `e2e/contest-sponsor.spec.ts`.
 */

describe("a sponsor's website", () => {
  it("is kept as an https address, with the scheme added when it was left off", () => {
    expect(sponsorUrl("https://smithmotors.example/")).toBe("https://smithmotors.example/");
    expect(sponsorUrl("smithmotors.example")).toBe("https://smithmotors.example/");
    expect(sponsorUrl("  ")).toBe("");
  });

  it("refuses anything a public board should not link to", () => {
    for (const bad of ["http://smithmotors.example", "javascript:alert(1)", "data:text/html,hi", "ftp://x.example", "localhost", "not a site", `https://${"a".repeat(200)}.example`]) {
      expect(sponsorUrl(bad), bad).toBeNull();
    }
  });
});

describe("what the board names a contest", () => {
  it("by its kind and hole, or by the organizer's own name", () => {
    expect(contestTitle({ kind: "closest-pin", name: "Closest to the pin", hole: 7 })).toBe("Closest to the pin · 7th");
    expect(contestTitle({ kind: "long-drive", name: "", hole: 12 })).toBe("Long drive · 12th");
    expect(contestTitle({ kind: "closest-pin", name: "KP 3rd", hole: 3 })).toBe("KP 3rd");
    expect(contestTitle({ kind: "closest-pin", name: "Nearest the pin", hole: 0 })).toBe("Nearest the pin");
    expect(contestTitle({ kind: "long-drive", name: "", hole: 11 })).toBe("Long drive · 11th");
    expect(contestTitle({ kind: "long-drive", name: "", hole: 2 })).toBe("Long drive · 2nd");
  });

  it("only for what a club announces: not the poker, not four friends' side bet", () => {
    expect(shownOnBoard("closest-pin")).toBe(true);
    expect(shownOnBoard("long-drive")).toBe(true);
    expect(shownOnBoard("straightest-drive")).toBe(true);
    expect(shownOnBoard("off-course")).toBe(false);
    expect(shownOnBoard("other")).toBe(false);
  });
});

/**
 * STRAIGHTEST DRIVE (2026-10-24) is the long drive's shape: a hole, a named
 * winner, an optional sponsor, the same board and printed sheet. Pinned beside
 * the long drive so a later edit that gives one a path the other lacks shows.
 */
describe("a straightest drive is a contest like the long drive", () => {
  it("is a kind the editor offers, played on a hole, named by kind and hole", async () => {
    const { CONTEST_KINDS, CONTEST_LABEL, contestHasHole, isContestKind } = await import("../contests");
    expect(CONTEST_KINDS).toContain("straightest-drive");
    expect(isContestKind("straightest-drive")).toBe(true);
    expect(CONTEST_LABEL["straightest-drive"]).toBe("Straightest drive");
    expect(contestHasHole("straightest-drive")).toBe(contestHasHole("long-drive"));
    expect(contestTitle({ kind: "straightest-drive", name: "", hole: 10 })).toBe("Straightest drive · 10th");
    expect(contestTitle({ kind: "straightest-drive", name: "Straightest drive", hole: 3 })).toBe("Straightest drive · 3rd");
  });

  it("pays out by the one contest rule, exactly as a long drive with the same entrants would", async () => {
    const { contestNets } = await import("../contests");
    const base = { id: "c", name: "", buyInCents: 500, entrantIds: ["a", "b", "c"], winnerIds: ["b"] };
    expect(contestNets({ ...base, kind: "straightest-drive" })).toEqual(contestNets({ ...base, kind: "long-drive" }));
  });
});

describe("the sponsors thanked", () => {
  it("once each, in the order they came, keeping a website if any contest gave one", () => {
    expect(
      sponsorsToThank([
        { sponsorName: "Smith Motors", sponsorUrl: "" },
        { sponsorName: "", sponsorUrl: "" },
        { sponsorName: "Bay Bakery", sponsorUrl: "https://bay.example/" },
        { sponsorName: "smith motors", sponsorUrl: "https://smith.example/" },
      ]),
    ).toEqual([
      { name: "Smith Motors", url: "https://smith.example/" },
      { name: "Bay Bakery", url: "https://bay.example/" },
    ]);
  });
});
