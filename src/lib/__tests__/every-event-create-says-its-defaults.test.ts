import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY NEW EVENT SAYS WHAT IT STARTS WITH (redesign 2.4).
 *
 * `Event.bracketMode` defaults, in the COLUMN, to the legacy "split". A create
 * that forgets it makes an event with the old reading, silently. Each
 * `.event.create(` body must spread `newEventDefaults(`, or spread
 * `eventBase(` — the demo club's one builder of the columns both its
 * tournaments share, which itself spreads `newEventDefaults(` (checked below).
 */

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The argument of every `event.create(` call, balanced. */
export function eventCreates(src: string): string[] {
  const out: string[] = [];
  const re = /\.event\.create\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
      i += 1;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

export function saysItsDefaults(body: string): boolean {
  return /\.\.\.\s*(newEventDefaults|eventBase)\(/.test(body);
}

describe("every Event create says what a new event starts with", () => {
  it("each create spreads newEventDefaults (or the demo's eventBase)", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const f of filesUnder("src")) {
      const src = readSource(f);
      for (const body of eventCreates(src)) {
        seen += 1;
        if (!saysItsDefaults(body)) missing.push(`${f}: ${body.slice(0, 60).replace(/\s+/g, " ")}…`);
      }
    }
    expect(missing, "a new event would start with the legacy bracket mode: spread ...newEventDefaults()").toEqual([]);
    // CONTROL on the reader: five creates on 2026-11-21.
    expect(seen).toBeGreaterThanOrEqual(5);
  });

  it("the demo club's eventBase itself spreads newEventDefaults", () => {
    const src = readSource("src/lib/services/demo-club.ts");
    const base = src.slice(src.indexOf("function eventBase("));
    expect(base.slice(0, base.indexOf("\n}\n"))).toMatch(/\.\.\.newEventDefaults\(/);
  });

  it("CONTROL: a create that forgets is caught; one that spreads passes", () => {
    const forgot = `await prisma.event.create({ data: { organizationId, name: "x" } });`;
    const said = `await prisma.event.create({ data: { organizationId, ...newEventDefaults(), name: f(a) } });`;
    const viaBase = `await prisma.event.create({ data: { ...eventBase(o, c), name: "x" } });`;
    expect(eventCreates(forgot)).toHaveLength(1);
    expect(saysItsDefaults(eventCreates(forgot)[0])).toBe(false);
    expect(saysItsDefaults(eventCreates(said)[0])).toBe(true);
    expect(saysItsDefaults(eventCreates(viaBase)[0])).toBe(true);
  });
});
