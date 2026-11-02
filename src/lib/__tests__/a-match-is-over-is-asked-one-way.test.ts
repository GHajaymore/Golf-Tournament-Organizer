import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { matchIsOver, resolveMatch } from "@/lib/domain/match";
import { readSource } from "./source";

/**
 * "IS THIS MATCH OVER" IS ASKED OF `matchIsOver` (2026-10-23, foundation pass).
 *
 * `resolveMatch(holes).complete` answers a narrower question — nothing is left
 * to play — and an EMPTY card has nothing left to play, so it reads complete
 * and halved. `matchIsOver` is that, and a card with a hole on it. The
 * re-measure of layer 6 found five places asking `.complete` directly, two of
 * them WRITERS: the team match rebuilt from its sides' cards
 * (`matchHolesOffTheLow` gives `[]` for two empty sides, and a round with no
 * card gives a list of length nought) stamped such a match scored, as a half.
 * Measured read-only on the development database: 0 of 6,528 stored matches
 * hold `[]`, so nothing stored shows it — and nothing stopped it either.
 */
describe("a match is over", () => {
  // Worked from Rule 3.2a(3): a match is won when one side leads by more holes
  // than remain. The empty card is the case the two functions disagree on.
  it("is decided, and never an untouched card", () => {
    expect(resolveMatch([]).complete).toBe(true); // the trap this file exists for
    expect(matchIsOver([])).toBe(false);
    expect(matchIsOver(Array(18).fill(null))).toBe(false);
    const card = (played: string, of = 18) =>
      Array.from({ length: of }, (_, i) => (played[i] ?? null) as "A" | "B" | "H" | null);
    // Five holes won, then nine halved: 5 up with 4 to play after the 14th — 5&4.
    expect(matchIsOver(card("AAAAAHHHHHHHHH"))).toBe(true);
    // The same at the turn: 5 up with 9 to play — alive.
    expect(matchIsOver(card("AAAAAHHHH"))).toBe(false);
    // Dormie: 3 up with 3 to play is not over; halving the 16th ends it 3&2.
    expect(matchIsOver(card("AAAHHHHHHHHHHHH"))).toBe(false);
    expect(matchIsOver(card("AAAHHHHHHHHHHHHH"))).toBe(true);
  });

  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const DIRECT = /resolveMatch\([^()]*\)\.complete/;

  it("CONTROL: the sweep recognises the copies it replaced, and not a resolution kept for its text", () => {
    expect(DIRECT.test("const complete = resolveMatch(holes).complete;")).toBe(true);
    expect(DIRECT.test("        complete: resolveMatch(holes).complete,")).toBe(true);
    expect(DIRECT.test("const resolution = useMemo(() => resolveMatch(holes), [holes]);")).toBe(false);
    expect(DIRECT.test("complete: matchIsOver(holes),")).toBe(false);
  });

  it("is asked of resolveMatch directly nowhere but in matchIsOver itself", () => {
    const files = sources("src");
    expect(files.length).toBeGreaterThan(200);
    const strays = files.filter((f) => !f.endsWith("domain/match.ts") && DIRECT.test(readSource(f)));
    expect(strays, "ask matchIsOver(holes) — or storedMatchIsOver(row) for a stored match").toEqual([]);
  });
});
