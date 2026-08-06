import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The team entry screen identifies each card by team, match and player.
 *
 * Dropping the match id looks harmless and passes every single-match test: it
 * only bites in a team round robin, where one side plays several matches. Then
 * two cards share a draft key, a score typed against one opponent appears
 * against the other, and React sees duplicate keys.
 *
 * Read from source because the bug is in how a key is built, and a component
 * test with one match per side would go green either way.
 */

const SRC = readFileSync(
  join(process.cwd(), "src", "components", "TeamEntryClient.tsx"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("team entry card identity", () => {
  it("includes the match in the draft key", () => {
    expect(SRC).toMatch(/keyFor\s*=\s*\(\s*teamId:\s*string,\s*matchId:\s*string,\s*playerId:\s*string\s*\)/);
    expect(SRC).toMatch(/\$\{teamId\}:\$\{matchId\}:\$\{playerId\}/);
  });

  it("seeds the draft under the same three-part key", () => {
    // A seed keyed differently from the lookup would silently show every card
    // as empty, which is worse than the collision it replaced.
    expect(SRC).toMatch(/seed\[`\$\{t\.teamId\}:\$\{t\.matchId\}:\$\{c\.playerId\}`\]/);
  });

  it("gives each rendered side a React key including the match", () => {
    expect(SRC).toMatch(/key=\{`\$\{t\.teamId\}:\$\{t\.matchId\}`\}/);
  });

  it("never falls back to an empty card", () => {
    // An untouched draft must render and save what the server already holds.
    // Falling back to a fresh array of nulls would blank a returned score.
    expect(SRC).toMatch(/draft\[key\]\s*\?\?\s*c\.strokes/);
    expect(SRC).toMatch(/draft\[key\]\s*\?\?\s*saved/);
    expect(SRC).not.toMatch(/draft\[key\]\s*\?\?\s*new Array/);
  });
});
