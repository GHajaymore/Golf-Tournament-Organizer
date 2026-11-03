import { describe, it, expect } from "vitest";
import { canEnterScores, cleanSettings, SCORE_ENTRY_BY } from "../tournament-settings";
import { readSource } from "./source";

/**
 * A CARD THE CLUB KEEPS OFFERS THE PLAYER NOTHING TO PRESS (2026-10-24).
 *
 * Under "Who enters scores: Organizers and assistants only" every save the
 * round-code surface makes is refused by the server, and `/play` drew the
 * card's score buttons anyway: a player tapped a hole and was told afterwards
 * that the card would not save. A refusal is said where the press was — and a
 * press that is certain to be refused is not offered at all.
 *
 * One rule, one place. `canEnterScores` is the predicate; this file holds
 *   1. what it answers, on the whole of the setting's list;
 *   2. that the server's refusal on `/play` is that predicate, asked as a player;
 *   3. that the page asks the SAME predicate, as a player, before it draws any
 *      card or match — so the screen and the server cannot disagree.
 * The browser half is `e2e/staff-kept-cards.spec.ts`.
 */

const settings = (scoreEntryBy: string) => cleanSettings({ scoreEntryBy });

describe("the predicate: may a player keep their own card?", () => {
  it("no, when the club keeps the cards; yes, when players enter their own", () => {
    expect(canEnterScores(settings("staff"), "player")).toBe(false);
    expect(canEnterScores(settings("players"), "player")).toBe(true);
  });

  it("staff may always enter, whichever is chosen", () => {
    for (const by of SCORE_ENTRY_BY) {
      expect(canEnterScores(settings(by), "admin"), by).toBe(true);
      expect(canEnterScores(settings(by), "assistant"), by).toBe(true);
    }
  });

  it("the setting's list is the two values this file reasons about", () => {
    // A third value would need its own answer here, not a silent default.
    expect([...SCORE_ENTRY_BY].sort()).toEqual(["players", "staff"]);
  });
});

const play = readSource("src/app/actions/play.ts");
const page = readSource("src/app/play/page.tsx");

/** The body of each exported action in actions/play.ts, by name. */
function actionBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = src.split("export async function ").slice(1);
  for (const part of parts) out.set(part.slice(0, part.indexOf("(")), part);
  return out;
}

const WRITERS = ["savePlayMatchHoles", "savePlayMatchResult", "savePlayCard", "certifyPlayCard", "savePlayMatchCard"];

describe("the server refuses by that predicate", () => {
  const bodies = actionBodies(play);

  it("finds the writers it asserts on", () => {
    for (const name of WRITERS) expect(bodies.has(name), name).toBe(true);
  });

  it("every writer on /play refuses a player through canEnterScores, imported from the one module", () => {
    expect(play).toContain('canEnterScores } from "@/lib/tournament-settings"');
    for (const name of WRITERS) {
      const body = bodies.get(name)!;
      expect(body, name).toMatch(/if \(!canEnterScores\(settings(Of\(event\))?, "player"\)\) \{/);
      expect(body, name).toContain("entered by the organizer");
    }
  });
});

describe("the page asks the same predicate before it offers a button", () => {
  it("imports canEnterScores from the module the server does", () => {
    expect(page).toMatch(/import \{[^}]*canEnterScores[^}]*\} from "@\/lib\/tournament-settings"/);
  });

  it("asks it as a player, and draws the club-kept screen when it says no", () => {
    const gate = page.indexOf('if (!canEnterScores(settings, "player")) {');
    expect(gate, "the page does not ask the server's question").toBeGreaterThan(-1);
    const kept = page.indexOf('stage="staff-kept"', gate);
    expect(kept, "the answer does not draw the club-kept screen").toBeGreaterThan(gate);
    // Inside the gate's own block: the first return after it is the club-kept one.
    expect(page.indexOf("return", gate)).toBeLessThan(kept);
    expect(page.indexOf("<PlayClient", gate)).toBeLessThan(kept);
  });

  it("asks it before ANY screen with score buttons is drawn", () => {
    const gate = page.indexOf('if (!canEnterScores(settings, "player")) {');
    for (const stage of ['stage="card"', 'stage="score"']) {
      const at = page.indexOf(stage);
      expect(at, `${stage} is not on the page`).toBeGreaterThan(-1);
      expect(at, `${stage} is drawn before the page asks`).toBeGreaterThan(gate);
    }
  });
});
