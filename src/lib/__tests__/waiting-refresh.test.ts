import { describe, it, expect } from "vitest";
import { startWaitingRefresh, type WaitingDoc } from "@/lib/waiting-refresh";

/**
 * THE WAITING SCREEN'S CHECK RUNS ONLY WHILE THE PAGE IS VISIBLE (J39/J40 PR 3B; Security Lead C3.2).
 *
 * A phone in a pocket asks nothing; the page coming back asks once at once; and `stop()` ends it for good (the entry
 * is confirmed or dead). Driven here with a fake document and a fake timer, no browser.
 *
 * Break-it (seen red): poll while hidden.
 */

function fake(state: "visible" | "hidden") {
  const handlers = new Set<() => void>();
  const doc: WaitingDoc & { visibilityState: string; change: (s: "visible" | "hidden") => void } = {
    visibilityState: state,
    addEventListener: (_t, fn) => void handlers.add(fn),
    removeEventListener: (_t, fn) => void handlers.delete(fn),
    change(s) {
      doc.visibilityState = s;
      for (const h of [...handlers]) h();
    },
  };
  const ticks: Array<() => void> = [];
  let refreshes = 0;
  const stop = startWaitingRefresh({
    doc,
    refresh: () => void (refreshes += 1),
    everyMs: 20_000,
    setIntervalFn: (fn) => {
      ticks.push(fn);
      return ticks.length;
    },
    clearIntervalFn: (h) => {
      ticks[(h as number) - 1] = () => {};
    },
  });
  return {
    doc,
    stop,
    tick: () => ticks.forEach((t) => t()),
    refreshes: () => refreshes,
    listeners: () => handlers.size,
  };
}

describe("the waiting check", () => {
  it("a visible page checks on every tick", () => {
    const w = fake("visible");
    w.tick();
    w.tick();
    expect(w.refreshes()).toBe(2);
    w.stop();
  });

  it("a hidden page checks nothing, even if a tick fires", () => {
    const w = fake("hidden");
    w.tick();
    w.tick();
    expect(w.refreshes()).toBe(0);
    w.stop();
  });

  it("going hidden stops the ticks; coming back checks once at once, then carries on", () => {
    const w = fake("visible");
    w.doc.change("hidden");
    w.tick();
    expect(w.refreshes()).toBe(0);
    w.doc.change("visible");
    expect(w.refreshes()).toBe(1);
    w.tick();
    expect(w.refreshes()).toBe(2);
    w.stop();
  });

  it("stop ends it for good: no tick, no return to the page, no listener left", () => {
    const w = fake("visible");
    w.stop();
    w.tick();
    w.doc.change("hidden");
    w.doc.change("visible");
    expect(w.refreshes()).toBe(0);
    expect(w.listeners()).toBe(0);
  });
});
