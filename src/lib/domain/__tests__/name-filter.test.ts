import { describe, it, expect } from "vitest";
import { filterNames, showsNameFilter, NAME_FILTER_FROM } from "../name-filter";

const field = (names: string[]) => names.map((name, i) => ({ id: `p${i}`, name }));

const DEMO = field([
  "Aisha Rahman",
  "Andre Costa",
  "Hannah Voss",
  "Jack Mercer",
  "Sang-woo Kim",
  "Zoe Sullivan",
]);

describe("when a field is long enough to need finding", () => {
  it("leaves a small field alone", () => {
    // A society four-ball does not search four names — a box there costs a tap
    // and saves nothing.
    expect(showsNameFilter(4)).toBe(false);
    expect(showsNameFilter(NAME_FILTER_FROM)).toBe(false);
  });

  it("offers one past the threshold", () => {
    expect(showsNameFilter(NAME_FILTER_FROM + 1)).toBe(true);
    // The size that prompted this: thirty-three names is four screens of
    // scrolling on a phone, one-handed, on the first tee.
    expect(showsNameFilter(33)).toBe(true);
  });
});

describe("finding your own name", () => {
  it("matches anywhere in the name, not just the start", () => {
    // Plenty of golfers reach for their surname first.
    expect(filterNames(DEMO, "voss").map((p) => p.name)).toEqual(["Hannah Voss"]);
    expect(filterNames(DEMO, "Hannah").map((p) => p.name)).toEqual(["Hannah Voss"]);
  });

  it("ignores case and surrounding space", () => {
    // Nobody capitalises on a phone in the rain.
    expect(filterNames(DEMO, "  SANG  ").map((p) => p.name)).toEqual(["Sang-woo Kim"]);
  });

  it("FILTERS, NEVER REORDERS", () => {
    /**
     * The rule that matters most and is easiest to break by reaching for a
     * fuzzy-match library. A player is scanning an alphabetical list; if their
     * name moves while they type, the ordering they were relying on is gone —
     * and a ranked "best match first" would do exactly that.
     *
     * THE QUERY IS CHOSEN SO A WRONG ANSWER LOOKS DIFFERENT. The first version
     * of this used "a", and every survivor of "a" happens to already sit in
     * match-position order — so ranking them changed nothing and the test
     * passed against a mutation that reordered. "s" separates them: Sang-woo
     * matches at position 0 and would jump to the front of an alphabetical
     * list it currently sits fourth in.
     */
    const shown = filterNames(DEMO, "s").map((p) => p.name);
    expect(shown).toEqual(["Aisha Rahman", "Andre Costa", "Hannah Voss", "Sang-woo Kim", "Zoe Sullivan"]);
    // Said explicitly, so the intent survives someone editing the fixture:
    // the best match must NOT be first.
    expect(shown[0]).not.toBe("Sang-woo Kim");
    expect(shown.indexOf("Sang-woo Kim")).toBeGreaterThan(0);
  });

  it("shows everybody when nothing has been typed", () => {
    expect(filterNames(DEMO, "")).toHaveLength(DEMO.length);
    expect(filterNames(DEMO, "   ")).toHaveLength(DEMO.length);
    // A copy, so a caller cannot sort the picker's own list out from under it.
    expect(filterNames(DEMO, "")).not.toBe(DEMO);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    // The screen says so in words; what it must not do is fall back to the
    // whole field and leave a player tapping the wrong name.
    expect(filterNames(DEMO, "zzzz")).toEqual([]);
  });
});
