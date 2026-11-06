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

/**
 * THE PRESSES THEMSELVES: Round robin, Add, Bracket (and the other orders). There is no DOM in this
 * suite (no jsdom), so the builder's two states are driven through the same two functions the
 * component uses on each press (`pickType` = `addFormatFor(t, cur)`, the select = `formatChoicesFor`)
 * and what the select would render is read back: its value must be one of its own options.
 */
describe("pressing through the kinds leaves the select on a valid format", () => {
  const press = (st: { type: string; held: string }, t: string) => ({ type: t, held: addFormatFor(t, st.held) });
  const shown = (st: { type: string; held: string }) => {
    const options = formatChoicesFor(st.type).map((c) => c.name);
    const value = addFormatFor(st.type, st.held);
    return { options, value };
  };
  it("Round robin, Add, Bracket reads Match Play", () => {
    let st = press({ type: "", held: "" }, "Round Robin");
    expect(shown(st).value).toBe("Match Play");
    // Add changes neither the kind nor the format held (it resets the count and date only).
    st = press(st, "Bracket Stage");
    const { options, value } = shown(st);
    expect(value).toBe("Match Play");
    expect(options).toContain(value);
  });
  it("every ordered pair and triple of kinds ends on a format among its own options", () => {
    for (const a of STAGE_TYPES) for (const b of STAGE_TYPES) for (const c of STAGE_TYPES) {
      let st = { type: "", held: "" };
      for (const t of [a, b, c]) {
        st = press(st, t);
        const { options, value } = shown(st);
        expect(value, `${a} ${b} ${c}`).not.toBe("");
        expect(options, `${a} ${b} ${c}`).toContain(value);
      }
    }
  });
});

describe("the builder uses it everywhere the format is shown or sent", () => {
  it("pickType holds no copy of the fit rule, and Choose… is offered only before a kind", () => {
    const s = readSource("src/components/StagesClient.tsx");
    expect(s).toContain("setBulkFormat((cur) => addFormatFor(t, cur))");
    expect(s).toContain('{!newType && <option value="">Choose…</option>}');
  });
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
