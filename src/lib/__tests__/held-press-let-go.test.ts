import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { runInNewContext } from "node:vm";
import { HeldBeforeLoad } from "@/components/HeldBeforeLoad";

/**
 * THE PAGE A LET-GO PRESS OPENS STOPS WAITING FOR ITS SCRIPTS (2026-11-03).
 *
 * Round G421-1, iPhone's engine: the round code's held press went as the plain post after ten
 * seconds, and the list of names it opened was never painted — Safari keeps the old page on screen
 * until the new one finishes loading or has enough content, and a short list whose scripts never
 * come does neither. `HeldBeforeLoad` now marks a let-go press, and the next page stops loading
 * (`window.stop()`) if it is not live a moment after it is read. This runs the holder's own script
 * against a stand-in for the page; the browser walk is `round-code-before-the-script.spec.ts`.
 */
const script = (() => {
  const html = renderToStaticMarkup(HeldBeforeLoad());
  return html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
})();

type Listener = (e: unknown) => void;

function aPage(store: Map<string, string>, live = false) {
  const timers: Array<() => void> = [];
  const listeners: Record<string, Listener[]> = {};
  const calls = { stop: 0, requestSubmit: 0, prevented: 0 };
  const form: Record<string, unknown> = {
    hasAttribute: (n: string) => n === "data-held-until-live",
    getAttribute: () => "name",
    requestSubmit: () => (calls.requestSubmit += 1),
  };
  if (live) form["__reactFiber$x"] = {};
  const button = { value: "p1", name: "playerId", setAttribute() {}, removeAttribute() {}, style: {} as Record<string, string> };
  const document = {
    readyState: "loading",
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    querySelector: () => form,
  };
  const context: Record<string, unknown> = {
    document,
    setTimeout: (fn: () => void) => timers.push(fn),
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    stop: () => (calls.stop += 1),
    FormData: class {},
    Date,
    Object,
    String,
  };
  context.window = context;
  runInNewContext(script, context);
  const fire = (type: string, e?: unknown) => (listeners[type] ?? []).forEach((fn) => fn(e));
  const runTimers = () => {
    while (timers.length) timers.shift()!();
  };
  const press = () => fire("submit", { target: form, submitter: button, preventDefault: () => (calls.prevented += 1) });
  return { calls, fire, runTimers, press };
}

describe("a held press that had to be let go", () => {
  it("leaves a mark, and the next page stops waiting for its scripts and takes a press at once", () => {
    const store = new Map<string, string>();
    const first = aPage(store);
    first.fire("DOMContentLoaded");
    first.press();
    expect(first.calls.prevented, "the press was not held").toBe(1);
    first.runTimers();
    expect(first.calls.requestSubmit, "the held press never went").toBe(1);
    expect(first.calls.stop, "the page the press was made on was stopped").toBe(0);

    const next = aPage(store);
    next.fire("DOMContentLoaded");
    next.runTimers();
    expect(next.calls.stop, "the page the plain post opened kept waiting for scripts that had already failed once").toBe(1);
    next.press();
    expect(next.calls.prevented, "a press on a stopped page was held for scripts that will not come").toBe(0);
    // The mark is spent: a third page waits for its scripts as usual.
    const third = aPage(store);
    third.fire("DOMContentLoaded");
    third.runTimers();
    expect(third.calls.stop).toBe(0);
  });

  it("CONTROL: with no let-go, or once the page is live, nothing is stopped", () => {
    const quiet = aPage(new Map());
    quiet.fire("DOMContentLoaded");
    quiet.runTimers();
    expect(quiet.calls.stop).toBe(0);

    const store = new Map([["thqLetGoAt", String(Date.now())]]);
    const live = aPage(store, true);
    live.fire("DOMContentLoaded");
    live.runTimers();
    expect(live.calls.stop, "a page whose script DID arrive was stopped").toBe(0);

    const stale = aPage(new Map([["thqLetGoAt", String(Date.now() - 5 * 60_000)]]));
    stale.fire("DOMContentLoaded");
    stale.runTimers();
    expect(stale.calls.stop, "a let-go from minutes ago stopped a page").toBe(0);
  });
});
