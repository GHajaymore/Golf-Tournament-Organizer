import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, formatClock } from "@/lib/domain/locale";
import { readSource } from "./source";

/**
 * A CLOCK TIME IS WRITTEN BY ONE FUNCTION, ON BOTH SIDES.
 *
 * The first CI run of the browser spec that compares the server's formatting
 * with the browser's (`e2e/formats-agree.spec.ts`, Node 20 on Linux) found a
 * Korean club's "Recent changes" written "PM 01:05" by the server and
 * "오후 01:05" by the browser: two editions of the same locale data, and the
 * words for the halves of the day are one of the things that moved between
 * them. Every local run had been green, because this machine's Node agrees
 * with its browser. A line drawn on both sides in different words is a
 * hydration mismatch, on whichever server production happens to run.
 *
 * `formatClock` takes the day-period word from its own table where the engines
 * are known to part, and everything else from `Intl`. This file holds two
 * things about it:
 *
 *  - WHAT IT WRITES, for every language the app offers, before noon and after —
 *    pinned as values, so the same file run on another Node (CI is on 20) fails
 *    if that engine writes anything else;
 *  - THAT NOTHING GOES ROUND IT: no screen formats a time of day itself.
 *
 * What it cannot see: a browser. That half is `formats-agree.spec`, which
 * formats through the same function on both sides.
 */

const AFTER_NOON = new Date("2026-05-14T13:05:00Z");
const BEFORE_NOON = new Date("2026-05-14T01:05:00Z");
const TIME = { hour: "numeric", minute: "2-digit", timeZone: "UTC" } as const;
const STAMP = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" } as const;

describe("a clock time, written the same by every engine", () => {
  it("Korean: the day-period words are the app's own, in the place the language puts them", () => {
    // 오후 1:05 · 오전 1:05 — the words first, as Korean writes a time.
    expect(formatClock(AFTER_NOON, "ko-KR", TIME)).toBe("\uC624\uD6C4 1:05");
    expect(formatClock(BEFORE_NOON, "ko-KR", TIME)).toBe("\uC624\uC804 1:05");
    expect(formatClock(AFTER_NOON, "ko-KR", STAMP)).toBe("5\uC6D4 14\uC77C \uC624\uD6C4 01:05");
    // Noon and midnight fall on the right side of the line.
    expect(formatClock(new Date("2026-05-14T12:00:00Z"), "ko-KR", TIME)).toBe("\uC624\uD6C4 12:00");
    expect(formatClock(new Date("2026-05-14T00:00:00Z"), "ko-KR", TIME)).toBe("\uC624\uC804 12:00");
    expect(formatClock(new Date("2026-05-14T11:59:00Z"), "ko-KR", TIME)).toBe("\uC624\uC804 11:59");
  });

  it("the half of the day is read in the zone the time is written in, not the server's", () => {
    // 13:05 UTC is 22:05 in Seoul and 09:05 in New York: the same instant, two different halves.
    const at = AFTER_NOON;
    expect(formatClock(at, "ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" })).toBe("\uC624\uD6C4 10:05");
    expect(formatClock(at, "ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })).toBe("\uC624\uC804 9:05");
  });

  it("every language the app offers writes these, on any server", () => {
    const written = Object.fromEntries(LOCALES.map(({ tag }) => [tag, [formatClock(AFTER_NOON, tag, TIME), formatClock(BEFORE_NOON, tag, TIME)]]));
    expect(written).toEqual({
      "en-US": ["1:05 PM", "1:05 AM"],
      "en-GB": ["13:05", "1:05"],
      "en-AU": ["1:05 pm", "1:05 am"],
      "en-IN": ["1:05 pm", "1:05 am"],
      "ja-JP": ["13:05", "1:05"],
      "ko-KR": ["\uC624\uD6C4 1:05", "\uC624\uC804 1:05"],
      "zh-CN": ["13:05", "1:05"],
      "de-DE": ["13:05", "1:05"],
      "fr-FR": ["13:05", "1:05"],
      "es-ES": ["13:05", "1:05"],
    });
  });

  it("a language with no line in the table is written by the engine, with plain spaces", () => {
    const us = formatClock(AFTER_NOON, "en-US", TIME);
    expect(us).toBe("1:05 PM");
    // The engine puts a narrow no-break space before "PM"; the app writes an ordinary one.
    expect(Array.from(us).every((ch) => ch.codePointAt(0)! < 127), "a space that is not a plain space").toBe(true);
    expect(formatClock(AFTER_NOON, undefined, TIME), "the device's own language still works").toMatch(/1[:.]05|13[:.]05/);
  });
});

describe("no screen formats a time of day itself", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__") walk(p, out);
      } else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
    }
    return out;
  };
  const files = walk("src");

  it("CONTROL: the sweep reads the source, and sees the one place a clock time is formatted", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(readSource("src/lib/domain/locale.ts")).toContain("export function formatClock(");
    expect(readSource("src/components/RecentChanges.tsx"), "the line that was written twice now comes through it").toContain("formatClock(");
  });

  it("nothing calls toLocaleTimeString, and nothing hands toLocaleString an hour", () => {
    const direct: string[] = [];
    for (const file of files) {
      const code = readSource(file);
      if (code.includes(".toLocaleTimeString(")) direct.push(`${file}: toLocaleTimeString`);
      // `toLocaleString(…, { … hour: … })` — a date AND a clock, formatted in place.
      for (const m of code.matchAll(/\.toLocaleString\(([^;]*?)\)/g)) {
        if (/\bhour\s*:/.test(m[1])) direct.push(`${file}: toLocaleString with an hour`);
      }
    }
    expect(direct, "format a clock time with formatClock() from domain/locale, so the server and the browser write the same words").toEqual([]);
  });
});
