import { describe, it, expect } from "vitest";
import { snapshotStanding } from "../domain/lifecycle-state";
import { readSource } from "./source";

/**
 * A PRINTED STANDINGS SHEET MAY NOT CALL ITSELF FINAL UNTIL IT IS.
 *
 * `/reports` titled its printable panel "Final standings snapshot" — a
 * constant, with nothing behind the word. Read off the demo tournament on
 * 2026-09-12: status DRAFT, seven of thirty-three cards in, thirty-six match
 * results unconfirmed, twenty-six rows of the printed table reading "—". It
 * said Final.
 *
 * This is the screen whose own header comment calls it "the one whose output
 * gets printed and pinned up". A wrong figure on a screen is fixed by a
 * refresh; a wrong figure on a noticeboard at prizegiving is argued about.
 *
 * THE TEST IS "CAN IT STILL CHANGE", NOT "HAS ENOUGH HAPPENED" — the same
 * distinction `money-layout.ts` opens with, for the same reason. Every card in
 * for round one of three is not a final anything.
 */

const at = (over: Partial<Parameters<typeof snapshotStanding>[0]> = {}) =>
  snapshotStanding({ status: "live", done: 7, total: 33, unit: "cards", ...over });

describe("what the sheet is allowed to claim", () => {
  it("says Final only once the organizer has closed the tournament", () => {
    /**
     * The status is the ONE signal a score arriving early cannot produce.
     * `lifecycleMismatch` in the same file exists precisely because this app
     * reports the lifecycle rather than correcting it — so closing it is a
     * decision somebody made, which is what the word Final is claiming.
     */
    expect(at({ status: "completed", done: 33, total: 33 }).title).toBe("Final standings");
    expect(at({ status: "completed", done: 33, total: 33 }).note).toBe("");
  });

  it("refuses the word on every state that is not closed", () => {
    // A sweep rather than a case, so a status added later cannot quietly
    // acquire the claim by not being mentioned here.
    for (const status of ["draft", "registration", "ready", "live"]) {
      expect(at({ status }).title, status).not.toMatch(/final/i);
      expect(at({ status }).note, status).not.toBe("");
    }
  });

  it("refuses it even with every card in, while the tournament is open", () => {
    /**
     * THE CASE THAT SEPARATES THE TWO QUESTIONS, and the one a "has enough
     * happened" rule gets wrong. Round one of three can be complete to the
     * last card and the standings are still going to move.
     */
    const full = at({ status: "live", done: 33, total: 33 });
    expect(full.title).not.toMatch(/final/i);
    expect(full.note).toMatch(/not been closed/i);
    // And it does NOT claim cards are missing, which would be its own untruth.
    expect(full.note).not.toMatch(/33 of 33/);
  });

  it("counts what is in, because a word alone is discountable", () => {
    /**
     * "Provisional" is a word a reader skips. "7 of 33 cards in" is not, and it
     * is the difference between a sheet somebody checks and a sheet somebody
     * believes.
     */
    expect(at({ done: 7, total: 33, unit: "cards" }).note).toContain("7 of 33 cards in");
    expect(at({ done: 12, total: 24, unit: "matches" }).note).toContain("12 of 24 matches in");
  });

  it("says nothing is in rather than printing a zero over a table of dashes", () => {
    // "0 of 33 cards in" under thirty-three empty rows reads as a broken
    // export. It is an empty one.
    expect(at({ done: 0, total: 33 }).note).toMatch(/nothing returned/i);
    expect(at({ done: 0, total: 33 }).note).not.toMatch(/0 of 33/);
    // And a round the app cannot measure at all takes the same sentence rather
    // than dividing by nothing.
    expect(at({ done: 0, total: 0 }).note).toMatch(/nothing returned/i);
  });

  it("keeps a team round's own noun", () => {
    // "Final standings" is wrong about a side the same way "Final" is wrong
    // about the day — the noun was already separate and stays separate.
    expect(at({ status: "completed", noun: "team standings" }).title).toBe("Final team standings");
    expect(at({ status: "live", noun: "team standings" }).title).toBe("Team standings so far");
  });
});

describe("where the reports screen puts it", () => {
  const page = () => readSource("src", "app", "(app)", "reports", "page.tsx");

  it("has no hard-coded claim of finality left", () => {
    /**
     * The mutation this is shaped to catch is the easy one: somebody restores
     * the constant because it reads better. Read through `readSource`, which
     * strips comments — the prose above the call quotes the old string and
     * would otherwise satisfy a naive search for its absence.
     */
    expect(page(), "the constant is back").not.toContain("Final standings snapshot");
    expect(page()).toContain("snapshotStanding(");
  });

  it("prints the qualifier on the sheet, not only on the screen around it", () => {
    /**
     * The half that matters. The panel is what gets printed and pinned up, and
     * a reader standing in front of it cannot ask whether the round had
     * finished — so the note has to travel with the table, not sit beside the
     * Print button in the page chrome.
     */
    expect(page()).toContain("snapshotNote={standing.note}");
    const client = readSource("src", "components", "ReportsClient.tsx");
    expect(client).toContain("snapshotNote");
    // Inside the printable panel: after the title it captions, and before the
    // board it describes.
    expect(client.indexOf("{snapshotNote}")).toBeGreaterThan(client.indexOf("{snapshotTitle}"));
    expect(client.indexOf("{snapshotNote}")).toBeLessThan(client.indexOf("<LeaderboardTable"));
  });
});
