import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { GUIDE_STEPS } from "../guide-steps";

/**
 * The step-by-step guide names buttons. A guide that names a button the app no
 * longer has sends an organizer looking for something that isn't there, so the
 * labels it leans on hardest are held to the screens that draw them. Reword a
 * button, and this turns red until the guide is reworded too.
 *
 * Read through `readSource`, so a label surviving only in a comment does not
 * count as the button still existing.
 */

const PINNED: [label: string, file: string][] = [
  ["Publish the link", "src/components/RegistrationClient.tsx"],
  ["Generate flights", "src/components/GroupingControls.tsx"],
  ["Save & publish", "src/components/FoursomeMaker.tsx"],
  ["Publish the tee sheet", "src/components/FoursomeMaker.tsx"],
  ["Launch tournament", "src/components/LifecycleBar.tsx"],
  ["Suspend play now", "src/components/PlayStatusControl.tsx"],
  ["Start this bet", "src/components/ContestsClient.tsx"],
  ["Everyone with a card", "src/components/SkinsPotClient.tsx"],
  ["Unlock setup", "src/components/SetupLockBanner.tsx"],
  ["Save scorecard", "src/components/StrokePlayEntry.tsx"],
  ["Certify my card", "src/components/PlayerCard.tsx"],
  ["Draw sides automatically", "src/components/TeamsClient.tsx"],
];

/** Every [[label]] the guide uses, flattened. */
function guideLabels(): Set<string> {
  const all = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\[\[([^\]]+)\]\]/g)) all.add(m[1]);
  };
  for (const section of GUIDE_STEPS) {
    for (const b of section.blocks) {
      if ("text" in b) scan(b.text);
      if ("items" in b) for (const it of b.items) scan(typeof it === "string" ? it : JSON.stringify(it));
    }
  }
  return all;
}

describe("the step-by-step guide names buttons the app really has", () => {
  const labels = guideLabels();

  for (const [label, file] of PINNED) {
    it(`"${label}" is in the guide and on its screen`, () => {
      expect(labels.has(label), `the guide no longer mentions "${label}"`).toBe(true);
      // JSX writes "&" as "&amp;" in text, so read the screen the way it renders.
      const screen = readSource(file).replace(/&amp;/g, "&");
      expect(screen, `${file} no longer draws "${label}"`).toContain(label);
    });
  }

  it("CONTROL: a label no screen draws is caught", () => {
    expect(readSource("src/components/FoursomeMaker.tsx")).not.toContain("Publish the tee sheet now please");
  });

  it("has every part the contents promise, with an id and blocks", () => {
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(10);
    for (const s of GUIDE_STEPS) {
      expect(s.id).toMatch(/^[a-z]+$/);
      expect(s.blocks.length, s.id).toBeGreaterThan(0);
    }
    expect(new Set(GUIDE_STEPS.map((s) => s.id)).size).toBe(GUIDE_STEPS.length);
  });
});
