import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * NO PER-PLAYER FLIGHT STANDINGS FOR A ROUND PLAYED IN SIDES.
 *
 * Found 2026-09-26 running a club Scramble from scratch: with both sides'
 * cards in, the dashboard's "Flight standings" card printed all eight players
 * with "—" against every name — a finished round reading as one nobody had
 * scored. The rows are per PLAYER and a team round's result belongs to the
 * side; the standings card above it already says so in words.
 */
describe("the dashboard's Flight standings card", () => {
  const src = readSource("src/app/(app)/dashboard/page.tsx");
  // The JSX condition that opens the card, up to its heading.
  const at = src.indexOf(">Flight standings<");
  const opener = src.slice(src.lastIndexOf("{showStandings", at), at);

  it("is found — the control, so the next assertion reads the right block", () => {
    expect(at).toBeGreaterThan(0);
    expect(opener).toMatch(/^\{showStandings/);
  });

  it("is not drawn for a team round", () => {
    expect(opener).toMatch(/!teamRound\b/);
  });
});
