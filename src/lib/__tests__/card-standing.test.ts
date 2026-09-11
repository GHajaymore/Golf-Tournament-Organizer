import { describe, it, expect } from "vitest";
import { cardStanding, certifyPrompt, certifiedNote } from "@/lib/domain/card-approval";
import { readSource } from "./source";

/**
 * THE COMMITTEE THAT IS NOT COMING.
 *
 * A player reads about their own card in three places — the status line on
 * /me, the note the moment they sign on /me/card, and the sentence under
 * Certify on /play — and all three said a signed card was "with the
 * committee". Hard-coded, all three.
 *
 * That is false for any round the club has set to player confirmation, and
 * most of all for a casual round, which `createMatch` sets that way and
 * explains in its own words: "there is no committee to approve a card that
 * both players just agreed on standing on the 18th green."
 *
 * And it is not a sentence read once. `certifyCard` writes "certified"
 * whatever the setting says, and the only two paths to "approved" are staff
 * actions — `allowsAutoConfirm` governs MATCH confirmation, not scorecards —
 * so the card STOPS at certified. Two people on a Sunday were told they were
 * waiting for a committee, in the colour this screen uses for unfinished, for
 * as long as the round existed, with a "Finish my card" button underneath it.
 */
describe("what a player is told about their own signed card", () => {
  it("names the committee where there really is one", () => {
    const s = cardStanding("certified", true);
    expect(s.label).toContain("committee");
    // Waiting, because it genuinely is.
    expect(s.tone).toBe("waiting");
  });

  it("does not invent one where there is not", () => {
    const s = cardStanding("certified", false);
    expect(s.label).not.toContain("committee");
    /**
     * And DONE, not waiting. The tone is the half a player reads without
     * reading — grey next to "0 of 18 holes in" says unfinished, and this card
     * is as finished as it is ever going to get.
     */
    expect(s.tone).toBe("done");
  });

  it("stops offering to finish a card that is signed and whole", () => {
    // The loudest half of the same untruth: a primary button reading "Finish
    // my card" under a complete, certified card. There is nothing to finish.
    expect(cardStanding("certified", false).action).not.toBe("Finish my card");
    expect(cardStanding("certified", true).action).not.toBe("Finish my card");
    // But it is still reachable — a player may want to look at what they signed.
    expect(cardStanding("certified", false).action).toBeTruthy();
  });

  it("still asks for the holes when the card is short", () => {
    for (const staff of [true, false]) {
      const s = cardStanding("entered", staff);
      expect(s.action).toBe("Finish my card");
      expect(s.tone).toBe("waiting");
    }
  });

  it("leaves an approved card alone, under either setting", () => {
    for (const staff of [true, false]) {
      const s = cardStanding("approved", staff);
      expect(s.label).toBe("Approved");
      expect(s.tone).toBe("done");
      // No button at all: `isCardLocked` refuses every write to this row, so
      // a link to the editor is a door into a refusal.
      expect(s.action).toBe("");
    }
  });

  it("keeps a disputed card loud, and does not call it unfinished", () => {
    for (const staff of [true, false]) {
      const s = cardStanding("disputed", staff);
      expect(s.tone).toBe("problem");
      // Somebody says this card is wrong; every hole may already be on it.
      expect(s.action).not.toBe("Finish my card");
    }
  });

  it("treats an unknown status as the unfinished one", () => {
    // The old map fell back to `entered` and that is the right direction: a
    // status this build does not recognise must not be reported as done.
    const s = cardStanding("", true);
    expect(s.tone).toBe("waiting");
    expect(s.action).toBe("Finish my card");
  });
});

describe("the sentence under the Certify button", () => {
  it("asks for the whole card first, whoever is going to accept it", () => {
    for (const staff of [true, false]) {
      expect(certifyPrompt(false, 18, staff)).toContain("all 18 holes");
      expect(certifyPrompt(false, 9, staff)).toContain("all 9 holes");
      // Nothing about a committee until there is a card to give one.
      expect(certifyPrompt(false, 18, staff)).not.toContain("committee");
    }
  });

  it("promises the review only where one is coming", () => {
    expect(certifyPrompt(true, 18, true)).toContain("committee");
    expect(certifyPrompt(true, 18, false)).not.toContain("committee");
    // And says what DOES happen instead, rather than going quiet — a player
    // who signs and is told nothing assumes they are still waiting.
    expect(certifyPrompt(true, 18, false)).toMatch(/nobody else has to accept it/);
  });
});

describe("the note the moment a card is signed", () => {
  it("hands it over only when there is somebody to hand it to", () => {
    expect(certifiedNote(true)).toContain("committee");
    expect(certifiedNote(false)).not.toContain("committee");
    expect(certifiedNote(false)).toMatch(/that's your card/i);
  });
});

/**
 * And every screen has to actually ASK.
 *
 * The pure tests above hand the flag in, so they cannot see a page that never
 * reads the setting — in which case the default decides, on every round, and
 * the whole thing is decoration. Three separate screens got this wrong
 * independently, which is the argument for checking all three.
 */
describe("where the answer comes from", () => {
  it("is the round's own setting on the player's home screen", () => {
    const me = readSource("src", "app", "(player)", "me", "page.tsx");
    expect(me).toMatch(/cardStanding\(/);
    expect(me).toMatch(/allowsAutoConfirm\(settingsOf\(state\.event\)\)/);
    /**
     * And the hard-coded map is GONE, not merely unused. A second source of
     * this wording sitting in the file is how it comes back — the sentence on
     * /play was fixed while an identical copy in PlayerCard went on saying the
     * old thing, which is this exact failure, one week old.
     */
    expect(me).not.toMatch(/with the committee/);
  });

  it("is the round's own setting on the card the player signs", () => {
    const page = readSource("src", "app", "(player)", "me", "card", "page.tsx");
    expect(page).toMatch(/staffApproves=\{!allowsAutoConfirm\(settings\)\}/);
  });

  it("is asked once, by both cards, rather than written out twice", () => {
    // `certifyCard`'s own comment: "the doors into this row cannot drift apart
    // again". There are two screens a player can sign on and they had the
    // sentence copied.
    for (const f of ["src/components/PlayerCard.tsx", "src/components/PlayClient.tsx"]) {
      const src = readSource(f);
      expect(src).toMatch(/certifyPrompt\(/);
      expect(src).not.toMatch(/The committee accepts it after that/);
    }
    expect(readSource("src/components/PlayerCard.tsx")).toMatch(/certifiedNote\(staffApproves\)/);
  });
});
