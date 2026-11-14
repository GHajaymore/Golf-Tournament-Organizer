import { describe, it, expect } from "vitest";
import {
  CONSOLE_MERGES,
  DOOR_JOBS,
  MERGE_KEYS,
  MOVES,
  NO_MERGES,
  mergeStateRefusals,
  mergesShown,
  relocate,
  unhousedJobs,
  type MergeKey,
  type MergeState,
  type Move,
} from "../domain/console-merges";
import { NAV } from "../nav";
import { ROLES } from "../roles";
import { JOB_SCREENS } from "../domain/needs-you-now";
import { SETUP_ORDER } from "../domain/setup-flow";

/**
 * STEP 3's SWITCH AND ITS ONE MAP FROM OLD DOORS TO NEW ROOMS (the design of 13 Nov, amended 14 Nov,
 * §7; the QA Director's test plan, PR 0). Four promises:
 *
 *   off is today       no query, or the preview's alone while every merge is building: nothing shows,
 *                      and every address the app makes is the one it made before
 *   building is never  `&build=1` shows a half-built merge to the engineer — never in production
 *   production
 *   on needs the       a merge may be "on" only while the stepper itself is on
 *   stepper
 *   a door moves only  every job a door holds today has a home among the merges shown, or the door
 *   when its jobs have does not move (the bracket for staff waits for the draw, not only the board)
 *   moved
 *
 * Pure. Every name is invented.
 */

const ALL: ReadonlySet<MergeKey> = new Set(MERGE_KEYS);
/** Every combination of the five merges: 32 sets. */
const SUBSETS: ReadonlySet<MergeKey>[] = Array.from({ length: 1 << MERGE_KEYS.length }, (_, n) => new Set(MERGE_KEYS.filter((_, i) => (n & (1 << i)) !== 0)));
const statesAll = (state: MergeState) => Object.fromEntries(MERGE_KEYS.map((k) => [k, state])) as Record<MergeKey, MergeState>;

/** Every address the machine and the menus make today, with the queries and places links carry. */
const MACHINE_HREFS: string[] = (() => {
  const bases = [...new Set([...NAV.flatMap((s) => s.items.map((i) => i.href)), ...JOB_SCREENS, ...SETUP_ORDER, "/event#courses", "/event?course=c1", "/organization#access"])];
  const tails = ["", "?round=r2", "?round=r2&stepper=1", "#results", "?tie=t1#ties"];
  return bases.flatMap((b) => tails.map((t) => (b.includes("?") || b.includes("#") ? b : b + t)));
})();

/**
 * A table as the series will have it when every room is built (design §1, §3, §5, §6), for the
 * controls below: what PR 0 checks must be able to see a door move. Not the app's table — `MOVES`
 * stays empty until a room exists.
 */
const EVERY_DOOR_MOVED: readonly Move[] = [
  { from: "/week", roles: ["admin", "assistant", "player"], homes: { "read-the-week": "boards" }, to: (l) => `/leaderboard?view=week${l.href.includes("round=") ? "&" + l.href.split("?")[1] : ""}` },
  { from: "/bracket", roles: ["player"], homes: { "read-the-bracket": "boards" }, to: () => "/leaderboard?view=bracket" },
  {
    from: "/bracket",
    roles: ["admin", "assistant"],
    homes: { "read-the-bracket": "boards", "arrange-the-knockout": "draw", "record-a-knockout-result": "draw", "approve-a-reported-result": "draw" },
    to: () => "/foursomes?round=ko",
  },
  { from: "/access", roles: ["admin"], homes: { "manage-this-events-helpers": "staff" }, to: () => "/organization#access" },
  { from: "/event#courses", roles: ["admin"], homes: { "keep-the-clubs-courses": "courses", "pick-this-events-course": "courses" }, to: () => "/courses" },
  { from: "/stages", roles: ["admin", "assistant"], job: "draw", homes: { "draw-a-round": "draw" }, to: (l) => `/foursomes?round=${l.roundId}` },
];

describe("which merges show", () => {
  it("switched off as shipped: nothing shows without a query, nor with the preview's alone", () => {
    expect(mergesShown("", "preview")).toBe(NO_MERGES);
    expect(mergesShown("?stepper=1", "preview").size).toBe(0);
    expect(mergesShown("?round=r1&view=timeline", "preview").size).toBe(0);
    // Every merge is building until its series has landed.
    expect(Object.values(CONSOLE_MERGES)).toEqual(MERGE_KEYS.map(() => "building"));
  });

  it("building shows only with the engineer's query beside the preview's", () => {
    expect([...mergesShown("?stepper=1&build=1", "preview")].sort()).toEqual([...MERGE_KEYS].sort());
    expect([...mergesShown("?build=1", "preview")]).toEqual([]);
    expect([...mergesShown("?stepper=1&build=1", undefined)].sort()).toEqual([...MERGE_KEYS].sort());
  });

  it("building is NEVER shown in production, whatever the query (Hard rule 1)", () => {
    expect(mergesShown("?stepper=1&build=1", "production").size).toBe(0);
    // CONTROL: the same query outside production shows them, so the refusal is production's alone.
    expect(mergesShown("?stepper=1&build=1", "preview").size).toBe(MERGE_KEYS.length);
    // A merge Ajay previews IS shown in production behind the preview's query — that is the preview.
    expect([...mergesShown("?stepper=1", "production", { ...statesAll("building"), boards: "preview" })]).toEqual(["boards"]);
  });

  it("each state is drawn where it says", () => {
    const states: Record<MergeKey, MergeState> = { draw: "building", boards: "preview", money: "on", staff: "building", courses: "preview" };
    expect([...mergesShown("", "preview", states, true)]).toEqual(["money"]);
    expect([...mergesShown("?stepper=1", "preview", states, true)].sort()).toEqual(["boards", "courses", "money"]);
    expect([...mergesShown("?stepper=1&build=1", "preview", states, true)].sort()).toEqual([...MERGE_KEYS].sort());
  });

  it("no merge is on while the stepper is off — and one left on by mistake reaches nobody without the preview's query", () => {
    expect(mergeStateRefusals()).toEqual([]);
    // CONTROL: a key switched on alone is refused; with the stepper on it may stand.
    expect(mergeStateRefusals({ ...statesAll("building"), draw: "on" }, false)).toEqual(["draw"]);
    expect(mergeStateRefusals({ ...statesAll("building"), draw: "on" }, true)).toEqual([]);
    const mistaken = { ...statesAll("building"), draw: "on" as const };
    expect(mergesShown("", "production", mistaken, false).size).toBe(0);
    expect([...mergesShown("?stepper=1", "production", mistaken, false)]).toEqual(["draw"]);
  });
});

describe("relocate: the one map from old doors to new rooms", () => {
  it("switched off it is the identity, for every address the app makes, every role and every job", () => {
    let checked = 0;
    for (const href of MACHINE_HREFS) {
      for (const role of ROLES) {
        for (const job of [undefined, "draw", "knockouts", "lineup", "tee-sheet"]) {
          expect(relocate({ href, role, job, roundId: "r2" }, NO_MERGES)).toBe(href);
          // Off means off even with rows in the table: nothing moves while nothing shows.
          expect(relocate({ href, role, job }, NO_MERGES, EVERY_DOOR_MOVED)).toBe(href);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("PR 0 builds no room: with every merge shown, still no door moves", () => {
    expect(MOVES).toEqual([]);
    for (const shown of SUBSETS) for (const href of MACHINE_HREFS) for (const role of ROLES) expect(relocate({ href, role }, shown)).toBe(href);
  });

  it("CONTROL: with a row in the table and its merges shown, the door does move — so the identity above is not the function failing to look", () => {
    expect(relocate({ href: "/week?round=r2", role: "player" }, ALL, EVERY_DOOR_MOVED)).toBe("/leaderboard?view=week&round=r2");
    expect(relocate({ href: "/event#courses", role: "admin" }, ALL, EVERY_DOOR_MOVED)).toBe("/courses");
    // A place on a screen is its own door: the screen itself does not move.
    expect(relocate({ href: "/event", role: "admin" }, ALL, EVERY_DOOR_MOVED)).toBe("/event");
    // A row for one job leaves another job's link alone.
    expect(relocate({ href: "/stages?round=r2", role: "admin", job: "draw", roundId: "r2" }, ALL, EVERY_DOOR_MOVED)).toBe("/foursomes?round=r2");
    expect(relocate({ href: "/stages?round=r2", role: "admin", job: "rounds" }, ALL, EVERY_DOOR_MOVED)).toBe("/stages?round=r2");
  });
});

describe("a door moves only when every job behind it has a home among the merges shown", () => {
  it("every row of the table houses every job its door holds, for every role it names", () => {
    for (const move of MOVES) expect(unhousedJobs(move), move.from).toEqual([]);
    for (const move of EVERY_DOOR_MOVED) expect(unhousedJobs(move), move.from).toEqual([]);
  });

  it("CONTROL: the bracket moved for staff on the boards merge alone is refused by name", () => {
    const boardOnly: Move = { from: "/bracket", roles: ["admin", "assistant"], homes: { "read-the-bracket": "boards" }, to: () => "/leaderboard?view=bracket" };
    expect(unhousedJobs(boardOnly)).toEqual([
      "/bracket: admin would lose arrange-the-knockout",
      "/bracket: admin would lose record-a-knockout-result",
      "/bracket: admin would lose approve-a-reported-result",
      "/bracket: assistant would lose arrange-the-knockout",
      "/bracket: assistant would lose record-a-knockout-result",
      "/bracket: assistant would lose approve-a-reported-result",
    ]);
    // A door nobody listed, and a role with no job there today, are named too.
    expect(unhousedJobs({ from: "/zz-nowhere", roles: ["admin"], homes: {}, to: () => "/" })).toEqual(["/zz-nowhere: not a door in DOOR_JOBS"]);
    expect(unhousedJobs({ from: "/access", roles: ["player"], homes: {}, to: () => "/" })).toEqual(["/access: player has no job here today"]);
    // And such a row is never taken, whatever shows: the door stays where every job still is.
    for (const role of ["admin", "assistant"] as const) expect(relocate({ href: "/bracket", role }, ALL, [boardOnly])).toBe("/bracket");
  });

  it("the bracket leaves a PLAYER's way on the boards merge, and staff's only once the draw shows too", () => {
    const boards: ReadonlySet<MergeKey> = new Set(["boards"]);
    const both: ReadonlySet<MergeKey> = new Set(["boards", "draw"]);
    expect(relocate({ href: "/bracket", role: "player" }, boards, EVERY_DOOR_MOVED)).toBe("/leaderboard?view=bracket");
    expect(relocate({ href: "/bracket", role: "admin" }, boards, EVERY_DOOR_MOVED)).toBe("/bracket");
    expect(relocate({ href: "/bracket", role: "assistant" }, boards, EVERY_DOOR_MOVED)).toBe("/bracket");
    expect(relocate({ href: "/bracket", role: "admin" }, both, EVERY_DOOR_MOVED)).toBe("/foursomes?round=ko");
  });

  it("a player's own door to their group's games is not a door any row may take (design §4.4)", () => {
    expect(DOOR_JOBS["/group-games"].player).toBeUndefined();
    expect(relocate({ href: "/group-games", role: "player" }, ALL, EVERY_DOOR_MOVED)).toBe("/group-games");
  });
});
