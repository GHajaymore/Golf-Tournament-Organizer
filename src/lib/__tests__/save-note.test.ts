import { describe, it, expect } from "vitest";
import { visibleSaveNote, lockedSaveNote, type SavedNote } from "@/lib/domain/save-note";
import { readSource } from "./source";

/**
 * A CARD THAT SAID "SAVED." AND WAS NOT.
 *
 * Walked on 2026-09-11, a two-player round on the console's entry screen.
 * Entered the first card and pressed Save. Picked the second player. Typed
 * their eighteen holes. The footer read
 *
 *     Front 37 · Back 37 · 18/18 holes · Saved.
 *
 * and the database held ONE scorecard. The 74 was never sent.
 *
 * Nothing was wrong with saving. `saveNote` was a plain string, set when a
 * save returned and never cleared — so it was still the first player's, sitting
 * directly after "18/18 holes" on somebody else's card. Under
 * `scoreEntryWindow: "after"` this screen keeps a partial card on the device
 * and sends nothing until the scorer asks, so there was no request to notice
 * missing and no error to read.
 *
 * The reason it is a rule here rather than a `setSaveNote("")` in the click
 * handlers: five places in that component mutate the cards, and a sixth added
 * later would not know. Derived, so it cannot be forgotten.
 */
const note = (over: Partial<SavedNote> = {}): SavedNote => ({
  text: "Saved.",
  cards: '{"a":[4,4],"b":[null,null]}',
  playerId: "a",
  ...over,
});

describe("how long Saved. is allowed to stay on the screen", () => {
  it("stands while nothing has changed since the save", () => {
    expect(visibleSaveNote(note(), '{"a":[4,4],"b":[null,null]}', "a")).toBe("Saved.");
  });

  it("goes the moment the card it described is edited", () => {
    /**
     * The dangerous half. This is the state that loses a round: the scorer
     * types and the screen goes on saying the card is in.
     */
    expect(visibleSaveNote(note(), '{"a":[4,5],"b":[null,null]}', "a")).toBe("");
  });

  it("goes when ANOTHER player's card is edited, not just the visible one", () => {
    /**
     * The hole-by-hole view saves every player in the tee group at once, so a
     * note about four cards has to stop being true when any of the four
     * changes. Comparing only the card on screen would leave it standing over
     * three rounds that no longer match what was sent.
     */
    expect(visibleSaveNote(note(), '{"a":[4,4],"b":[5,null]}', "a")).toBe("");
  });

  it("goes when the scorer moves to a different player", () => {
    // Merely wrong rather than costly on its own — and it is what made the
    // case above so easy to believe.
    expect(visibleSaveNote(note(), '{"a":[4,4],"b":[null,null]}', "b")).toBe("");
  });

  it("says nothing at all before the first save", () => {
    expect(visibleSaveNote(null, "{}", "a")).toBe("");
    expect(visibleSaveNote(undefined, "{}", "a")).toBe("");
  });

  it("carries the longer wording through unchanged", () => {
    /**
     * The locked-card message is the one that actually needs reading — it
     * names cards that were skipped. Truncating or re-deriving it here would
     * be a second copy of wording the caller already owns.
     */
    const long = "Not saved — Ada Byron is already approved. An organizer can reopen it below to correct it.";
    expect(visibleSaveNote(note({ text: long }), '{"a":[4,4],"b":[null,null]}', "a")).toBe(long);
  });

  it("does not treat a different serialisation as the same cards", () => {
    // Key order is stable because the same object is stringified both times;
    // this pins that the comparison is on the string and nothing clever.
    expect(visibleSaveNote(note(), '{"b":[null,null],"a":[4,4]}', "a")).toBe("");
  });
});

/**
 * And the screen has to actually ASK.
 *
 * The pure tests above hand the state in, so they cannot see the component
 * keeping its own string again — which is precisely the shape the bug had.
 */
describe("what the entry screen does with it", () => {
  const src = () => readSource("src/components/StrokePlayEntry.tsx");

  it("derives the note rather than storing one", () => {
    expect(src()).toMatch(/visibleSaveNote\(saved, JSON\.stringify\(cards\), playerId\)/);
  });

  it("keeps no setter that could leave a stale note behind", () => {
    /**
     * `setSaveNote` was the whole defect. Its absence is the assertion — an
     * absence check is the safe direction here, and it cannot be satisfied by
     * a comment, since `readSource` strips those.
     */
    expect(src()).not.toMatch(/setSaveNote/);
  });

  it("records what was sent, not merely that something was", () => {
    // Without the cards and the player, there is nothing to compare against
    // and the note is back to standing for ever.
    const s = src();
    expect(s).toMatch(/cards: JSON\.stringify\(cards\)/);
    expect(s).toMatch(/playerId,/);
  });
});

/**
 * AN APPROVED CARD IS SKIPPED, AND THE NOTE MAY NOT OPEN WITH "SAVED" OVER IT.
 *
 * Walked 2026-10-08 (grid cell T11): the committee corrected Bea's 2nd hole
 * after the round was closed, pressed Save, and read "Saved. Bea Fix —
 * already approved, so left unchanged" with the correction still on screen.
 * Nothing had been written; the board and the skins money were unchanged.
 */
describe("when approved cards are skipped", () => {
  it("says Not saved when the approved card was the only one", () => {
    const note = lockedSaveNote(["Bea Fix"], 0);
    expect(note).toMatch(/^Not saved/);
    expect(note).not.toMatch(/^Saved/);
    expect(note).toContain("Bea Fix is already approved");
    expect(note).toMatch(/reopen it below/);
  });

  it("says Saved only when another card on the screen was", () => {
    const note = lockedSaveNote(["Bea Fix"], 3);
    expect(note).toMatch(/^Saved — except Bea Fix/);
  });

  it("speaks of several cards in the plural", () => {
    expect(lockedSaveNote(["Ann", "Bea"], 0)).toBe(
      "Not saved — Ann, Bea are already approved. An organizer can reopen them below to correct them.",
    );
  });

  it("is what the entry screen says, with the count of cards it actually sent", () => {
    expect(readSource("src/components/StrokePlayEntry.tsx")).toMatch(
      /lockedSaveNote\(locked\.map\(named\), targets\.length - locked\.length\)/,
    );
  });
});
