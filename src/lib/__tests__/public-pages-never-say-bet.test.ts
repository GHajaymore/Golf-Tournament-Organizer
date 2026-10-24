import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";

/**
 * THE PUBLIC PAGES SAY "SIDE GAMES", NEVER "BET" (2026-10-21).
 *
 * Ad platforms review the page an advertisement lands on, and Meta and Google
 * treat "bet", "wager" and "gambling" as gambling — an ad to a page that says
 * them is refused, or the account restricted. The panel's ad director found
 * the front page saying "side bets" three times. The words a stranger reads
 * before signing in come from these files; the app's own screens are swept
 * for the phrases below, at the foot of this file.
 *
 * Comments are stripped first, so a note explaining this rule cannot trip it.
 */
const ROOT = process.cwd();
const files = [
  join("src", "app", "page.tsx"),
  join("src", "app", "faq", "page.tsx"),
  join("src", "app", "interest", "page.tsx"),
  join("src", "app", "privacy", "page.tsx"),
  join("src", "app", "terms", "page.tsx"),
  join("src", "lib", "domain", "interest.ts"),
  join("src", "lib", "sign-in-gate.ts"),
  join("src", "components", "LandingAuth.tsx"),
  join("src", "components", "InterestForm.tsx"),
  ...readdirSync(join(ROOT, "src", "lib", "landing")).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join("src", "lib", "landing", f)),
  ...readdirSync(join(ROOT, "src", "components", "landing")).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join("src", "components", "landing", f)),
];
const GAMBLING = /\b(bets?|betting|wagers?|wagering|gambl\w*)\b/i;

describe("the words a stranger reads before signing in", () => {
  it("CONTROL: the sweep reads the front page and the landing modules", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(GAMBLING.test("Skins, Nassau, pots and side bets")).toBe(true);
    expect(GAMBLING.test("Skins, Nassau, pots and side games")).toBe(false);
  });

  for (const f of files) {
    it(`${f} says side games, never bet, wager or gambling`, () => {
      const src = stripComments(readFileSync(join(ROOT, f), "utf8"));
      const hit = GAMBLING.exec(src);
      expect(hit ? src.slice(Math.max(0, hit.index - 60), hit.index + 40) : null).toBeNull();
    });
  }
});

/**
 * AND THE APP'S OWN SCREENS SAY IT TOO (Ajay, 2026-10-21: "side games will
 * resonate with our moto of no gambling"). The paragraph above once kept "the
 * club's word" behind the sign-in; he ruled otherwise, so "Start a side bet",
 * "Add a bet" and "Remove this bet" are "game" now, on every screen, in the
 * guide and in the player's Help.
 *
 * Code is full of `bet` as a NAME — `bet.name`, `renameBet`, `sideBet` — which
 * a person never reads, so this sweep looks for the PHRASES a sentence makes
 * of the word rather than the word itself. The control shows it sees each one
 * the rename removed, and passes over the names it must leave alone.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== "__tests__") sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
}
/**
 * And the word as a WHOLE STRING, which a sentence is assembled around: the
 * Nassau's round result was `${n} ${unit}` with the unit "bets", so every
 * report and results screen read "Tied: … · 3 bets" while no phrase above was
 * anywhere in the source (walked on the seeded festival's report, 2026-10-23).
 */
const PHRASES =
  /\b(side bets?|add a bet|start this bet|(?:this|the|a|one|friendly|every) bet|three bets|bets? (?:on|in|and|between|halved))\b|["'`]bets?["'`]/i;

describe("the words a member reads after signing in", () => {
  const all = sourceFiles("src");

  it("CONTROL: the sweep reads the whole app and sees every phrase it guards", () => {
    expect(all.length).toBeGreaterThan(400);
    for (const said of [
      "Start a side bet", "Side bets — Round 1", "Add a bet", "Remove this bet", "Start this bet",
      "One bet on the match itself", "three bets on one match", "a bet between two sides", "a friendly bet",
      'unit: most === 1 ? "bet" : "bets"', 'note: "Every bet halved"',
    ]) expect(PHRASES.test(said), said).toBe(true);
    for (const name of ["bet.name", "renameBet(", "sideBet ? x : y", "const bets = []", "betName"]) {
      expect(PHRASES.test(name), name).toBe(false);
    }
  });

  it("no screen, guide line or help topic calls a side game a bet", () => {
    const hits: string[] = [];
    for (const f of all) {
      const src = stripComments(readFileSync(join(ROOT, f), "utf8"));
      const m = PHRASES.exec(src);
      if (m) hits.push(`${f}: …${src.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, " ")}…`);
    }
    expect(hits).toEqual([]);
  });
});
