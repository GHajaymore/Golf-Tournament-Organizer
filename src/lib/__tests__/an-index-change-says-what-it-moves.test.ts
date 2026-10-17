import { describe, it, expect } from "vitest";
import {
  planIndexChange,
  indexDecimalRefusal,
  memberPushRefusal,
  indexChangePreview,
  indexChangeDone,
} from "@/lib/domain/index-change";

/**
 * CHANGING A PLAYER'S INDEX SAYS WHAT IT MOVES, BEFORE AND AFTER (2026-10-16).
 *
 * The review panel's rules (docs/handicap-push-brief-2026-10-16.md): a round
 * with a card keeps what it was scored off; a round with its own figure keeps
 * that, since it wins over the index; the member record changes only for a
 * member, held by the club, at the club's organizer's hand.
 */
describe("which rounds an index change moves", () => {
  it("moves the rounds not played, and names the ones it leaves and why", () => {
    const plan = planIndexChange([
      { label: "Round 1", played: true, ownFigure: null },
      { label: "Round 2", played: false, ownFigure: null },
      { label: "Round 3", played: false, ownFigure: 12 },
      { label: "Round 4", played: false, ownFigure: null },
    ]);
    expect(plan.moves).toEqual(["Round 2", "Round 4"]);
    expect(plan.keepsPlayed).toEqual(["Round 1"]);
    expect(plan.keepsOwnFigure).toEqual([{ label: "Round 3", figure: 12 }]);
  });

  it("a played round keeps its figure even where it also holds its own", () => {
    const plan = planIndexChange([{ label: "Round 1", played: true, ownFigure: 9 }]);
    expect(plan.keepsPlayed).toEqual(["Round 1"]);
    expect(plan.keepsOwnFigure).toEqual([]);
  });
});

describe("what may be stored as an index", () => {
  it("one decimal at most", () => {
    expect(indexDecimalRefusal(14.2)).toBeNull();
    expect(indexDecimalRefusal(-2.4)).toBeNull();
    expect(indexDecimalRefusal(14)).toBeNull();
    // Floating point: 0.1 * 3 is not 0.3, and must not read as two decimals.
    expect(indexDecimalRefusal(0.1 * 3)).toBeNull();
    expect(indexDecimalRefusal(14.25)).toMatch(/one decimal/);
  });
});

describe("whether Members may take it", () => {
  const ok = { guest: false, name: "Chris Doe", admin: true, association: false, nineHole: false };
  it("allows the club's organizer, for a member the club keeps the handicap of", () => {
    expect(memberPushRefusal(ok)).toBeNull();
  });
  it("refuses a guest, an association's index, a nine-hole figure and an assistant, each in words", () => {
    expect(memberPushRefusal({ ...ok, guest: true })).toMatch(/no member record/);
    expect(memberPushRefusal({ ...ok, association: true })).toMatch(/Handicap Committee/);
    expect(memberPushRefusal({ ...ok, nineHole: true })).toMatch(/nine-hole/);
    expect(memberPushRefusal({ ...ok, admin: false })).toMatch(/organizer/);
  });
  it("speaks of a society or a league as what it is, not a club", () => {
    expect(memberPushRefusal({ ...ok, guest: true, noun: "society" })).toContain("no member record at this society");
    expect(memberPushRefusal({ ...ok, admin: false, noun: "league" })).toContain("Only the league's organizer");
  });
});

describe("the sentences", () => {
  const plan = planIndexChange([
    { label: "Round 1", played: true, ownFigure: null },
    { label: "Round 2", played: false, ownFigure: null },
    { label: "Round 3", played: false, ownFigure: null },
  ]);
  const words = { name: "Chris Doe", from: 15, to: 14.2, plan, fieldStarted: true, alsoMember: false, otherEntries: [] };

  it("before Save: what moves, what stays and why, and the field", () => {
    const said = indexChangePreview(words);
    expect(said).toContain("Changes Chris Doe's index from 15 to 14.2 for Round 2 and Round 3 of this tournament.");
    expect(said).toContain("Round 1 keeps its figure — it has been played.");
    expect(said).toContain("The rest of the field keep the handicaps they started with.");
    expect(said).not.toContain("Members");
  });

  it("with Members: for every later tournament, and the entries it does not move", () => {
    const said = indexChangePreview({ ...words, alsoMember: true, otherEntries: [{ name: "Spring Meeting", handicap: 15 }] });
    expect(said).toContain("On Members, 14.2 becomes Chris Doe's index for every tournament they enter from now on.");
    expect(said).toContain("Their entry in Spring Meeting keeps 15.");
  });

  it("a plus handicap is written with its plus, both ways", () => {
    expect(indexChangePreview({ ...words, from: -1, to: -2.4 })).toContain("from +1 to +2.4");
  });

  it("a round's own figure is named as winning over the index", () => {
    const own = planIndexChange([{ label: "Round 2", played: false, ownFigure: 12 }]);
    const said = indexChangePreview({ ...words, plan: own });
    expect(said).toContain("No round of this tournament is left to take 14.2.");
    expect(said).toContain("Round 2 keeps the 12 strokes set for it");
  });

  it("after Save: done, where, and what was kept", () => {
    expect(indexChangeDone({ name: "Chris Doe", to: 14.2, plan, alsoMember: true })).toBe(
      "Done. Chris Doe's index is 14.2 for Round 2 and Round 3, and on Members. Round 1 kept its figure.",
    );
  });
});
