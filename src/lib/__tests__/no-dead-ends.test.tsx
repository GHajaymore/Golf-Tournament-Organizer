import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WayForward } from "@/components/WayForward";
import { ALL_PLAYER_SCREENS } from "@/lib/player-nav";
import { readSource } from "./source";

/**
 * A PLAYER SCREEN WITH NOTHING ON IT STILL OFFERS SOMEWHERE TO GO.
 *
 * Every one of these screens has a state where it can show nothing — a card
 * for somebody not entered, a board the club has not published, a round the
 * app will not rank — and each one printed a sentence and stopped. `/me/card`
 * offered a way out of exactly one of its three, which is how the pattern was
 * spotted: a screen that is working correctly reads as a broken one.
 *
 * Asserted per REFUSAL, not per file: a page can return early several times,
 * and counting files would pass on the one branch somebody remembered.
 */

/** Player pages that return early with an explanation instead of the screen. */
const REFUSING = ["/me/card", "/me/board"];

function source(href: string): string {
  return readSource("src", "app", "(player)", ...href.slice(1).split("/"), "page.tsx");
}

describe("the way out of an empty player screen", () => {
  it("is offered by every early return on the screens that have them", () => {
    for (const href of REFUSING) {
      const src = source(href);
      // Each refusal is its own `return (` before the screen's real one.
      const refusals = src.split("return (").length - 2;
      const ways = src.split("<WayForward").length - 1;
      expect(refusals, `${href}: counted no refusals, so this sweep is measuring nothing`).toBeGreaterThan(0);
      expect(ways, `${href} has ${refusals} refusal(s) and ${ways} way(s) out`).toBe(refusals);
    }
  });

  it("names screens that exist", () => {
    // A way out pointing at a route this app does not serve is worse than
    // none — the same fault the org setup checklist shipped with five of them.
    const known = new Set(ALL_PLAYER_SCREENS.map((s) => s.href));
    for (const href of REFUSING) {
      for (const m of source(href).matchAll(/href: "([^"]+)"/g)) {
        expect(known.has(m[1]), `${href} offers ${m[1]}, which is not a player screen`).toBe(true);
      }
    }
  });

  it("makes the first link the primary one and renders nothing when empty", () => {
    const out = renderToStaticMarkup(
      <WayForward
        links={[
          { href: "/me", label: "Back to today", icon: "flag" },
          { href: "/me/card", label: "My card", icon: "cards" },
        ]}
      />,
    );
    expect(out).toContain("btn btn-primary");
    expect(out).toContain("btn btn-secondary");
    expect(out.indexOf("btn btn-primary")).toBeLessThan(out.indexOf("btn btn-secondary"));
    expect(renderToStaticMarkup(<WayForward links={[]} />)).toBe("");
  });
});
