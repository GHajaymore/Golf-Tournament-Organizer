import { describe, it, expect } from "vitest";
import { PLAYER_HELP_TOPICS, helpLineLabels, helpLineText } from "../player-help";
import { ALL_PLAYER_SCREENS, PLAYER_HELP } from "../player-nav";
import { readSource } from "./source";

/**
 * THE PLAYER'S HELP STAYS TRUE (Ajay, 2026-10-10).
 *
 * "Keep a step when there is any change in the app to update the help
 * section." A written page goes stale silently, so three of the ways it can go
 * stale are made loud here:
 *
 *   a new player screen with no help      -> every screen is a topic's subject
 *   a renamed button the help still names -> every [[label]] is on its screen
 *   a paragraph where a line should be    -> every line is short
 *
 * What these cannot catch is a flow that now works differently under the same
 * button names. That part is the author's: change `player-help.ts` in the same
 * pull request as the change.
 */

/** Where each button the help names is drawn. A new [[label]] must be added here. */
const LABEL_SOURCE: Record<string, string> = {
  "Enter this tournament": "src/components/EnterButton.tsx",
  "Join the waiting list": "src/components/EnterButton.tsx",
  "Full card": "src/components/PlayerCard.tsx",
  "Certify my card": "src/components/PlayerCard.tsx",
  "Something on this card is wrong": "src/components/PlayerCard.tsx",
  "Can’t make it? Withdraw": "src/components/WithdrawButton.tsx",
  "Play a casual round": "src/app/(player)/me/events/page.tsx",
  "Sign out everywhere": "src/app/account/page.tsx",
  "Report the result": "src/components/ReportTie.tsx",
  "Print the draw": "src/components/BracketClient.tsx",
  "Score this match": "src/app/(player)/me/page.tsx",
  "Halved": "src/components/HoleResultCard.tsx",
};

/** JSX writes an apostrophe as an entity; read the screen the way it renders. */
const rendered = (file: string) => readSource(file).replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
const words = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe("the player's help", () => {
  it("covers every player screen, so a new one cannot ship without a word of help", () => {
    const covered = new Set(PLAYER_HELP_TOPICS.map((t) => t.href));
    const missing = ALL_PLAYER_SCREENS.filter((s) => s.href !== PLAYER_HELP.href && !covered.has(s.href)).map((s) => s.href);
    expect(missing, "player screens with no help topic").toEqual([]);
  });

  it("points only at screens a player really has", () => {
    const real = new Set(ALL_PLAYER_SCREENS.map((s) => s.href));
    expect(PLAYER_HELP_TOPICS.filter((t) => !real.has(t.href)).map((t) => t.id)).toEqual([]);
  });

  it("names only buttons its screens really draw", () => {
    const named = [...new Set(PLAYER_HELP_TOPICS.flatMap((t) => t.steps.flatMap(helpLineLabels)))];
    expect(named.length, "the help names real controls at all").toBeGreaterThan(4);
    for (const label of named) {
      const file = LABEL_SOURCE[label];
      expect(file, `"${label}" is named in the help but not listed in LABEL_SOURCE`).toBeTruthy();
      expect(rendered(file), `${file} no longer draws "${label}"`).toContain(label);
    }
  });

  it("CONTROL: a label no screen draws is caught", () => {
    expect(rendered("src/components/PlayerCard.tsx")).not.toContain("Sign and send my card now");
  });

  it("is written in short lines — under twelve words a sentence, as the player app is", () => {
    const long = PLAYER_HELP_TOPICS.flatMap((t) =>
      [t.question, ...t.steps]
        .flatMap((line) => helpLineText(line).split(/(?<=[.!?])\s+/))
        .filter((sentence) => words(sentence) >= 12),
    );
    expect(long).toEqual([]);
  });

  it("gives every topic an id of its own and something to do", () => {
    const ids = PLAYER_HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PLAYER_HELP_TOPICS) expect(t.steps.length, t.id).toBeGreaterThanOrEqual(2);
  });
});
