import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * A REFUSAL IS BROUGHT INTO VIEW ONCE, NOT ON EVERY KEYSTROKE (2026-10-21).
 *
 * Eight refusals were made to scroll themselves into view with an inline ref,
 * `ref={(el) => el?.scrollIntoView(...)}`. An inline ref is a new function on
 * every render and React calls it again each time, so while a refusal stayed
 * up, any keystroke on the screen pulled the page back to it — somebody who had
 * scrolled away to correct the field it named was dragged back as they typed.
 * `bringIntoView` (src/lib/bring-into-view.ts) is one function with one
 * identity: called when the refusal appears, and not again.
 *
 * So: no inline ref anywhere in src may call scrollIntoView.
 */
const ROOT = "src";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return /\.(tsx|ts)$/.test(name) ? [p] : [];
  });
}

/** Lines where a ref is written as an inline function that scrolls. */
function inlineScrollRefs(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => line.includes("ref={(") && line.includes("scrollIntoView"))
    .map((line) => line.trim());
}

describe("a refusal is brought into view by the one stable function", () => {
  const all = files(ROOT);

  it("finds the source", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("no inline ref in src calls scrollIntoView", () => {
    const bad = all.flatMap((f) => inlineScrollRefs(readSource(f)).map((l) => `${f}: ${l}`));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("the refusals that were fixed use it", () => {
    for (const f of [
      "src/components/BracketFlights.tsx",
      "src/components/FlightBoard.tsx",
      "src/components/LoginPanel.tsx",
      "src/components/PlayClient.tsx",
      "src/components/RoundAllowance.tsx",
      "src/components/RoundClosedControl.tsx",
      "src/components/RoundTeamScoring.tsx",
      "src/components/SkinsPotClient.tsx",
    ]) {
      expect(readSource(f), `${f} no longer brings its refusal into view`).toContain("ref={bringIntoView}");
    }
  });

  it("control: the line that shipped is caught, and the stable ref is not", () => {
    const shipped = '<p role="alert" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>';
    expect(inlineScrollRefs(shipped)).toHaveLength(1);
    expect(inlineScrollRefs('<p role="alert" ref={bringIntoView}>')).toHaveLength(0);
  });
});
