import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * ONE LIST OF KINDS, ONE SET OF WORDS (2026-11-09). The kinds a club is offered
 * come from `playKindsFor(register)` and the words a screen prints for an
 * event's kind from `eventWords(kind, register)`. A screen that builds its own
 * list, or names a kind in a string, is one country's golf shown to every club.
 */
const SRC = join(__dirname, "..", "..");
const REPO = join(SRC, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => relative(REPO, p).split("\\").join("/"));
const OWNERS = ["src/lib/domain/play-kind.ts", "src/lib/domain/event-words.ts"];
const KIND_WORDS = /["'`](Society day|Roll-up|Charity day|Charity outing|Golf day)["'`]/;

/** The shapes: the list read outside its owners, a kind's word typed into code, a list asked for with no register. */
function offences(file: string, code: string): string[] {
  if (OWNERS.includes(file)) return [];
  const found: string[] = [];
  if (/\bPLAY_KIND_KEYS\b|\bplayKindWord\b/.test(code)) found.push("reads the kinds directly");
  if (KIND_WORDS.test(code)) found.push("types a kind's word");
  if (/\bplayKindsFor\(/.test(code) && !/\bregister\b/.test(code)) found.push("asks for a list with no register in sight");
  return found;
}

describe("the kinds of play follow the club's country, from one place", () => {
  it("no screen builds its own list of kinds or types a kind's word", () => {
    expect(FILES.length).toBeGreaterThan(100);
    const bad = FILES.flatMap((f) => offences(f, readSource(f)).map((o) => `${f}: ${o}`));
    expect(bad).toEqual([]);
  });

  it("CONTROL: the guard sees each shape", () => {
    expect(offences("src/x.tsx", "const k = PLAY_KIND_KEYS;")).toHaveLength(1);
    expect(offences("src/x.tsx", 'const k = "Roll-up";')).toHaveLength(1);
    expect(offences("src/x.tsx", "playKindsFor(us)")).toHaveLength(1);
    expect(offences("src/x.tsx", "playKindsFor(register)")).toEqual([]);
  });

  it("the screens that print a kind ask eventWords", () => {
    for (const f of ["src/components/ResultLines.tsx", "src/components/ClubEventsList.tsx", "src/components/EventSetupClient.tsx"]) {
      expect(readSource(f), f).toMatch(/eventWords\(/);
    }
    expect(readSource("src/components/EventSetupClient.tsx")).toMatch(/playKindsFor\(register/);
    // The dates label is named after the event's kind (Ajay, 2026-11-09), not the word Tournament.
    expect(readSource("src/components/EventSetupClient.tsx")).toMatch(/\{words\.kind\} dates/);
  });
});
