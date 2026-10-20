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
 * before signing in come from these files; the app's own screens, behind a
 * sign-in, keep the club's word.
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
