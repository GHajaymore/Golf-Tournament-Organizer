import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { runInNewContext } from "node:vm";
import { HeldBeforeLoad } from "@/components/HeldBeforeLoad";
import { readSource } from "./source";

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

/**
 * What the page's form is: "held" (the code box, the names — `data-held-until-live`), "plain" (the
 * confirmation and whose-card forms — `data-plain-post`), or "card": a page whose form, if any, is
 * neither, and works only with its script.
 */
type PageKind = "held" | "plain" | "card";
const MARKS: Record<PageKind, string[]> = { held: ["data-held-until-live"], plain: ["data-plain-post"], card: [] };

function aPage(store: Map<string, string>, live = false, kind: PageKind = "held") {
  const timers: Array<() => void> = [];
  const listeners: Record<string, Listener[]> = {};
  const calls = { stop: 0, requestSubmit: 0, prevented: 0 };
  const marks = MARKS[kind];
  const form: Record<string, unknown> = {
    hasAttribute: (n: string) => marks.includes(n),
    getAttribute: () => "name",
    requestSubmit: () => (calls.requestSubmit += 1),
  };
  if (live) form["__reactFiber$x"] = {};
  const button = { value: "p1", name: "playerId", setAttribute() {}, removeAttribute() {}, style: {} as Record<string, string> };
  const document = {
    readyState: "loading",
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    // Answers the selector it is asked, as the browser does: a page with no such form has none.
    querySelector: (sel: string) => (marks.some((m) => sel.includes(`[${m}]`)) ? form : null),
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
  });

  it("a page stopped and left without a press spends the mark: the next page waits for its scripts as usual", () => {
    const store = new Map([["thqLetGoAt", String(Date.now())]]);
    const stopped = aPage(store);
    stopped.fire("DOMContentLoaded");
    stopped.runTimers();
    expect(stopped.calls.stop).toBe(1);
    // Left by a link, not a press on its form: nothing passes the mark on.
    const after = aPage(store);
    after.fire("DOMContentLoaded");
    after.runTimers();
    expect(after.calls.stop).toBe(0);
  });

  /**
   * THE WALK IS THREE PAGES WITHOUT SCRIPT SINCE THE ONE CONFIRMATION (2026-11-05). Round
   * scoring-by-group-1-2, iPhone's engine: the code was let go, the names page was stopped and the
   * name went at once — and the confirmation it opened waited for its scripts again, never painted,
   * and "Yes, that's right" never took a press. A press from a stopped page passes the mark on.
   */
  it("a press from a stopped page passes the mark on: the confirmation is stopped too, and the card never is", () => {
    const store = new Map([["thqLetGoAt", String(Date.now())]]);
    const names = aPage(store, false, "held");
    names.fire("DOMContentLoaded");
    names.runTimers();
    expect(names.calls.stop).toBe(1);
    names.press();
    expect(names.calls.prevented, "the name was held on a page whose scripts had stopped").toBe(0);

    const confirm = aPage(store, false, "plain");
    confirm.fire("DOMContentLoaded");
    confirm.runTimers();
    expect(confirm.calls.stop, "the confirmation kept waiting for scripts that had failed once (unpainted on Safari)").toBe(1);
    confirm.press();
    expect(confirm.calls.prevented, "Yes, that's right was held on a stopped page").toBe(0);

    // The card: its pad needs its script, which may yet come — it is never stopped.
    const card = aPage(store, false, "card");
    card.fire("DOMContentLoaded");
    card.runTimers();
    expect(card.calls.stop, "the card was stopped, and its pad can never wake").toBe(0);
  });

  it("every form /play posts the plain way says so: held, or data-plain-post — or the page it is on is never stopped", () => {
    const src = readSource("src/components/PlayClient.tsx");
    const forms = src.match(/<form\s+action=\{post(?:Name|Code)\}[^>]*>/g) ?? [];
    // CONTROL: the sweep sees the forms at all — the code, the groups, the names, the
    // confirmation's two answers and whose card with its way back.
    expect(forms.length, "the sweep found too few of /play's forms to mean anything").toBeGreaterThanOrEqual(6);
    const unmarked = forms.filter((f) => !/data-held-until-live=|data-plain-post=/.test(f));
    expect(unmarked, "a /play form that posts without script is unmarked, so its page waits unpainted on Safari").toEqual([]);
  });

  it("CONTROL: a plain form on a page that was NOT stopped neither is held nor passes a mark on", () => {
    const store = new Map<string, string>();
    const confirm = aPage(store, false, "plain");
    confirm.fire("DOMContentLoaded");
    confirm.runTimers();
    confirm.press();
    expect(confirm.calls.prevented, "a plain form was held").toBe(0);
    expect(store.size, "a plain post from a page with its scripts coming left a mark").toBe(0);
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
