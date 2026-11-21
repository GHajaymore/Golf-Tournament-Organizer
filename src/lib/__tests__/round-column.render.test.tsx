import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { ROUND_STATE_WORDS, RoundColumn } from "@/components/setup/RoundColumn";
import { roundRing } from "@/lib/domain/round-ring";
import type { StatusRound } from "@/lib/domain/tournament-status";

const draw = (state: StatusRound["state"], ring: ReturnType<typeof roundRing>) =>
  renderToStaticMarkup(
    <div style={{ width: 320 }}>
      <RoundColumn label="Round 2" state={state} ring={ring}>
        <p>inside</p>
      </RoundColumn>
    </div>,
  );

describe("RoundColumn", () => {
  it("draws the ring's words when it is given a ring, and its children below", () => {
    const html = draw("not-started", { set: 2, of: 3, holds: true });
    expect(html).toContain("2 of 3 set");
    // The words are the visible text a screen reader reads; no role-less aria-label (aria-label-needs-a-role).
    expect(html).toContain(">2 of 3 set<");
    expect(html).toContain('data-round-ring="holds"');
    expect(html).not.toContain("data-round-state");
    expect(html.indexOf("Round 2")).toBeLessThan(html.indexOf("inside"));
  });

  it("a ring with nothing open is drawn quietly, and does not hold", () => {
    expect(draw("not-started", { set: 3, of: 3, holds: false })).toContain('data-round-ring="open"');
  });

  it("draws the state in its words for each state when the caller says no ring (null)", () => {
    for (const state of ["not-started", "under-way", "closed"] as const) {
      const html = draw(state, null);
      expect(html).toContain(`data-round-state="${state}"`);
      expect(html).toContain(ROUND_STATE_WORDS[state]);
      expect(html).not.toContain("data-round-ring");
    }
  });

  it("every flex child can shrink at 320px: min-width 0, and the head wraps", () => {
    const html = draw("not-started", { set: 1, of: 3, holds: true });
    expect((html.match(/min-width:0/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("flex-wrap:wrap");
  });

  it("holds no colour of its own, and never reads a round's needs", () => {
    const src = readSource("src/components/setup/RoundColumn.tsx");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(src).not.toMatch(/\.needs\b/);
  });
});
