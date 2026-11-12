import { describe, it, expect } from "vitest";
import {
  COMPLETED_TEE_SHEET,
  startedGroupsRefusal,
  teeSheetChangeAllowed,
  teeSheetChangeFactsOf,
  teeSheetChangedLine,
  teeSheetDoors,
  teeSheetStepOf,
  teeSheetWarnWords,
  toldCount,
  TEE_SHEET_CHANGES,
  type TeeSheetChangeAsk,
  type TeeSheetChangeFacts,
} from "../tee-sheet-change";
import type { TeeSheet } from "../tee-sheet";
import { round as roundOf } from "./tournament-facts-fixtures";

/**
 * THE TEE-SHEET RULE (J12, state machine PR 7c) — the proposal's section 3 row
 * and the main session's ruling of 12 Nov, written out by hand:
 *
 *   before the draw  open
 *   after the draw   open
 *   published        open, and SAID (players were sent their time; how many are told now)
 *   after scores     open — a round with scores does NOT shut its sheet; the groups that
 *                    have started are held by their own locks (`slotLocks`), the rest move
 *   completed        refuse, every change, the way out Reopen on the dashboard
 *
 * The matrix (`matrix.test.ts`, "an upstream edit to the tee sheet") walks every
 * round type × step × field size; this holds the words and the edges.
 */

const at = (over: Partial<TeeSheetChangeFacts["round"]> = {}, status = "live"): TeeSheetChangeFacts => ({
  status,
  round: { id: "r1", label: "Round 1", hasResult: false, teeSheetSaved: true, teeSheetPublished: false, ...over },
});
const group = (time: string, playerIds: string[], startHole = 1) => ({ name: "", startHole, half: "front" as const, time, playerIds });
const sheet = (...groups: ReturnType<typeof group>[]): TeeSheet => ({ savedAt: "t", startType: "tee-times", groups } as unknown as TeeSheet);

const ASKS: TeeSheetChangeAsk[] = [
  { kind: "save", publish: false },
  { kind: "save", publish: true },
  { kind: "publish" },
  { kind: "unpublish" },
  { kind: "place" },
  { kind: "move" },
  { kind: "replace" },
];

describe("the step is the round's, from its facts", () => {
  it("completed wins; then a result; then a saved sheet; else before the draw", () => {
    expect(teeSheetStepOf(at({}, "completed"))).toBe("completed");
    expect(teeSheetStepOf(at({ hasResult: true }, "completed"))).toBe("completed");
    expect(teeSheetStepOf(at({ hasResult: true }))).toBe("after-scores");
    expect(teeSheetStepOf(at({ teeSheetSaved: true }))).toBe("after-draw");
    expect(teeSheetStepOf(at({ teeSheetSaved: false }))).toBe("before-draw");
    expect(teeSheetStepOf(at({ teeSheetSaved: null }))).toBe("before-draw");
  });
});

describe("a completed tournament refuses every tee-sheet change, with the way out", () => {
  for (const ask of ASKS) {
    for (const published of [false, true]) {
      it(`${ask.kind}${"publish" in ask ? ` (publish ${ask.publish})` : ""}, sheet ${published ? "published" : "not published"}`, () => {
        const v = teeSheetChangeAllowed(at({ teeSheetPublished: published, hasResult: true }, "completed"), ask);
        expect(v).toEqual({ ok: false, scope: "teeSheet", step: "completed", says: COMPLETED_TEE_SHEET, wayOut: { says: "Reopen it on the dashboard", href: "/dashboard" } });
      });
    }
  }
  it("the sentence says what is true and what to do", () => {
    expect(COMPLETED_TEE_SHEET).toBe("The tournament is completed, so its tee sheets are final. An Organizer can reopen it on the dashboard.");
  });
});

describe("every other step is open, and a published sheet says so", () => {
  const WARN: Record<string, "told" | "hidden" | null> = {
    "save:false": "hidden",
    "save:true": "told",
    publish: null,
    unpublish: "hidden",
    place: "told",
    move: "told",
    replace: "told",
  };
  for (const status of ["draft", "live"]) {
    for (const round of [{ teeSheetSaved: false }, { teeSheetSaved: true }, { teeSheetSaved: true, hasResult: true }]) {
      for (const ask of ASKS) {
        for (const published of [false, true]) {
          it(`${status} · ${JSON.stringify(round)} · ${ask.kind}${"publish" in ask ? ` ${ask.publish}` : ""} · ${published ? "published" : "draft"}`, () => {
            const v = teeSheetChangeAllowed(at({ ...round, teeSheetPublished: published }, status), ask);
            expect(v.ok).toBe(true);
            if (!v.ok) return;
            const key = ask.kind === "save" ? `save:${ask.publish}` : ask.kind;
            expect(v.warn, "warned only where players were already sent the sheet").toBe(published ? WARN[key] : null);
            // The groups decide in a round with scores, for a change that touches groups; never for the announcement itself.
            const touches = ask.kind !== "publish" && ask.kind !== "unpublish";
            expect(v.groupsDecide).toBe(!!round.hasResult && touches);
          });
        }
      }
    }
  }
});

describe("what is said after a change to a published sheet", () => {
  it("names how many players have been told, singular and plural", () => {
    expect(teeSheetWarnWords("told", 1)).toBe("Players were already sent their times. 1 player has been told of the change.");
    expect(teeSheetWarnWords("told", 3)).toBe("Players were already sent their times. 3 players have been told of the change.");
  });
  it("says so when nobody is told, and when the sheet is hidden", () => {
    expect(teeSheetWarnWords("told", 0)).toBe("Players were already sent their times. Nobody’s time or start hole moved, so nobody is told.");
    expect(teeSheetWarnWords("hidden", 0)).toBe("Players were already sent their times. The sheet is now hidden from them, and nobody is told.");
  });
  it("never says locked where something is still allowed", () => {
    for (const w of [teeSheetWarnWords("told", 2), teeSheetWarnWords("hidden", 0), teeSheetWarnWords("told", 0)]) expect(w).not.toMatch(/lock/i);
  });
  it("the Recent changes line holds a count and no name", () => {
    expect(teeSheetChangedLine("Round 1", 3)).toBe("Round 1 tee sheet changed after publish: 3 players re-told.");
    expect(teeSheetChangedLine("", 1)).toBe("The tee sheet changed after publish: 1 player re-told.");
  });
});

describe("the count is the notice's own diff", () => {
  const before = sheet(group("08:00", ["a", "b", "c", "d"]), group("08:10", ["e", "f"]));
  it("moving one player to a group at another time tells that player and nobody else", () => {
    const after = sheet(group("08:00", ["a", "b", "c"]), group("08:10", ["e", "f", "d"]));
    expect(toldCount(before, after)).toBe(1);
  });
  it("saving the same sheet again tells nobody", () => {
    expect(toldCount(before, sheet(group("08:00", ["a", "b", "c", "d"]), group("08:10", ["e", "f"])))).toBe(0);
  });
  it("a new player on the sheet is told their time", () => {
    expect(toldCount(before, sheet(group("08:00", ["a", "b", "c", "d"]), group("08:10", ["e", "f", "g"])))).toBe(1);
  });
});

describe("a re-draw of a round with scores keeps the groups that have started", () => {
  const before = sheet(group("07:30", ["a", "b", "c", "d"]), group("07:40", ["e", "f"]), group("07:50", ["g", "h"]));
  const locks = { 0: "Group 1 teed off at 07:30." };
  it("is refused, in words, when a started group was changed", () => {
    const after = sheet(group("07:30", ["a", "b", "c", "e"]), group("07:40", ["d", "f"]), group("07:50", ["g", "h"]));
    expect(startedGroupsRefusal(before, after, locks)).toBe("Group 1 teed off at 07:30. Its players, time and hole stay as they are. Change the groups that have not started.");
  });
  it("is allowed when only the groups that have not started changed, wherever they sit", () => {
    const after = sheet(group("07:50", ["g", "f"]), group("07:30", ["a", "b", "c", "d"]), group("07:40", ["e", "h"]));
    expect(startedGroupsRefusal(before, after, locks)).toBeNull();
  });
  it("a started group moved to another time is a change", () => {
    expect(startedGroupsRefusal(before, sheet(group("07:35", ["a", "b", "c", "d"]), group("07:40", ["e", "f"]), group("07:50", ["g", "h"])), locks)).not.toBeNull();
  });
  it("nobody started, nothing is held", () => {
    expect(startedGroupsRefusal(before, sheet(group("08:00", ["a"])), {})).toBeNull();
  });
});

describe("the doors a screen draws from", () => {
  it("are all open except in a completed tournament, where every one says the same sentence", () => {
    for (const door of Object.values(teeSheetDoors(at({ teeSheetPublished: true, hasResult: true })))) expect(door).toBeNull();
    const shut = teeSheetDoors(at({}, "completed"));
    expect(Object.keys(shut).sort()).toEqual([...TEE_SHEET_CHANGES].sort());
    for (const door of Object.values(shut)) expect(door).toBe(COMPLETED_TEE_SHEET);
  });
  it("the facts are the state machine's round, or nothing for a round that is not in it", () => {
    const r = roundOf({ id: "r9", position: 0, label: "Round 9", teeSheetSaved: true, teeSheetPublished: true, hasResult: false });
    const f = teeSheetChangeFactsOf({ status: "live", rounds: [r] }, "r9");
    expect(f?.round.teeSheetPublished).toBe(true);
    expect(teeSheetChangeFactsOf({ status: "live", rounds: [r] }, "nope")).toBeNull();
  });
});
