import { describe, it, expect } from "vitest";
import { myMatchView, type MatchSides } from "../my-match";
import type { HoleResult } from "../types";

/** A hole string to an array: "AABH" over 18, padded with nulls. */
function H(s: string, total = 18): HoleResult[] {
  const played = [...s].map((c) => (c === "-" ? null : (c as HoleResult)));
  return [...played, ...new Array(Math.max(0, total - played.length)).fill(null)];
}

const NAMES: Record<string, string> = { me: "Ajay", them: "Zoe" };
const sides = (over: Partial<MatchSides> = {}): MatchSides => ({
  meId: "me",
  playerAId: "me",
  playerBId: "them",
  holes: H(""),
  nameOf: (id) => NAMES[id] ?? "",
  ...over,
});

describe("a match, from the point of view of one of its players", () => {
  it("names the other one", () => {
    expect(myMatchView(sides())?.opponent).toBe("Zoe");
    // And from the other end of the same match.
    expect(myMatchView(sides({ meId: "them", playerAId: "me", playerBId: "them" }))?.opponent).toBe("Ajay");
  });

  it("declines a match this player is not in", () => {
    // Rather than guessing a side. A caller that has filtered wrongly must get
    // nothing back, not a match described from the wrong end.
    expect(myMatchView(sides({ meId: "someone-else" }))).toBeNull();
  });

  it("says nothing has started when nothing has", () => {
    const v = myMatchView(sides({ holes: H("") }));
    expect(v?.state).toBe("Not started");
    expect(v?.notStarted).toBe(true);
    expect(v?.complete).toBe(false);
    expect(v?.ahead).toBeNull();
  });
});

/**
 * THE FLIP.
 *
 * `resolveMatch` reports `lead` as A minus B, so every reading has to be
 * negated for the player on the other side of it. Getting this wrong does not
 * fail loudly — it tells half of every field that they are winning a match
 * they are losing, in the app's signature format, on the screen they have open
 * on the tee. The seeded demo happens to put its test player on side A in all
 * three of their matches, so a walk through the app proves only half of this.
 *
 * Every case below is therefore asserted from BOTH ends of the same match, and
 * asserted to disagree.
 */
describe("the same match read from either end", () => {
  const bothEnds = (holes: HoleResult[], forfeitedBy?: string) => ({
    a: myMatchView(sides({ meId: "me", holes, forfeitedBy })),
    b: myMatchView(sides({ meId: "them", holes, forfeitedBy })),
  });

  it("has one player up and the other down, by the same margin", () => {
    // A wins two of the first three; B wins none.
    const { a, b } = bothEnds(H("AAH"));
    expect(a?.state).toBe("2 up");
    expect(b?.state).toBe("2 down");
    expect(a?.ahead).toBe(true);
    expect(b?.ahead).toBe(false);
    // The two readings must differ, or a function ignoring the side entirely
    // satisfies both assertions above.
    expect(a?.state).not.toBe(b?.state);
  });

  it("has one winner and one loser, at the same margin", () => {
    /**
     * A is 2 up with 1 to play after seventeen — the match is over, 2&1.
     * Matches the seeded fixture that was cross-checked against the stored
     * draw on 2026-09-07: A won two holes, B none, seventeen played.
     */
    const { a, b } = bothEnds(H("AA" + "H".repeat(15)));
    expect(a?.state).toBe("Won 2&1");
    expect(b?.state).toBe("Lost 2&1");
    expect(a?.complete).toBe(true);
    expect(b?.complete).toBe(true);
    expect(a?.ahead).toBe(true);
    expect(b?.ahead).toBe(false);
  });

  it("reads a loss from the losing side, not a win from the wrong one", () => {
    // B five up with four to play — 5&4. The other seeded fixture, and the
    // case where an unflipped `lead` would tell the loser they had won.
    const { a, b } = bothEnds(H("BBBBB" + "H".repeat(9)));
    expect(a?.state).toBe("Lost 5&4");
    expect(b?.state).toBe("Won 5&4");
    expect(a?.ahead).toBe(false);
    expect(b?.ahead).toBe(true);
  });

  it("is level for both of them at once", () => {
    const { a, b } = bothEnds(H("ABH"));
    expect(a?.state).toBe("All square");
    expect(b?.state).toBe("All square");
    // Level is neither ahead nor behind, and that is why `ahead` is
    // three-valued: a boolean would make all square read as losing.
    expect(a?.ahead).toBeNull();
    expect(b?.ahead).toBeNull();
  });

  it("is halved for both of them once it is over", () => {
    const { a, b } = bothEnds(H("H".repeat(18)));
    expect(a?.state).toBe("Halved");
    expect(b?.state).toBe("Halved");
    expect(a?.complete).toBe(true);
  });
});

describe("a match that was conceded", () => {
  it("is won by the other player, whatever the card says", () => {
    /**
     * Rule 3.2b(1): a conceded match is over and the opponent has won it.
     *
     * The fixture is the trap — A is 3 up at the point of walking in, so
     * reading the holes would report A winning a match A conceded. The
     * concession has to be checked BEFORE the card, not after.
     */
    const holes = H("AAA");
    const a = myMatchView(sides({ meId: "me", holes, forfeitedBy: "me" }));
    const b = myMatchView(sides({ meId: "them", holes, forfeitedBy: "me" }));
    expect(a?.state).toBe("Conceded");
    expect(a?.ahead).toBe(false);
    expect(b?.state).toBe("Won by concession");
    expect(b?.ahead).toBe(true);
    // Both sides agree it is over.
    expect(a?.complete).toBe(true);
    expect(b?.complete).toBe(true);
    // And neither is told the leader won it.
    expect(a?.state).not.toContain("Won");
  });

  it("ignores an empty concession field", () => {
    // "" is how the column says the match was played, and it must not be read
    // as somebody conceding.
    const v = myMatchView(sides({ holes: H("AA"), forfeitedBy: "" }));
    expect(v?.state).toBe("2 up");
  });
});
