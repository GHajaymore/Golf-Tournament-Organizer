import { describe, expect, it } from "vitest";
import { overallResultLabel } from "../overall-result";
import { readSource } from "../../__tests__/source";

/** The "Overall result" row, named for the golf it counts (2026-09-28). */
describe("the overall result, in words", () => {
  it("says Stableford points when every playing round is Stableford", () => {
    expect(overallResultLabel("stroke", ["Stableford"])).toBe("Stableford points");
    expect(overallResultLabel("stroke", ["Stableford", "Modified Stableford"])).toBe("Stableford points");
  });

  it("CONTROL: a medal, a mix, or no rounds yet stays Stroke play; match stays Match play", () => {
    expect(overallResultLabel("stroke", ["Stroke Play"])).toBe("Stroke play");
    expect(overallResultLabel("stroke", ["Stableford", "Stroke Play"])).toBe("Stroke play");
    expect(overallResultLabel("stroke", [])).toBe("Stroke play");
    expect(overallResultLabel("match", ["Stableford"])).toBe("Match play");
  });

  it("is the one wording both summaries print", () => {
    for (const file of ["src/components/LifecycleBar.tsx", "src/components/EventSetupClient.tsx"]) {
      expect(readSource(file), file).not.toMatch(/=== "stroke" \? "Stroke play" : "Match play"/);
    }
  });
});
