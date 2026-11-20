import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * ONE ORIENTATION FOR A MATCH CARD, AND NO SECOND COPY OF THE OLD ONE (2026-11-04).
 *
 * The match card used to be told who was holding it and turned round to face
 * them, flipping the stored holes for a holder on side B and flipping them back
 * on the way out. At a real cup two scorers opened the card from an opponent's
 * name, and pressed the place their own side's button had been: every hole they
 * won went to the other side. Side A is now the match's A side as drawn, on
 * every screen, and nothing is flipped (`matchCardFor`, `matchSideLabels`).
 *
 * The audit test drives the cup itself through `/play`. This is the sweep that
 * refuses the shape coming back anywhere in `src`: a card told who holds it, or
 * a hole result turned round ("A" to "B" and "B" to "A"). Ban the shape, not
 * the spelling — with a control proving the pattern sees the old code.
 */

/** The flip, however it is written: a hole that is "A" becomes "B" and "B" becomes "A". */
const FLIP = /===\s*"A"\s*\?\s*"B"\s*:\s*\w+\s*===\s*"B"\s*\?\s*"A"/;
/** A card built for somebody: `matchCardFor({ match, holderId … })`. */
const TOLD_WHO_HOLDS_IT = /matchCardFor\(\s*\{[^}]*\bholder/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Relative to the repository root, as `readSource` takes them.
const SRC = sourceFiles("src").map((path) => ({ path, text: readSource(path) }));

describe("the match card never turns round", () => {
  it("is never told who is holding it", () => {
    expect(SRC.filter((f) => TOLD_WHO_HOLDS_IT.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("never turns a match's holes round, on any screen that keeps one", () => {
    const keepers = ["src/components/MatchKeeper.tsx", "src/components/MatchStrokeKeeper.tsx", "src/components/HoleResultCard.tsx", "src/components/PlayClient.tsx", "src/lib/services/match-card.ts"];
    for (const file of keepers) expect(readSource(file), file).not.toMatch(FLIP);
    expect(readSource("src/lib/services/match-card.ts")).not.toMatch(/\bflipped\b|\biAmA\b/);
    // The answer a result was saved from was "me" or "them" from the holder's side.
    expect(readSource("src/components/MatchKeeper.tsx")).not.toMatch(/\bflipped\b|\bfromHolder\b|===\s*"me"|===\s*"them"/);
  });

  it("CONTROL: both patterns see the code the cup was kept on", () => {
    const before = stripComments(`
      holes: iAmA ? holes : holes.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h)),
      const card = await matchCardFor({ match, holderId: session.playerId, holderSides: mySides });
    `);
    expect(before).toMatch(FLIP);
    expect(before).toMatch(TOLD_WHO_HOLDS_IT);
    expect(SRC.length, "the sweep read no source at all").toBeGreaterThan(100);
  });
});
