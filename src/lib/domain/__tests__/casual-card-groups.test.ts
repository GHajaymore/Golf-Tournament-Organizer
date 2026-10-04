import { describe, it, expect } from "vitest";
import { casualCardGroups, CARD_GROUP_MAX } from "../casual-card-groups";
import { readSource } from "../../__tests__/source";

/**
 * A casual round is scored as the card everybody is on, not one player at a
 * time (walked at 393px on 2026-10-04). Field sizes from one, per CLAUDE.md's
 * combination sweep: a casual round takes 2..8, and 1 and 0 must not misbehave.
 */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe("casualCardGroups", () => {
  it("puts a two-ball, a three-ball and a fourball on ONE card", () => {
    for (const n of [2, 3, 4]) {
      const groups = casualCardGroups(ids(n));
      expect(groups, `${n} players`).toHaveLength(1);
      expect(groups[0]).toEqual({ name: "Everyone", time: "", playerIds: ids(n) });
    }
  });

  it("splits five to eight into two cards, evenly, never leaving one player alone", () => {
    const sizes = (n: number) => casualCardGroups(ids(n)).map((g) => g.playerIds.length);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(8)).toEqual([4, 4]);
    expect(casualCardGroups(ids(8)).map((g) => g.name)).toEqual(["Group 1", "Group 2"]);
  });

  it("keeps everybody exactly once, in order, and no card over four, at every size", () => {
    for (let n = 1; n <= 16; n += 1) {
      const groups = casualCardGroups(ids(n));
      expect(groups.flatMap((g) => g.playerIds), `${n}`).toEqual(ids(n));
      for (const g of groups) expect(g.playerIds.length, `${n}`).toBeLessThanOrEqual(CARD_GROUP_MAX);
      expect(groups.every((g) => g.playerIds.length > 0)).toBe(true);
    }
  });

  it("has no card for nobody", () => {
    expect(casualCardGroups([])).toEqual([]);
  });

  it("is what score entry uses when a casual round has no tee sheet", () => {
    const page = readSource("src", "app", "(app)", "entry", "page.tsx");
    expect(page).toContain("sheet.length === 0 && casualRound && isStaff");
    expect(page).toContain("casualCardGroups(state.confirmed.map((p) => p.id))");
  });
});
