import { describe, it, expect } from "vitest";
import { drawReadiness } from "@/lib/domain/draw-readiness";
import { ATTENDANCE_MODES, playersAnswer, tracksPerRound } from "@/lib/domain/attendance";
import { readSource } from "./source";

/**
 * The week's field, and the two ways it can be empty.
 *
 * A league tee sheet is drawn from the players who are IN for the round, and
 * `drawReadiness` was being handed that narrowed number while still reporting
 * it as an empty REGISTRATION list. So a society with six confirmed members and
 * nobody signed up for Tuesday read "Pairings cannot be drawn from an empty
 * field — nobody is entered yet" over a full roster, with a link to the one
 * screen where nothing was wrong.
 *
 * Under `captains` that was not an edge case, it was the whole mode. Every
 * player defaults to OUT and no staff writer existed anywhere in the app, so
 * the screen said it on every visit for ever and there was no move that would
 * have cleared it.
 */
describe("an empty week is not an empty field", () => {
  it("names the round, not the registration list, when the roster is full", () => {
    const block = drawReadiness({ fieldSize: 0, locked: false, rosterSize: 6 });
    expect(block?.problem).toMatch(/Nobody is in for this round/i);
    expect(block?.problem).toContain("6 are in the field for the season");
    // The exact sentence that was wrong. It must not come back for a league
    // week: an organizer sent to Registration finds every name already there.
    expect(block?.problem).not.toMatch(/nobody is entered yet/i);
  });

  it("sends nobody to Registration when the remedy is on this screen", () => {
    const block = drawReadiness({ fieldSize: 0, locked: false, rosterSize: 6 });
    expect(block?.href).toBe("");
    expect(block?.linkLabel).toBe("");
    // Same rule as sideDrawReadiness: with no href it has to name the control
    // instead, or the refusal explains nothing.
    expect(block?.problem).toMatch(/list above/i);
  });

  it("still blames the registration list when the roster really is empty", () => {
    const block = drawReadiness({ fieldSize: 0, locked: false, rosterSize: 0 });
    expect(block?.problem).toMatch(/nobody is entered yet/i);
    expect(block?.href).toBe("/registration");
  });

  it("treats a tournament — which never narrows its field — as it always did", () => {
    // No rosterSize at all: the flights screen draws from the roster itself, so
    // the two zeros there are one zero and the old wording is the right one.
    const block = drawReadiness({ fieldSize: 0, locked: false });
    expect(block?.problem).toMatch(/nobody is entered yet/i);
    expect(block?.href).toBe("/registration");
  });

  it("still puts the lock first, whatever the field looks like", () => {
    // One reason at a time, most fundamental first — a locked tournament
    // cannot act on "mark who is playing" either.
    const block = drawReadiness({ fieldSize: 0, locked: true, rosterSize: 6 });
    expect(block?.problem).toMatch(/locked/i);
  });

  it("says nothing at all once somebody is in", () => {
    expect(drawReadiness({ fieldSize: 4, locked: false, rosterSize: 6 })).toBeNull();
  });
});

/**
 * A mode nobody can answer is a mode that does not work.
 *
 * `setAttendance` has always let staff answer for anyone, at any time, and its
 * own comment says why. Nothing called it that way: the sole writer was the
 * player's own availability card. Two promises went unkept by the same
 * absence — the Rounds screen's "after it, changes go through you", and the
 * whole of `captains`, whose help text says the club enters the list its
 * captains send in.
 *
 * So this pins the WIRING rather than the behaviour. The behaviour was already
 * correct and had been for months; what was missing was a caller.
 */
describe("every mode that tracks attendance has somebody who can write it", () => {
  it("has a staff writer, and it is not the player's own card", () => {
    const week = readSource("src/components/WeekField.tsx");
    expect(week).toMatch(/setAttendance\(stageId, playerId, status\)/);
    // Staff-only: a player who reaches this screen has no business being
    // offered the field's whole list.
    expect(week).toMatch(/canEdit/);
  });

  it("is rendered by the screen that draws from it", () => {
    const page = readSource("src/app/(app)/foursomes/page.tsx");
    expect(page).toMatch(/<WeekField/);
    expect(page).toMatch(/canEdit=\{session\.role === "admin" \|\| session\.role === "assistant"\}/);
    // The roster size is what lets the refusal below tell the two zeros apart,
    // and it must only be passed when the field HAS been narrowed.
    expect(page).toMatch(/rosterSize=\{weekRows\.length > 0 \? state\.confirmed\.length : 0\}/);
  });

  it("opens itself in the modes where it is the only way in", () => {
    // Enumerated from the modes rather than hand-listed, so a mode added later
    // is covered the day it is added.
    const staffOnly = ATTENDANCE_MODES.filter((m) => tracksPerRound(m) && !playersAnswer(m));
    expect(staffOnly).toEqual(["captains"]);
    const week = readSource("src/components/WeekField.tsx");
    expect(week).toMatch(/useState\(!playersAnswer\(mode\)\)/);
  });
});
