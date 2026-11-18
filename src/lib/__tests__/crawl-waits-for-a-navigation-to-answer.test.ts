import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readSource } from "./source";
import { isNavigationRequest, watchNavigations } from "../../../e2e/navigation-settle";

/**
 * THE CRAWL JUDGES A NAVIGATING PRESS WHEN THE SERVER HAS ANSWERED (nightly G60-1, 18 Nov 2026).
 *
 * "cup /print · One per group" sent `GET /print?…&_rsc=` 41 ms after the press and was answered at
 * 848 ms; the crawl had judged it after a fixed 700 ms and called a working control SILENT (first seen
 * G654-1, B83). The guarantee: a press that has started a navigation is judged only after that request
 * answers, bounded; an unanswered one is its own finding; a press that sends nothing is still silent.
 */
type R = { url(): string; headers(): Record<string, string> };
const req = (url: string, headers: Record<string, string> = { rsc: "1" }): R => ({ url: () => url, headers: () => headers });
function fakePage() {
  const e = new EventEmitter();
  return { e, on: (n: string, f: (r: R) => void) => e.on(n, f), off: (n: string, f: (r: R) => void) => e.off(n, f) };
}

describe("watchNavigations", () => {
  it("a navigation answered after 848 ms is waited for: settled only once it has answered", async () => {
    vi.useFakeTimers();
    try {
      const p = fakePage();
      const w = watchNavigations(p);
      const r = req("http://x/print?signs=group&_rsc=abc");
      p.e.emit("request", r);
      let done = false;
      const s = w.settled(10_000).then((v) => ((done = true), v));
      await vi.advanceTimersByTimeAsync(700); // where the old crawl stopped looking
      expect(done).toBe(false);
      expect(w.pending()).toBe(1);
      await vi.advanceTimersByTimeAsync(148);
      p.e.emit("requestfinished", r);
      expect(await s).toEqual({ ok: true });
      expect(w.pending()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a press that sends no navigation has nothing to wait for, so a silent control stays silent", async () => {
    const p = fakePage();
    const w = watchNavigations(p);
    p.e.emit("request", req("http://x/api/ping", {})); // an ordinary fetch is not a navigation
    expect(await w.settled(10_000)).toEqual({ ok: true });
  });

  it("a navigation nobody answers is reported with the address, in its own words", async () => {
    vi.useFakeTimers();
    try {
      const p = fakePage();
      const w = watchNavigations(p);
      p.e.emit("request", req("http://x/print?signs=group&_rsc=abc"));
      const s = w.settled(10_000);
      await vi.advanceTimersByTimeAsync(10_001);
      const v = await s;
      expect(v.ok).toBe(false);
      expect(!v.ok && v.waiting).toBe("/print?signs=group&");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed request ends the wait too", async () => {
    const p = fakePage();
    const w = watchNavigations(p);
    const r = req("http://x/a?_rsc=1");
    p.e.emit("request", r);
    const s = w.settled(10_000);
    p.e.emit("requestfailed", r);
    expect(await s).toEqual({ ok: true });
  });

  it("prefetches and server actions are not navigations; stop() lets go", () => {
    expect(isNavigationRequest(req("http://x/a?_rsc=1", { rsc: "1", "next-router-prefetch": "1" }))).toBe(false);
    expect(isNavigationRequest(req("http://x/a", { "next-action": "abc" }))).toBe(false);
    expect(isNavigationRequest(req("http://x/a?_rsc=1", { rsc: "1" }))).toBe(true);
    const p = fakePage();
    const w = watchNavigations(p);
    w.stop();
    p.e.emit("request", req("http://x/a?_rsc=1"));
    expect(w.pending()).toBe(0);
  });
});

describe("the console crawl uses it", () => {
  const spec = readSource("e2e/every-control.spec.ts");
  it("watches navigations, waits for them after the 700 ms, and reports an unanswered one as stuck", () => {
    expect(spec).toMatch(/watchNavigations\(page\)/);
    const after = spec.slice(spec.indexOf("waitForTimeout(700)"), spec.indexOf("if (picker) return"));
    expect(after).toMatch(/navigations\.settled\(/);
    expect(after).toMatch(/outcome: "stuck"/);
    expect(spec).toMatch(/navigations\.stop\(\)/);
  });
  it("still has a silent verdict for a press that sent nothing", () => {
    expect(spec).toMatch(/outcome: "silent", note: ""/);
  });
});
