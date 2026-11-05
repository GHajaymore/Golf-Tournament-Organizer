import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";
import { cleanSettings } from "../tournament-settings";
import { entryRefusalFor, playerEntryRefusal, playersMayEnter, ORGANIZER_KEEPS_THIS_ROUND } from "../domain/round-scoring";

/**
 * EVERY SCORE GATE ASKS THE ROUND (2026-11-04, sprint 2 part B).
 *
 * "Who enters scores" is now per round: "Organizer only (paper cards)" on one
 * round refuses players there, while the tournament's own "staff" setting
 * still refuses them everywhere. `canEnterScores(settings, "player")` asks the
 * TOURNAMENT and never the round, so a door still asking it lets a player
 * write a round the organizer keeps from paper cards.
 *
 * The one gate is `playerEntryRefusal(settings, stage)` in
 * domain/round-scoring.ts (`playersMayEnter` is its yes/no, `entryRefusalFor`
 * its form for a caller whose role is in question). Two sweeps:
 *   1. nowhere in the app asks the tournament-only question as a player;
 *   2. the files that WRITE or OFFER a round's scores to a player do not ask
 *      `canEnterScores` at all.
 * With a control that proves the sweep sees a bare call.
 */

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const BARE = /canEnterScores\(\s*[\w.()]+\s*,\s*["']player["']\s*\)/;
export const asksTheTournamentAsAPlayer = (src: string) => BARE.test(stripComments(src));

/** The files that write a round's scores for a player, or offer a player the card. */
const ROUND_DOORS = [
  "src/app/actions/play.ts",
  "src/app/actions/tournament.ts",
  "src/app/actions/courses.ts",
  "src/app/(player)/me/card/page.tsx",
  "src/app/(player)/me/match/page.tsx",
  "src/lib/services/me.ts",
  // The round-code screen, moved onto the one gate by phase 2 (2026-11-05).
  "src/app/play/page.tsx",
];

describe("every gate on a player's scores asks the round", () => {
  it("nothing asks the tournament-only question as a player", () => {
    const offenders = filesUnder("src").filter((f) => asksTheTournamentAsAPlayer(readSource(f)));
    expect(offenders, "ask playersMayEnter / playerEntryRefusal(settings, stage) instead").toEqual([]);
  });

  it.each(ROUND_DOORS)("%s asks the one gate, never canEnterScores", (file) => {
    const src = readSource(file);
    expect(src, `${file} still asks the tournament alone`).not.toMatch(/canEnterScores\(/);
    expect(src).toMatch(/\b(playersMayEnter|playerEntryRefusal|entryRefusalFor|entryRefusal|playerRoundRefusal)\(/);
  });


  it("CONTROL: the sweep sees a bare call, in either spelling, and not one in a comment", () => {
    expect(asksTheTournamentAsAPlayer(`if (!canEnterScores(settings, "player")) return;`)).toBe(true);
    expect(asksTheTournamentAsAPlayer(`canEnterScores(settingsOf(event), 'player')`)).toBe(true);
    expect(asksTheTournamentAsAPlayer(`// canEnterScores(settings, "player") was the old gate`)).toBe(false);
    expect(asksTheTournamentAsAPlayer(`canEnterScores(settings, session.role)`)).toBe(false);
  });
});

describe("the gate itself", () => {
  const s = (scoreEntryBy: string) => cleanSettings({ scoreEntryBy });
  const round = (scoreKeeping: string) => ({ scoreKeeping, endCheck: "off" });

  it("the tournament's 'staff' setting wins over any round", () => {
    for (const k of ["group", "each", "organizer"]) expect(playersMayEnter(s("staff"), round(k)), k).toBe(false);
  });

  it("where players enter, only a round kept from paper cards refuses them", () => {
    expect(playersMayEnter(s("players"), round("group"))).toBe(true);
    expect(playersMayEnter(s("players"), round("each"))).toBe(true);
    expect(playerEntryRefusal(s("players"), round("organizer"))).toBe(ORGANIZER_KEEPS_THIS_ROUND);
    // An unknown stored value reads as "each" — today's behaviour, never a refusal.
    expect(playersMayEnter(s("players"), round("nonsense"))).toBe(true);
  });

  it("staff always enter — paper cards are theirs to type in", () => {
    for (const role of ["admin", "assistant"]) {
      expect(entryRefusalFor(s("staff"), role, round("organizer")), role).toBeNull();
    }
    expect(entryRefusalFor(s("players"), "player", round("organizer"))).toBe(ORGANIZER_KEEPS_THIS_ROUND);
  });
});
