import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE DASHBOARD'S FLIGHT STANDINGS SAYS ONLY WHAT IS TRUE.
 *
 * Walked on 2026-09-26 across the seeded club's dashboards, three faults on
 * one card:
 *
 *   - its heading over NOTHING — a tournament with no flights (the nine-hole
 *     Stableford, the finished championship) and a round scored by hand (the
 *     Festival's last) each showed "Flight standings" and no rows;
 *   - "Advancing rows highlighted" on tournaments where nobody advances, so
 *     the caption described a highlight that was never drawn;
 *   - a shared flight place printed "2, 2" where every board has printed
 *     "T2, T2" since #621 — the April Medal's flight 1 on the day.
 *
 * The dashboard is a server component, so its decisions are pinned in the
 * source; the place rule itself is `shared-position.ts`, tested on its own.
 */
describe("the dashboard's Flight standings card", () => {
  const src = readSource("src/app/(app)/dashboard/page.tsx");
  const at = src.indexOf('<span className="card-title">Flight standings</span>');
  const card = src.slice(src.lastIndexOf("{showStandings", at), src.indexOf("</>", at));

  it("is found (control)", () => {
    expect(at).toBeGreaterThan(0);
    expect(card).toContain("flightColumns");
  });

  it("renders only when some flight has a standing to show", () => {
    expect(card).toMatch(/flightColumns\.some\(\(gs\) => gs\.ranked\.length > 0\) && \(/);
  });

  it("offers the highlight caption only when a row is highlighted", () => {
    expect(card).toMatch(
      /flightColumns\.some\(\(gs\) => gs\.ranked\.some\(\(r\) => advancingIds\.has\(r\.player\.id\)\)\) && \(\s*<span[^>]*>Advancing rows highlighted/,
    );
  });

  it("prints a shared place the way every board does", () => {
    expect(card).toContain("sharedRanks(gs.ranked)");
    expect(card).toContain("placeText(r, shared)");
    // The bare rank is gone — it was the "2, 2" on the card.
    expect(card).not.toMatch(/\{r\.rank \|\| "—"\}/);
  });
});
