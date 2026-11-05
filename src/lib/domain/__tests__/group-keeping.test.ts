import { describe, it, expect } from "vitest";
import { groupKeyFor, groupMembers, mayKeep, WHOLE_ROUND, type KeepingContext } from "@/lib/domain/group-keeping";

/**
 * GROUPS COME FROM THE PUBLISHED DRAW (2026-11-05, PM, Golf Pro and
 * Tournament Director).
 *
 * A group is who walked off the tee together, or the match drawn between two
 * sides. With neither — a medal whose tee sheet is not published yet — a
 * TOURNAMENT round has no groups, and each player keeps their own card. The
 * old rule made the whole field one group, so the first player to save kept
 * every card in the tournament and everybody else was refused their own.
 * The whole round as one group is only for a casual round: four friends with
 * no sheet and no draw, who are, in fact, one group.
 */

const none: KeepingContext = { teeGroups: [], matches: [], casual: false };

describe("groupKeyFor — a tournament round", () => {
  it("with no published sheet and no match, a player is in no group: each keeps their own card", () => {
    expect(groupKeyFor("ann", none)).toBeNull();
    expect(groupKeyFor("bea", none)).toBeNull();
  });

  it("never makes the whole field one group", () => {
    const field = ["ann", "bea", "cat", "dot", "eve"];
    for (const id of field) expect(groupKeyFor(id, none)).not.toBe(WHOLE_ROUND);
  });

  it("a published tee group is the group, keyed by who is in it", () => {
    const ctx: KeepingContext = { ...none, teeGroups: [["bea", "ann"], ["cat"]] };
    expect(groupKeyFor("ann", ctx)).toBe("tee:ann,bea");
    expect(groupKeyFor("bea", ctx)).toBe("tee:ann,bea");
    expect(groupKeyFor("cat", ctx)).toBe("tee:cat");
  });

  it("a player missing from the published sheet keeps their own card, not the field's", () => {
    const ctx: KeepingContext = { ...none, teeGroups: [["ann", "bea"]] };
    expect(groupKeyFor("dot", ctx)).toBeNull();
  });

  it("the match drawn is the group when no sheet is published (a four-ball is its own group)", () => {
    const ctx: KeepingContext = { ...none, matches: [{ id: "m1", sideA: ["ann", "bea"], sideB: ["cat", "dot"] }] };
    expect(groupKeyFor("ann", ctx)).toBe("match:m1");
    expect(groupKeyFor("dot", ctx)).toBe("match:m1");
    expect(groupKeyFor("eve", ctx)).toBeNull();
  });

  it("a player in two matches of one round (a round robin) keeps their own", () => {
    const ctx: KeepingContext = {
      ...none,
      matches: [
        { id: "m1", sideA: ["ann"], sideB: ["bea"] },
        { id: "m2", sideA: ["ann"], sideB: ["cat"] },
      ],
    };
    expect(groupKeyFor("ann", ctx)).toBeNull();
    expect(groupKeyFor("bea", ctx)).toBe("match:m1");
  });
});

describe("groupKeyFor — a casual round", () => {
  it("with no sheet and no draw, the friends are one group", () => {
    const casual: KeepingContext = { ...none, casual: true };
    expect(groupKeyFor("ann", casual)).toBe(WHOLE_ROUND);
    expect(groupMembers(WHOLE_ROUND, casual, ["ann", "bea"])).toEqual(["ann", "bea"]);
  });

  it("CONTROL: the same context as a tournament has no group at all", () => {
    expect(groupKeyFor("ann", { ...none, casual: false })).toBeNull();
  });
});

describe("mayKeep — the take-over and its epoch", () => {
  const nameOf = (id: string) => ({ ann: "Ann", bea: "Bea" })[id] ?? "";

  it("the scorer holding the current epoch may save", () => {
    expect(mayKeep({ actorId: "ann", keeper: { playerId: "ann", epoch: 2 }, epoch: 2, nameOf })).toEqual({ ok: true, epoch: 2 });
  });

  it("a phone holding an epoch from before a take-over is refused in words, never silently", () => {
    const d = mayKeep({ actorId: "ann", keeper: { playerId: "ann", epoch: 3 }, epoch: 2, nameOf });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/moved to another phone/);
  });

  it("an epoch from AFTER the row (forged or confused) is refused too: only the current one writes", () => {
    expect(mayKeep({ actorId: "ann", keeper: { playerId: "ann", epoch: 1 }, epoch: 2, nameOf }).ok).toBe(false);
  });

  it("somebody else in the group is refused, naming who keeps it", () => {
    const d = mayKeep({ actorId: "bea", keeper: { playerId: "ann", epoch: 1 }, epoch: 1, nameOf });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.error).toContain("Ann is keeping score for your group");
      expect(d.keeper).toBe("ann");
    }
  });
});
