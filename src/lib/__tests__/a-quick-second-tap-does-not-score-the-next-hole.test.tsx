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
 * played. The window runs 400ms from the TAP that set the score and is armed
 * when the card moves (the PE's ruling, which also resolves B119: a scorer
 * who aims at the new hole is never inside it). The rule is
 * `useAdvanceSettle`; both cards ask it.
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

/** A tap at `t0` sets a score; the card moves 160ms later. Returns the hook, clock at the move. */
function tapAndAdvance(clock: { t: number }) {
  const settle = settleWith(clock);
  settle.stamp();
  clock.t += 160;
  settle.markAdvanced();
  return settle;
}

describe("the settle window, from the tap that set the score", () => {
  it("is 400ms", () => {
    expect(ADVANCE_SETTLE_MS).toBe(400);
  });

  it("drops a tap on the new hole at 300ms and at 399ms, from the first tap", () => {
    const clock = { t: 1_000 };
    const settle = tapAndAdvance(clock);
    clock.t = 1_000 + 300;
    expect(settle.settling(), "a double-tap's second touch, 300ms after the first").toBe(true);
    clock.t = 1_000 + 399;
    expect(settle.settling(), "the last millisecond").toBe(true);
  });

  it("takes a tap at 400ms from the first tap", () => {
    const clock = { t: 1_000 };
    const settle = tapAndAdvance(clock);
    clock.t = 1_000 + ADVANCE_SETTLE_MS;
    expect(settle.settling()).toBe(false);
  });

  it("takes a tap before the card has moved (same hole: a correction or the same score)", () => {
    const clock = { t: 0 };
    const settle = settleWith(clock);
    settle.stamp();
    clock.t = 100;
    expect(settle.settling()).toBe(false);
  });

  it("drops only the new hole's first ~240ms: an aimed tap 250ms after it appears is taken", () => {
    const clock = { t: 0 };
    const settle = tapAndAdvance(clock); // the card moved at 160
    clock.t = 160 + 250;
    expect(settle.settling()).toBe(false);
  });

  it("clear() (strip, Next, swipe) lets the very next tap through", () => {
    const clock = { t: 0 };
    const settle = tapAndAdvance(clock);
    clock.t = 200;
    expect(settle.settling()).toBe(true);
    settle.clear();
    expect(settle.settling()).toBe(false);
  });

  it("starts again at the next tap", () => {
    const clock = { t: 0 };
    const settle = tapAndAdvance(clock);
    clock.t = 5_000;
    settle.stamp();
    clock.t += 160;
    settle.markAdvanced();
    clock.t += 100;
    expect(settle.settling()).toBe(true);
  });
});

describe("the pad says it is held (aria-disabled, never disabled)", () => {
  const byHole = readSource("src/components/HoleByHoleCard.tsx");
  const result = readSource("src/components/HoleResultCard.tsx");

  it("the stroke pad and Picked up read `holding`, and are never disabled by it", () => {
    expect(byHole.match(/aria-disabled=\{holding \? "true" : undefined\}/g)?.length).toBe(2);
    expect(byHole).toMatch(/holding=\{settle\.holding\}/);
    expect(byHole).not.toMatch(/(?<!aria-)disabled=\{[^}]*holding/);
  });

  it("the match card's three answers read it too", () => {
    expect(result).toMatch(/aria-disabled=\{settle\.holding \? "true" : undefined\}/);
    expect(result).not.toMatch(/(?<!aria-)disabled=\{[^}]*holding/);
  });

  it("the hook's holding is on for the armed window and off by clear()", () => {
    const src = readSource("src/components/useAdvanceSettle.ts");
    expect(src).toMatch(/setHolding\(left > 0\)/);
    expect(src).toMatch(/clear: \(\) => \{[^}]*stopHolding\(\)/);
  });

  it("every tap that starts an advance stamps it", () => {
    expect(byHole).toMatch(/settle\.stamp\(\);\s*advance\.current = setTimeout/);
    expect(result).toMatch(/settle\.stamp\(\);\s*advance\.current = setTimeout/);
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

describe("the dropped tap is seen", () => {
  it("the note names the hole, uses theme tokens, and takes no room when not shown", () => {
    const shown = renderToStaticMarkup(<TapNotTaken show hole={11} />);
    expect(shown).toContain("Hole 11");
    expect(shown).toContain("var(--color-warning)");
    expect(shown).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(renderToStaticMarkup(<TapNotTaken show={false} hole={11} />)).not.toContain("<p");
  });

  it("takes no layout space, shown or not, so the pad never moves under the thumb", () => {
    for (const show of [true, false]) {
      const html = renderToStaticMarkup(<TapNotTaken show={show} hole={11} />);
      expect(html).toMatch(/height:0/);
    }
    expect(renderToStaticMarkup(<TapNotTaken show hole={11} />)).toMatch(/<p style="position:absolute/);
  });

  it("is never a second role=status on the card, shown or not (every spec finds the card's line by that role)", () => {
    for (const show of [true, false]) {
      expect(renderToStaticMarkup(<TapNotTaken show={show} hole={11} />)).not.toMatch(/role="status"/);
    }
  });
});
