import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A GUEST'S PLAYER LINK IS NEVER ON A SHARED PRINT (J39/J40 PR 3; design §3.1, A11).
 *
 * A personal link is one guest's key to their card and Today. Its slip is handed
 * over at the desk, to that guest, with the scorecard. Everything else the app
 * prints is POSTED or SHARED — the tee sheet, the {cart} signs, the starting
 * sheet, the cards, the spare sign, the sign-up and entry posters, the bracket —
 * and is read by anyone walking past. None of those may build a player link.
 *
 * Held two ways: no shared print face names the link's builder (`playerLinkUrl`,
 * `linkAddress`) or the panel's code actions; and the ONLY components that build a
 * link are the guest's own two hand-overs: the organizer's panel and the slips.
 * Read through `readSource`, so a comment naming the builder does not count.
 */

/** Every face that is posted or shared. A file added to print/ later is swept too (below). */
const SHARED_FACES = [
  "src/components/print/PrintPages.tsx",
  "src/components/print/PrintKitClient.tsx",
  "src/components/print/PrintStamp.tsx",
  "src/lib/services/print-kit.ts",
  "src/components/TeeSheetPrint.tsx",
  "src/components/SignUpPoster.tsx",
  "src/components/EventEntryPoster.tsx",
  "src/components/BracketPrint.tsx",
];

/** The two places a guest's link is handed to that guest, and nowhere else. */
const HAND_OVERS = new Set(["src/components/PlayerLinkPanel.tsx", "src/components/print/PlayerLinkSlips.tsx"]);

const BUILDS_A_LINK = /\b(playerLinkUrl|linkAddress|showPlayerLink|printPlayerLinkSlips)\s*\(/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) return e.name === "__tests__" ? [] : filesUnder(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("a player link is never on a shared print", () => {
  it("every shared face exists (a renamed file would make the sweep vacuous)", () => {
    for (const f of SHARED_FACES) expect(existsSync(f), f).toBe(true);
  });

  for (const f of SHARED_FACES) {
    it(`${f} builds no player link`, () => {
      expect(readSource(f)).not.toMatch(BUILDS_A_LINK);
    });
  }

  it("of every print face, only the slips build one", () => {
    const builders = filesUnder("src/components/print").filter((f) => BUILDS_A_LINK.test(readSource(f)));
    expect(builders).toEqual(["src/components/print/PlayerLinkSlips.tsx"]);
  });

  it("across the components, only the panel and the slips build one", () => {
    const builders = filesUnder("src/components").filter((f) => BUILDS_A_LINK.test(readSource(f)));
    expect(builders.filter((f) => !HAND_OVERS.has(f))).toEqual([]);
    expect(builders.sort()).toEqual([...HAND_OVERS].sort());
  });

  it("CONTROL: a sign that builds a link is caught; one that names it in prose is not", () => {
    expect(BUILDS_A_LINK.test("const url = playerLinkUrl(origin, code);")).toBe(true);
    expect(BUILDS_A_LINK.test("{linkAddress (origin)}")).toBe(true);
    expect(BUILDS_A_LINK.test("// never call the link builder here")).toBe(false);
  });
});
