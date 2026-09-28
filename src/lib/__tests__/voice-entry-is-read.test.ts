import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * THE ORGANIZER'S "VOICE ENTRY" SWITCH IS READ WHEREVER A PLAYER SCORES.
 *
 * "Let scores be dictated out loud instead of typed" (Play settings) was
 * saved, templated and cloned, and no microphone read it — so a club that
 * switched it off still handed every player a mic. Found 2026-09-27 checking
 * the landing's voice claim against the code.
 *
 * `HoleByHoleCard` defaults `showVoice` to TRUE (the organizer's own entry
 * screen is not governed by the setting), which is exactly why a forgotten
 * prop fails silently. So every PLAYER path is pinned here, from the page that
 * reads the setting down to each component that draws a mic. The render test
 * in render.test.tsx proves the hole view obeys it; this proves the wiring.
 */
const tagProps = (src: string, tag: string) =>
  src.split(`<${tag}`).slice(1).map((rest) => rest.slice(0, rest.indexOf("/>")));

describe("the Voice entry setting reaches every player microphone", () => {
  it("/me/card hands the setting to PlayerCard", () => {
    const uses = tagProps(readSource("src/app/(player)/me/card/page.tsx"), "PlayerCard");
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toContain("voiceEntry={settings.voiceEntry}");
  });

  it("/play hands the setting to the card it shows", () => {
    const uses = tagProps(readSource("src/app/play/page.tsx"), "PlayClient").filter((u) => u.includes('stage="card"'));
    expect(uses.length, "the card surface of /play").toBe(1);
    expect(uses[0]).toContain("voiceEntry={settings.voiceEntry}");
  });

  it("PlayerCard passes it to both hole views and gates Say the card", () => {
    const src = readSource("src/components/PlayerCard.tsx");
    for (const tag of ["HoleByHoleCard", "GroupScoring"]) {
      const uses = tagProps(src, tag);
      expect(uses.length, `no <${tag}>`).toBeGreaterThan(0);
      for (const u of uses) expect(u, tag).toContain("showVoice={voiceEntry}");
    }
    const say = src.indexOf("Say the card");
    const gate = src.lastIndexOf("{voiceEntry && (", say);
    expect(gate, "Say the card sits inside the voiceEntry gate").toBeGreaterThan(0);
    // Still open when the button is drawn: the gate's fragment closes after it.
    expect(src.slice(gate, say)).not.toContain("</>");
  });

  it("GroupScoring and /play's card pass it on to the hole view", () => {
    for (const file of ["src/components/GroupScoring.tsx", "src/components/PlayClient.tsx"]) {
      const uses = tagProps(readSource(file), "HoleByHoleCard");
      expect(uses.length, file).toBeGreaterThan(0);
      for (const u of uses) expect(u, file).toContain("showVoice=");
    }
  });
});
