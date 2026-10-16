import { describe, it, expect } from "vitest";
import { STAGE_TYPE_INFO } from "@/lib/stage-types";
import { GOLF_FORMATS } from "@/lib/formats";
import { roundShapeMismatch } from "@/lib/domain/round-shape";
import { formatChoicesFor, naturalFormatFor, formatFitsRound, newRoundBasis } from "@/lib/domain/round-choices";
import { readSource } from "./source";

/**
 * A ROUND IS OFFERED ONLY THE FORMATS IT CAN BE SCORED IN (2026-10-16).
 *
 * Walked as a new organizer: "Stroke play round", Format "Match Play", Add —
 * created, then "This round cannot be scored as set", with the setup strip
 * marking the step done. Every format was offered for every type. The rule is
 * read here against the one that knew all along, `roundShapeMismatch`, for
 * every type and every format the catalogue holds — the whole axis, not one cell.
 */
describe("what a round may be played as", () => {
  const types = STAGE_TYPE_INFO.map((t) => t.key);

  it("offers no pair that cannot be scored, for any type", () => {
    for (const type of types) {
      for (const c of formatChoicesFor(type)) {
        expect(roundShapeMismatch(type, c.name), `${type} offers ${c.name}`).toBeNull();
      }
    }
  });

  it("CONTROL: the pair the walk found is refused, both ways round", () => {
    expect(formatChoicesFor("Stroke Play Round").map((c) => c.name)).not.toContain("Match Play");
    expect(formatChoicesFor("Bracket Stage").map((c) => c.name)).not.toContain("Stroke Play");
    expect(formatChoicesFor("Bracket Stage").map((c) => c.name)).not.toContain("Skins");
    // …and what each IS offered is not empty: a filter that kept nothing passes the test above.
    for (const type of types) expect(formatChoicesFor(type).length, type).toBeGreaterThan(0);
  });

  it("every type's own format is one it can be played in, and is offered", () => {
    for (const type of types) {
      const f = naturalFormatFor(type);
      expect(formatFitsRound(type, f), `${type} → ${f}`).toBe(true);
      expect(formatChoicesFor(type).map((c) => c.name), type).toContain(f);
    }
  });

  it("lists one game once: Alternate Shot is foursomes", () => {
    const names = formatChoicesFor("Stroke Play Round").map((c) => c.name);
    expect(names).toContain("Foursomes");
    expect(names).not.toContain("Alternate Shot");
    // A round already set to it still shows it, so the picker never claims a value the round does not have.
    expect(formatChoicesFor("Stroke Play Round", "Alternate Shot").map((c) => c.name)).toContain("Alternate Shot");
  });

  it("tells the look-alikes apart in the words of the picker", () => {
    const label = (n: string) => formatChoicesFor("Stroke Play Round").find((c) => c.name === n)?.label ?? "";
    for (const n of ["Four-Ball", "Best Ball", "Scramble", "Texas Scramble"]) expect(label(n), n).toMatch(/ — /);
    // Every label begins with the stored name, so a spec choosing by name still finds it.
    for (const c of formatChoicesFor("Stroke Play Round")) expect(c.label.startsWith(c.name)).toBe(true);
  });

  it("a new round is played off handicap, and Stableford is net either way", () => {
    expect(newRoundBasis("Stroke Play")).toBe("net");
    expect(newRoundBasis("Match Play")).toBe("net");
    expect(newRoundBasis("Stableford")).toBe("net");
    // The catalogue is walked so a format added later is covered the day it lands.
    for (const f of GOLF_FORMATS) expect(["net", "gross", "both", "stableford"]).toContain(newRoundBasis(f.name));
  });

  it("the server holds to the same list: both doors refuse what it leaves out", () => {
    const src = readSource("src", "app", "actions", "tournament.ts");
    const add = src.slice(src.indexOf("export async function addStage("), src.indexOf("export async function removeStage("));
    const set = src.slice(src.indexOf("export async function setStageFormat("), src.indexOf("export async function setStageHoles("));
    expect(add).toMatch(/formatFitsRound\(stageType, opts\.format\)/);
    expect(set).toMatch(/formatFitsRound\(shape\.type, format\)/);
  });
});
