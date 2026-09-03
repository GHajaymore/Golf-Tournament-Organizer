import { describe, it, expect } from "vitest";
import { parseBracketDraw, serializeBracketDraw } from "../bracket";

/**
 * Reading the stored draw back.
 *
 * Every failure here has to land on "not drawn yet", never on "drawn, with
 * nobody in it". The first re-derives the bracket from live standings, which is
 * what the app did for its whole life before the draw was stored; the second is
 * a knockout that has silently lost its field. One is the old behaviour and the
 * other is a new and worse bug, so the fallback is not a detail.
 */
describe("the stored draw", () => {
  it("round-trips the order, which IS the seeding", () => {
    const ids = ["p3", "p1", "p4", "p2"];
    expect(parseBracketDraw(serializeBracketDraw(ids))).toEqual(ids);
  });

  it("reads an unset draw as not yet drawn", () => {
    expect(parseBracketDraw("")).toBeNull();
  });

  it("falls back rather than emptying the bracket on rubbish", () => {
    for (const bad of ["not json", "{}", "null", "42", '"p1"', "[]", "[null,null]", '["", "  "]']) {
      expect(parseBracketDraw(bad), bad).toBeNull();
    }
  });

  it("keeps the usable ids when the array is partly junk", () => {
    // A half-readable draw still describes a real draw. Dropping the whole
    // thing would re-seed a started bracket, which is the fault this exists
    // to prevent.
    expect(parseBracketDraw('["p1", null, "p2", 7]')).toEqual(["p1", "p2"]);
  });

  it("does not deduplicate or sort", () => {
    // Neither is this function's business. A draw is an ordered list somebody
    // made; silently tidying it would move players between slots.
    expect(parseBracketDraw('["p2","p1","p2"]')).toEqual(["p2", "p1", "p2"]);
  });
});
