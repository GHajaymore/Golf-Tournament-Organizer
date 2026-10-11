import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * NO SCREEN DRAWS FROM ITS OWN CLOCK (2026-10-11).
 *
 * A `"use client"` component is rendered TWICE for a page's first paint: once
 * on the server, for the HTML, and once in the browser, to take it over. If
 * what it draws depends on the time, the two can differ — "59 seconds ago"
 * and then "1 minute ago", or one side's today and the other's — and React
 * throws away the server's HTML for that part and reports #418.
 *
 * That fault has struck this app's CI on six different screens, never twice on
 * the same one and never on demand (CLAUDE.md). Three sources were found and
 * fixed one at a time, each by somebody who had just been bitten: the message
 * list's "2m", the promotion badge, the live board's countdown. Each fix moved
 * the clock into an effect. Two more were still there the day this was
 * written — a relative time on the first-tournament screen and "today" on the
 * club's events list — found by reading for the CLASS instead of waiting for
 * the next one to land.
 *
 * The shape they share is a helper that takes the time as its LAST argument
 * and defaults it to now: `sinceWords(when, now = new Date())`. That default
 * is right on the server and in a test, and wrong in a component's render. So:
 * every such helper is found from its declaration, and no client component may
 * call one without handing it the time.
 *
 * What this does NOT see: a component that reads `Date.now()` itself. Those
 * were read one by one the same day — each is inside an effect or a handler.
 */

function filesUnder(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = `${dir}/${name}`;
    if (statSync(join(process.cwd(), path)).isDirectory()) filesUnder(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** The text between an opening bracket and its match, and where it ends. */
function bracketed(src: string, open: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return { inner: src.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Top-level arguments — commas inside brackets, braces and generics do not split. */
function topLevel(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "{" || c === "<") depth += 1;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(args.slice(from, i));
      from = i + 1;
    }
  }
  out.push(args.slice(from));
  return out.map((a) => a.trim()).filter(Boolean);
}

/** Every exported helper whose LAST parameters default to the current time, and how many it must be given before that. */
function clockDefaulting(): Map<string, number> {
  const found = new Map<string, number>();
  const libs = filesUnder("src/lib", (p) => p.endsWith(".ts") && !p.includes("__tests__/"));
  for (const file of libs) {
    const src = readSource(...file.split("/"));
    for (const piece of src.split("export function ").slice(1)) {
      const name = piece.slice(0, piece.indexOf("("));
      if (!name || name.includes(" ") || name.includes("<")) continue;
      const params = bracketed(piece, piece.indexOf("("));
      if (!params) continue;
      const list = topLevel(params.inner);
      const clockAt = list.findIndex((p) => p.includes("= new Date()") || p.includes("= Date.now()"));
      if (clockAt >= 0) found.set(name, clockAt);
    }
  }
  return found;
}

function callsWithoutAClock(src: string, helpers: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [name, clockAt] of helpers) {
    let from = 0;
    for (;;) {
      const at = src.indexOf(`${name}(`, from);
      if (at < 0) break;
      from = at + name.length;
      // A longer name ending in this one is another function.
      const before = src[at - 1] ?? " ";
      if (/[A-Za-z0-9_$.]/.test(before)) continue;
      const args = bracketed(src, at + name.length);
      if (!args) continue;
      if (topLevel(args.inner).length <= clockAt) out.push(`${name}(${args.inner.replace(/\s+/g, " ").slice(0, 60)})`);
    }
  }
  return out;
}

const helpers = clockDefaulting();
const CLIENT = [
  ...filesUnder("src/components", (p) => p.endsWith(".tsx") || p.endsWith(".ts")),
  ...filesUnder("src/app", (p) => p.endsWith(".tsx")),
].filter((file) => readSource(...file.split("/")).trimStart().startsWith('"use client"'));

describe("a client component and the time", () => {
  it("is handed the time by whoever renders it — it never takes a helper's default", () => {
    const wrong = CLIENT.flatMap((file) => callsWithoutAClock(readSource(...file.split("/")), helpers).map((c) => `${file} — ${c}`));
    expect(wrong).toEqual([]);
  });

  it("CONTROL: the helpers are found from their own declarations", () => {
    // If the reader broke, there would be nothing to refuse and the test above would pass.
    expect(helpers.size).toBeGreaterThanOrEqual(8);
    expect(helpers.get("sinceWords"), "sinceWords(when, now = new Date())").toBe(1);
    // The club's day is read from an instant, and the instant defaults to now —
    // right on the server, and exactly what a screen must not leave to it.
    expect(helpers.get("clubToday"), "clubToday(zone, at = new Date())").toBe(1);
    expect(helpers.get("clubDay"), "clubDay(zone, at = new Date())").toBe(1);
    // `todayIso`, `deadlinePassed` and `playerMayChange` were on this list.
    // They have NO default any more — the compiler makes every caller say what
    // day it is (`the-server-asks-the-club-what-day-it-is.test.ts`), which is
    // the stronger form of the same rule.
    expect(helpers.has("todayIso")).toBe(false);
    expect(helpers.has("deadlinePassed")).toBe(false);
  });

  it("CONTROL: the client components are found, and there are many", () => {
    expect(CLIENT.length).toBeGreaterThan(80);
    expect(CLIENT).toContain("src/components/CreateFirstTournament.tsx");
    expect(CLIENT).toContain("src/components/ClubEventsList.tsx");
  });

  it("CONTROL: a call that leaves the time to the helper is seen, and one that hands it over is not", () => {
    const h = new Map([
      ["sinceWords", 1],
      ["todayIso", 0],
    ]);
    expect(callsWithoutAClock("<p>{sinceWords(ask.askedAt)}</p>", h)).toEqual(["sinceWords(ask.askedAt)"]);
    expect(callsWithoutAClock("currentSeason(todayIso(), season)", h)).toEqual(["todayIso()"]);
    expect(callsWithoutAClock("sinceWords(ask.askedAt, now)", h)).toEqual([]);
    expect(callsWithoutAClock("sinceWords(pick(a, b), new Date(renderedAt))", h)).toEqual([]);
    expect(callsWithoutAClock("todayIso(now)", h)).toEqual([]);
    // Another function whose name merely ends the same way.
    expect(callsWithoutAClock("notTodayIso()", h)).toEqual([]);
  });
});
