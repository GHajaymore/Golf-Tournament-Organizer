import { describe, it, expect } from "vitest";
import { STAGE_TYPES } from "../stage-types";
import { formatChoicesFor, naturalFormatFor, addFormatFor } from "../domain/round-choices";
import { readSource } from "./source";

/**
 * THE ROUND BUILDER'S FORMAT IS NEVER EMPTY ONCE A KIND OF ROUND IS CHOSEN.
 *
 * CI run 41950657167 (main's code): `organizer-rounds-screen.spec.ts` pressed
 * "Add 2 round robins", then the "Bracket" chip 0.3s later, and the select
 * "Format for every round added" read "" for 247 seconds where it should read
 * "Match Play". A controlled select whose value is not among its options shows
 * "" and Add has nothing to send. The type and the format were two separate
 * pieces of state, each correct alone and meaningless together; the format a
 * screen offers is now ASKED of the type each render (`addFormatFor`), so no
 * order of presses, refreshes or re-renders can leave a chosen kind without
 * one that fits it.
 */
describe("addFormatFor — the format the builder offers for the kind chosen", () => {
  it("CONTROL: there are kinds, and each one has a natural format that it can be scored in", () => {
    expect(STAGE_TYPES.length).toBeGreaterThan(3);
    for (const t of STAGE_TYPES) {
      expect(formatChoicesFor(t).some((c) => c.name === naturalFormatFor(t)), t).toBe(true);
    }
  });

  it("is never empty for a chosen kind, whatever was held before (nothing, a stale or a foreign format)", () => {
    for (const t of STAGE_TYPES) {
      for (const held of ["", "Match Play", "Stroke Play", "Nassau", "Four-Ball", "Not A Format", "Other (scored by hand)"]) {
        const got = addFormatFor(t, held);
        expect(got, `${t} holding "${held}"`).not.toBe("");
        expect(formatChoicesFor(t).some((c) => c.name === got), `${t} holding "${held}" -> ${got}`).toBe(true);
      }
    }
  });

  it("keeps the organizer's own choice where it still fits, and replaces it where it does not", () => {
    expect(addFormatFor("Round Robin", "Nassau")).toBe("Nassau");
    expect(addFormatFor("Bracket Stage", "Match Play")).toBe("Match Play");
    expect(addFormatFor("Stroke Play Round", "Match Play")).toBe("Stroke Play");
    expect(addFormatFor("Stroke Play Round", "Stableford")).toBe("Stableford");
  });

  it("says nothing before a kind is chosen", () => {
    expect(addFormatFor("", "")).toBe("");
    expect(addFormatFor("", "Match Play")).toBe("");
  });
});

describe("the builder uses it everywhere the format is shown or sent", () => {
  const src = readSource("src/components/StagesClient.tsx");
  it("the select, the Add button and the server call read the asked-for format, not the held one", () => {
    expect(src).toContain("const addFormat = addFormatFor(newType, bulkFormat)");
    expect(src).toContain("value={addFormat}");
    expect(src).toContain("disabled={pending || !newType || !addFormat}");
    expect(src).toContain("format: addFormat,");
    expect(src).not.toContain("value={bulkFormat}");
    expect(src).not.toContain("format: bulkFormat");
  });
});
