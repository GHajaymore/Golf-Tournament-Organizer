import { describe, expect, it } from "vitest";
import { shareField, initialsOf, SHARE_FIELD_MAX } from "@/lib/share-field";

const field = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `First Last${i}` }));

const even = (ids: string[]) => ids.map((playerId) => ({ playerId, weight: 1 }));

describe("who gets a chip on a collapsed expense row", () => {
  /* The three invariants. Everything else here is a case; these are the rules
     that must hold for every case, and they are the ones that would regress
     silently, because the row is presentational and no suite renders it. */

  it("gives a chip to every share with a real weight", () => {
    for (const size of [4, 8, 12, 13, 33]) {
      const f = field(size);
      const on = ["p0", "p1", "p2"];
      const chips = shareField(f, even(on), ["p0"]);
      for (const id of on) {
        expect(chips.find((c) => c.playerId === id)?.state, `${id} in a field of ${size}`).toBe("in");
      }
    }
  });

  it("gives the payer a chip even when they are not on the bill", () => {
    // The bar tab: paid for it, drank nothing, is in no share. The big-field
    // case is the one that regresses, because filtering to "has a share"
    // drops precisely the chip that must always be there.
    for (const size of [4, 33]) {
      const payerId = `p${size - 1}`;
      const chips = shareField(field(size), even(["p0", "p1"]), [payerId]);
      const payer = chips.find((c) => c.playerId === payerId);
      expect(payer, `payer missing in a field of ${size}`).toBeDefined();
      expect(payer?.payer).toBe(true);
      // Paying is orthogonal to sharing: not on the bill is still not on it.
      expect(payer?.state).toBe("off");
    }
  });

  it("cannot chip a payer who has left the field", () => {
    // `ExpenseRow.unknownPayer` — the row survives the person. There is
    // nobody to draw, and inventing a chip would be worse than the gap.
    const chips = shareField(field(4), even(["p0"]), ["someone-who-left"]);
    expect(chips.some((c) => c.payer)).toBe(false);
    expect(chips).toHaveLength(4);
  });

  it("never shows more chips than the field has people", () => {
    for (const size of [1, 4, 12, 13, 60]) {
      const f = field(size);
      const chips = shareField(f, even(f.map((p) => p.id)), ["p0"]);
      expect(chips.length).toBeLessThanOrEqual(size);
      expect(chips.length).toBeLessThanOrEqual(SHARE_FIELD_MAX);
    }
  });

  /* The distinction the whole row exists to preserve. */

  it("keeps a weight-0 share dashed rather than dropping it — in a big field too", () => {
    const shares = [
      { playerId: "p0", weight: 1 },
      { playerId: "p1", weight: 0 },
    ];
    for (const size of [4, 33]) {
      const chips = shareField(field(size), shares, ["p0"]);
      expect(chips.find((c) => c.playerId === "p1")?.state, `field of ${size}`).toBe("nil");
    }
  });

  it("counts an exact amount as being in the split even at weight 0", () => {
    // `exact` mode sends weight 1 with an amount, but a defensive zero-weight
    // row carrying real money must not read as owing nothing.
    const chips = shareField(field(4), [{ playerId: "p0", weight: 0, exactCents: 2500 }], []);
    expect(chips.find((c) => c.playerId === "p0")?.state).toBe("in");
  });

  /* The size branch: two behaviours, so both are pinned. */

  it("shows the whole field when it is small, so absences are visible", () => {
    const chips = shareField(field(8), even(["p0", "p1"]), ["p0"]);
    expect(chips).toHaveLength(8);
    expect(chips.filter((c) => c.state === "off")).toHaveLength(6);
  });

  it("shows only the people a bill touches when the field is big", () => {
    // The real case that broke it: 33 players, dinner shared by four.
    const chips = shareField(field(33), even(["p0", "p1", "p2", "p3"]), ["p0"]);
    expect(chips).toHaveLength(4);
    expect(chips.every((c) => c.state === "in")).toBe(true);
  });

  it("switches behaviour at the boundary without losing anyone", () => {
    const on = ["p0", "p1", "p2"];
    const below = shareField(field(SHARE_FIELD_MAX), even(on), ["p0"]);
    const above = shareField(field(SHARE_FIELD_MAX + 1), even(on), ["p0"]);
    expect(below).toHaveLength(SHARE_FIELD_MAX);
    expect(above).toHaveLength(on.length);
    // Different renderings, same people accounted for.
    for (const id of on) {
      expect(below.find((c) => c.playerId === id)?.state).toBe("in");
      expect(above.find((c) => c.playerId === id)?.state).toBe("in");
    }
  });

  it("shows nothing rather than a wall when even the touched set is too big", () => {
    const on = Array.from({ length: SHARE_FIELD_MAX + 1 }, (_, i) => `p${i}`);
    expect(shareField(field(40), even(on), ["p0"])).toEqual([]);
  });

  it("shows nothing for an empty field", () => {
    expect(shareField([], even(["p0"]), ["p0"])).toEqual([]);
  });

  it("ignores a payer id that is empty", () => {
    const chips = shareField(field(4), even(["p0"]), [""]);
    expect(chips.some((c) => c.payer)).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first and last name", () => {
    expect(initialsOf("Alex Rourke")).toBe("AR");
    expect(initialsOf("A. Rourke")).toBe("AR");
    expect(initialsOf("Mary Jane Watson")).toBe("MW");
  });

  it("pads a single name to two characters", () => {
    expect(initialsOf("Sam")).toBe("SA");
  });

  it("does not throw on nothing", () => {
    expect(initialsOf("")).toBe("??");
    expect(initialsOf("   ")).toBe("??");
  });
});
