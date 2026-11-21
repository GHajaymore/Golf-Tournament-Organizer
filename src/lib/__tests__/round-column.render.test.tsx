import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { RoundColumn } from "@/components/setup/RoundColumn";
import { roundRing } from "@/lib/domain/round-ring";
import type { RoundStepView } from "@/lib/domain/timeline-step";

const NOT_PLAYED: RoundStepView = { chip: "Not played", tone: "neutral", standing: "played" };

const draw = (chip: RoundStepView, ring: ReturnType<typeof roundRing>) =>
  renderToStaticMarkup(
    <div style={{ width: 320 }}>
      <RoundColumn label="Round 2" chip={chip} ring={ring}>
        <p>inside</p>
      </RoundColumn>
    </div>,
  );

describe("RoundColumn", () => {
  it("draws the ring's words when it is given a ring, and its children below", () => {
    const html = draw(NOT_PLAYED, { set: 2, of: 3, holds: true });
    expect(html).toContain("2 of 3 set");
    // The words are the visible text a screen reader reads; no role-less aria-label (aria-label-needs-a-role).
    expect(html).toContain(">2 of 3 set<");
    expect(html).toContain('data-round-ring="holds"');
    expect(html).not.toContain("data-round-state");
    expect(html.indexOf("Round 2")).toBeLessThan(html.indexOf("inside"));
  });

  it("a ring with nothing open is drawn quietly, and does not hold", () => {
    expect(draw(NOT_PLAYED, { set: 3, of: 3, holds: false })).toContain('data-round-ring="open"');
  });

  it("draws the machine's chip words (roundStep's) for each chip when the caller says no ring (null)", () => {
    const chips: RoundStepView[] = [
      { chip: "Played", tone: "neutral", standing: "played" },
      { chip: "In play", tone: "accent", standing: "active" },
      NOT_PLAYED,
      { chip: "Upcoming", tone: "neutral", standing: "upcoming" },
      { chip: "Set up", tone: "accent", standing: "setup" },
      { chip: "No date", tone: "accent-2", standing: "setup" },
    ];
    for (const c of chips) {
      const html = draw(c, null);
      expect(html).toContain(`data-round-state="${c.chip}"`);
      expect(html).toContain(`>${c.chip}<`);
      expect(html).not.toContain("data-round-ring");
    }
    // The tone is a token, never a colour of its own.
    expect(draw({ chip: "In play", tone: "accent", standing: "active" }, null)).toContain("var(--color-accent)");
  });

  it("every flex child can shrink at 320px: min-width 0, and the head wraps", () => {
    const html = draw(NOT_PLAYED, { set: 1, of: 3, holds: true });
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
