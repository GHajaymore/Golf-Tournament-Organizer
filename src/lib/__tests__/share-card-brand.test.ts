import { describe, expect, it } from "vitest";
import { SHARE_CARD } from "@/lib/themes";
import { readSource } from "./source";

/**
 * THE SHARE CARD WEARS THE SAME ORANGE AS THE LOCKUP.
 *
 * `opengraph-image.tsx` is drawn by Satori, which has no stylesheet: it cannot
 * read `--thq-*`, so it takes literal colours from SHARE_CARD. A literal copy of
 * a token drifts silently — the share card that unfurls in a golf WhatsApp group
 * would keep last year's orange while every screen moved on. So each copy is
 * pinned to the one declaration it mirrors in globals.css, the same way the
 * home-screen icon's two colours are pinned in brand-consistency.test.ts.
 */
describe("the share card's brand colours match the app's", () => {
  const css = readSource("src/app/globals.css");
  const token = (name: string) =>
    new RegExp(`--thq-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

  it.each([
    ["flag", "flag"],
    ["flagLight", "orange-light"],
    ["flagDeep", "orange-deep"],
    ["onFlag", "on-flag"],
    ["fairway", "ball"],
  ] as const)("SHARE_CARD.%s is the app's thq-%s", (key, name) => {
    const declared = token(name);
    expect(declared, `thq-${name} is not declared in globals.css`).toBeTruthy();
    expect(SHARE_CARD[key].toLowerCase()).toBe(declared);
  });
});
