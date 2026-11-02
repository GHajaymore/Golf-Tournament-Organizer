import { describe, it, expect } from "vitest";
import {
  kindChangeMoneyQuestion,
  moneyModeFlipsOnKindChange,
  moneyModeToKeep,
  isKindChangeMoneyChoice,
  type KindChangeTournament,
} from "@/lib/domain/kind-change-money";

/**
 * WHICH TOURNAMENTS A CHANGE OF KIND MOVES, worked from the rule as the app
 * states it to people — not from `resolveMoneyMode`'s own code:
 *
 *   a tournament's own money setting wins; then the club's default; and a club
 *   that never chose gets "Costs handled outside the app" if it is a golf club
 *   and "Split shared costs" if it is a community or one person's golf.
 *
 * So the expected answers below are literal modes, written by hand from that
 * sentence, and the function under test is never asked to produce its own
 * expectation.
 */

const t = (id: string, moneyMode = ""): KindChangeTournament => ({ id, name: `zz-${id}`, moneyMode });

describe("a change of kind and the money of each tournament", () => {
  it("moves a tournament that follows the club, in a club that follows the kind", () => {
    const flips = moneyModeFlipsOnKindChange({
      orgMode: "",
      fromKind: "community",
      toKind: "club",
      tournaments: [t("medal")],
    });
    expect(flips).toEqual([{ id: "medal", name: "zz-medal", from: "split", to: "none" }]);
  });

  it("moves them back the other way, which is a change too", () => {
    const flips = moneyModeFlipsOnKindChange({
      orgMode: "",
      fromKind: "club",
      toKind: "personal",
      tournaments: [t("medal")],
    });
    expect(flips).toEqual([{ id: "medal", name: "zz-medal", from: "none", to: "split" }]);
  });

  it("leaves a tournament that chose its own money alone", () => {
    for (const mode of ["none", "float", "split"]) {
      expect(
        moneyModeFlipsOnKindChange({ orgMode: "", fromKind: "personal", toKind: "club", tournaments: [t("own", mode)] }),
        `a tournament set to ${mode} moved`,
      ).toEqual([]);
    }
  });

  it("leaves every tournament alone when the club chose its own default", () => {
    expect(
      moneyModeFlipsOnKindChange({
        orgMode: "split",
        fromKind: "community",
        toKind: "club",
        tournaments: [t("a"), t("b", "none")],
      }),
    ).toEqual([]);
  });

  it("changes nothing between a community and one person's golf: both split by default", () => {
    for (const [fromKind, toKind] of [["personal", "community"], ["community", "personal"]]) {
      expect(
        moneyModeFlipsOnKindChange({ orgMode: "", fromKind, toKind, tournaments: [t("a"), t("b")] }),
      ).toEqual([]);
    }
  });

  it("names only the ones that move, in the order given", () => {
    const flips = moneyModeFlipsOnKindChange({
      orgMode: "",
      fromKind: "personal",
      toKind: "club",
      tournaments: [t("one"), t("pinned", "split"), t("two"), t("kitty", "float"), t("three")],
    });
    expect(flips.map((f) => f.id)).toEqual(["one", "two", "three"]);
  });

  it("the control: the same tournaments DO move when the kind's default differs", () => {
    // Without this a function that always answered [] would pass every
    // "leaves it alone" case above.
    const list = [t("a"), t("b")];
    expect(moneyModeFlipsOnKindChange({ orgMode: "", fromKind: "community", toKind: "club", tournaments: list })).toHaveLength(2);
    expect(moneyModeFlipsOnKindChange({ orgMode: "", fromKind: "club", toKind: "club", tournaments: list })).toEqual([]);
  });
});

describe("keeping their money as it is", () => {
  it("pins the club's default to what the tournaments get today", () => {
    expect(moneyModeToKeep({ orgMode: "", fromKind: "community" })).toBe("split");
    expect(moneyModeToKeep({ orgMode: "", fromKind: "personal" })).toBe("split");
    expect(moneyModeToKeep({ orgMode: "", fromKind: "club" })).toBe("none");
  });

  it("and once pinned, the change of kind moves nothing", () => {
    const orgMode = moneyModeToKeep({ orgMode: "", fromKind: "community" });
    expect(
      moneyModeFlipsOnKindChange({ orgMode, fromKind: "community", toKind: "club", tournaments: [t("a"), t("b")] }),
    ).toEqual([]);
  });
});

describe("the question, in words", () => {
  const flips = (n: number) =>
    moneyModeFlipsOnKindChange({
      orgMode: "",
      fromKind: "community",
      toKind: "club",
      tournaments: Array.from({ length: n }, (_, i) => t(`t${i + 1}`)),
    });

  it("asks nothing when nothing moves", () => {
    expect(kindChangeMoneyQuestion([])).toBe("");
  });

  it("names one tournament, says from what to what, and that nothing is deleted", () => {
    const q = kindChangeMoneyQuestion(flips(1));
    expect(q).toContain("1 tournament follows");
    expect(q).toContain("zz-t1");
    expect(q).toContain("“Split shared costs” to “Costs handled outside the app”");
    expect(q).toMatch(/nothing is deleted/i);
  });

  it("names a few, then says how many more", () => {
    const q = kindChangeMoneyQuestion(flips(5));
    expect(q).toContain("5 tournaments follow");
    expect(q).toContain("zz-t1, zz-t2, zz-t3 and 2 more");
    expect(q).not.toContain("zz-t4");
  });

  it("joins two or three without an 'and N more'", () => {
    expect(kindChangeMoneyQuestion(flips(2))).toContain("zz-t1 and zz-t2.");
    expect(kindChangeMoneyQuestion(flips(3))).toContain("zz-t1, zz-t2 and zz-t3.");
  });

  it("says 'side game', never the other word", () => {
    expect(kindChangeMoneyQuestion(flips(1))).not.toMatch(/\bbet/i);
  });
});

describe("the answer", () => {
  it("is keep or switch, and nothing else", () => {
    expect(isKindChangeMoneyChoice("keep")).toBe(true);
    expect(isKindChangeMoneyChoice("switch")).toBe(true);
    for (const v of ["", "KEEP", true, 1, null, undefined, {}]) expect(isKindChangeMoneyChoice(v)).toBe(false);
  });
});
