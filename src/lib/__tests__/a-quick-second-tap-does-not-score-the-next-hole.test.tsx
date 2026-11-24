import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ADVANCE_SETTLE_MS, useAdvanceSettle } from "@/components/useAdvanceSettle";
import { TapNotTaken } from "@/components/TapNotTaken";
import { readSource } from "./source";

/**
 * B117 (2026-11-23): A QUICK SECOND TAP NO LONGER SCORES THE NEXT HOLE.
 *
 * The card moves on 160ms after a score is set, so the second half of a
 * double-tap landed on the next hole's pad and scored a hole nobody had
 * played. A pad tap inside 400ms of the new hole appearing is now dropped.
 * The rule is `useAdvanceSettle`; both cards ask it.
 */

function settleWith(clock: { t: number }) {
  let api!: ReturnType<typeof useAdvanceSettle>;
  function Probe() {
    api = useAdvanceSettle(() => clock.t);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return api;
}

describe("the settle window after the card moves on", () => {
  it("is 400ms", () => {
    expect(ADVANCE_SETTLE_MS).toBe(400);
  });

  it("holds a tap that comes inside it, from the moment the new hole appears", () => {
    const clock = { t: 1_000 };
    const settle = settleWith(clock);
    expect(settle.settling(), "before any advance a tap is a tap").toBe(false);
    settle.markAdvanced();
    clock.t += 1;
    expect(settle.settling()).toBe(true);
    clock.t += 250;
    expect(settle.settling(), "a double-tap's second half, 250ms in").toBe(true);
    clock.t += ADVANCE_SETTLE_MS - 252;
    expect(settle.settling(), "the last millisecond of the window").toBe(true);
  });

  it("lets a deliberate tap after it score", () => {
    const clock = { t: 5_000 };
    const settle = settleWith(clock);
    settle.markAdvanced();
    clock.t += ADVANCE_SETTLE_MS;
    expect(settle.settling()).toBe(false);
    clock.t += 5_000;
    expect(settle.settling()).toBe(false);
  });

  it("starts again at the next advance", () => {
    const clock = { t: 0 };
    const settle = settleWith(clock);
    settle.markAdvanced();
    clock.t += 1_000;
    settle.markAdvanced();
    clock.t += 100;
    expect(settle.settling()).toBe(true);
  });
});

describe("both cards ask it, and only their own advance starts it", () => {
  const byHole = readSource("src/components/HoleByHoleCard.tsx");
  const result = readSource("src/components/HoleResultCard.tsx");

  const advance = /settle\.markAdvanced\(\);\s*setHole\(\(h\) => \(h === from \? from \+ 1 : h\)\)/;

  it("the stroke card drops a pad tap inside the window, flashes, and marks the advance", () => {
    expect(byHole).toMatch(/if \(moveOn && settle\.refused\(\)\) return;/);
    expect(byHole).toMatch(advance);
    expect(byHole).toMatch(/<TapNotTaken show=\{settle\.flash\}/);
  });

  it("Picked up is guarded too, so a double-tap cannot pick up the next hole", () => {
    expect(byHole).toMatch(/onToggle=\{\(on\) => \{\s*if \(settle\.refused\(\)\) return;\s*onPickUp\(/);
  });

  it("the match card drops a press inside the window, flashes, and marks the advance", () => {
    expect(result).toMatch(/if \(settle\.refused\(\)\) return;/);
    expect(result).toMatch(advance);
    expect(result).toMatch(/<TapNotTaken show=\{settle\.flash\}/);
  });

  it("the strip, Next and a swipe (go) end the window and never start it", () => {
    for (const src of [byHole, result]) {
      const go = src.slice(src.indexOf("const go = "), src.indexOf("const go = ") + 200);
      expect(go).toContain("settle.clear()");
      expect(go).not.toContain("markAdvanced");
    }
  });
});

describe("a deliberate move ends the window", () => {
  it("clear() lets the very next tap through", () => {
    const clock = { t: 0 };
    const settle = settleWith(clock);
    settle.markAdvanced();
    clock.t += 50;
    expect(settle.settling()).toBe(true);
    settle.clear();
    expect(settle.settling()).toBe(false);
  });
});

describe("the dropped tap is seen", () => {
  it("the note names the hole, uses theme tokens, and takes no room when not shown", () => {
    const shown = renderToStaticMarkup(<TapNotTaken show hole={11} />);
    expect(shown).toContain("Hole 11");
    expect(shown).toContain("var(--color-warning)");
    expect(shown).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(renderToStaticMarkup(<TapNotTaken show={false} hole={11} />)).not.toContain("<p");
  });
});
