import { describe, expect, it } from "vitest";
import { basisFor, isStablefordFormat } from "../week-basis";
import { readSource } from "../../__tests__/source";
import { tournamentTerms } from "../../rules";

/**
 * STABLEFORD IS PLAYED OFF HANDICAP (Ajay, 2026-09-28: "go with what other
 * professional clubs would do").
 *
 * Clubs play Stableford off handicap; a scratch competition is stroke play. The
 * points engine always allocated strokes on a Stableford round, so a stored
 * "gross" was a label that lied (report decision 9). No result changes.
 */
describe("the basis a round is stored with", () => {
  it("is always net for Stableford and Modified Stableford, whatever is asked", () => {
    for (const f of ["Stableford", "Modified Stableford"]) {
      expect(isStablefordFormat(f), f).toBe(true);
      for (const asked of ["gross", "net", "both", "", "nonsense"]) expect(basisFor(f, asked), `${f}/${asked}`).toBe("net");
    }
  });

  it("CONTROL: every other format keeps what it asks for, and falls back to gross", () => {
    expect(basisFor("Stroke Play", "gross")).toBe("gross");
    expect(basisFor("Stroke Play", "both")).toBe("both");
    expect(basisFor("Match Play", "net")).toBe("net");
    expect(basisFor("Stroke Play", "nonsense")).toBe("gross");
    expect(isStablefordFormat("Stroke Play")).toBe(false);
  });
});

describe("a Stableford round stored 'gross' before this is told the truth", () => {
  // No stored row is rewritten, so the member's rules sheet must not print
  // "Stableford (gross)" over a round that was always scored off handicap.
  const terms = (format: string, scoringBasis: string) =>
    tournamentTerms({
      format, type: "Stroke Play Round", holes: 18, scoringBasis, handicapAllowance: 0, countBest: 0,
      tiebreakers: [], cutEnabled: false, cutMode: "", cutCount: 0, cutPercent: 0,
      carryForwardEnabled: false, carryForwardPct: 0,
    }).find((t) => t.label === "Scoring")?.value;

  it("reads 'Stableford (net)'", () => {
    expect(terms("Stableford", "gross")).toBe("Stableford (net)");
    expect(terms("Modified Stableford", "gross")).toBe("Stableford (net)");
  });

  it("CONTROL: a gross stroke round still reads Gross", () => {
    expect(terms("Stroke Play", "gross")).toBe("Gross");
  });
});

describe("every writer of a round's basis goes through basisFor", () => {
  // A writer that bypasses it can store "gross" on a Stableford round again —
  // the defect, one door along. Each file that creates or updates a Stage's
  // basis is named, and must not write it raw.
  const WRITERS = [
    "src/app/actions/tournament.ts",
    "src/app/actions/setup-suggest.ts",
    "src/app/actions/match-setup.ts",
  ];
  for (const file of WRITERS) {
    it(file, () => {
      const src = readSource(file);
      const writes = src.match(/scoringBasis:\s*[^,\n}]+/g) ?? [];
      const raw = writes.filter((w) => !/basisFor\(|^scoringBasis:\s*value$|^scoringBasis:\s*true$/.test(w.trim()));
      expect(raw, `${file} writes a basis without basisFor`).toEqual([]);
      expect(writes.length, `${file} writes no basis at all — is the sweep reading it?`).toBeGreaterThan(0);
    });
  }
});
