import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { MicNote } from "@/components/MicNote";

/**
 * EVERY MICROPHONE SAYS WHAT IT DOES, AND THEY ALL SAY THE SAME THING.
 *
 * Four components open a mic — the player's hole-by-hole card, the player's
 * full card, the organizer's score entry, and `VoiceAsk`. None of them told
 * anybody what happened to what was said, which Ajay asked for on 2026-09-21:
 * a golfer handed a phone that wants microphone permission cannot tell whether
 * it is listening for the rest of the round.
 *
 * The risk in fixing that is four sentences drifting into four different
 * promises, which is this repo's most-found defect and a worse one than usual
 * when the subject is privacy. So there is ONE component and this asserts every
 * mic renders it.
 *
 * It also asserts what the component must NOT say, which is the half a reviewer
 * cannot eyeball: a first draft claimed the audio "never leaves the phone".
 * That is false — `startDictation` uses the browser's Web Speech API, and
 * Chrome's implementation sends audio to a Google service to transcribe it.
 * Our code never uploads anything; the browser's behaviour is not ours to deny.
 */

/** Every file that opens a mic. Swept, not listed, so a fifth is covered. */
const MIC_FILES = [
  "src/components/HoleByHoleCard.tsx",
  "src/components/PlayerCard.tsx",
  "src/components/ScoreEntryClient.tsx",
  "src/components/StrokePlayEntry.tsx",
  "src/components/VoiceAsk.tsx",
];

describe("every microphone explains itself", () => {
  it("finds exactly the mics this test knows about", () => {
    /**
     * THE CONTROL, and it is what stops the list going stale. A fifth mic added
     * next month would otherwise be covered by nothing while this stayed green
     * — the unexercised-allowlist shape recorded in
     * `real-test-not-a-plausible-measurement`.
     */
    const opens = MIC_FILES.filter((f) => readSource(f).includes("startDictation("));
    expect(
      opens.sort(),
      "a file on the mic list no longer opens a mic — drop it, or the list is stale",
    ).toEqual([...MIC_FILES].sort());
  });

  it("renders the shared note wherever a mic is offered", () => {
    for (const f of MIC_FILES) {
      expect(readSource(f), `${f} opens a mic without saying what it does`).toMatch(/<MicNote/);
    }
  });

  it("says the three things that are true of this app", () => {
    const html = renderToStaticMarkup(<MicNote />);
    // Only while pressed — the claim `startDictation`'s call sites support.
    expect(html).toMatch(/only on while you use this button/i);
    expect(html).toMatch(/never in the background/i);
    // Nothing kept, and only the scores are taken from it.
    expect(html).toMatch(/recorded or\s+kept/i);
    expect(html).toMatch(/into the card/i);
  });

  it("stays short enough to be read on a phone", () => {
    /**
     * A privacy note nobody reads protects nobody, and this sat at four lines
     * above the scorecard on a 376px screen until Ajay asked for the screen to
     * be simple. Pinned as a LENGTH rather than as wording, so it can be
     * reworded but not quietly grow back.
     */
    const text = renderToStaticMarkup(<MicNote />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text.length, `the note is ${text.length} characters: "${text}"`).toBeLessThan(160);
  });

  it("claims nothing about where the browser sends the audio", () => {
    /**
     * THE ASSERTION THAT WOULD HAVE CAUGHT THE FIRST DRAFT. Chrome's Web Speech
     * API transcribes server-side, so any promise that the sound stays on the
     * device is false however true it is of our own code. A privacy claim that
     * is wrong is worse than none.
     */
    const html = renderToStaticMarkup(<MicNote />).toLowerCase();
    for (const forbidden of [
      "never leaves",
      "stays on your phone",
      "on this phone",
      "on-device",
      "on your device",
      "not sent",
      "never sent",
    ]) {
      expect(html, `MicNote claims "${forbidden}", which the Web Speech API does not support`).not.toContain(
        forbidden,
      );
    }
  });
});
