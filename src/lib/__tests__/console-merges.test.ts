import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONSOLE_SCREENS,
  DOOR_JOBS,
  MOVES,
  NO_MERGES,
  ROOMS,
  SCREEN_KEYS,
  doorKey,
  mergeStateRefusals,
  mergesNeeded,
  mergesShown,
  relocate,
  roomOf,
  roomRefusals,
  sampleLink,
  unhousedJobs,
  type Move,
  type ScreenKey,
  type ScreenState,
} from "../domain/console-merges";
import { NAV } from "../nav";
import { ROLES, SCREEN_ACCESS, canAccessScreen, type Role } from "../roles";
import { JOB_SCREENS } from "../domain/needs-you-now";
import { SETUP_ORDER } from "../domain/setup-flow";
import { readSource } from "./source";

/**
 * THE REDESIGN'S SWITCH AND ITS ONE MAP FROM OLD DOORS TO NEW ROOMS (redesign phase 2, R0; the step 3
 * design of 13 Nov, amended 14 Nov, §7; the review of #1142, items 4–6). Six promises:
 *
 *   off is today        no query, or the preview's alone while every screen is building: nothing
 *                       shows, and every address the app makes is the one it made before
 *   building is never   `&build=1` shows a half-built screen to the engineer — never in production
 *   production
 *   a preview in        only to an owner on `OWNER_EMAILS`: a pilot club's staff run real events
 *   production is the
 *   owners'
 *   a door moves only   every job a door holds today has a home among the screens shown, and every
 *   when its jobs have  room it sends a person into is one their role may open
 *   moved, into rooms
 *   its people may open
 *   every move is       one per old door, each to a screen of phase 1's list, each "building"
 *   registered now
 *   server only         `mergesShown(` is called from server files alone (it reads the server's env)
 *
 * Pure. Every name is invented.
 */

const ALL: ReadonlySet<ScreenKey> = new Set(SCREEN_KEYS);
const NOBODY = { owner: false };
const OWNER = { owner: true };
const statesAll = (state: ScreenState) => Object.fromEntries(SCREEN_KEYS.map((k) => [k, state])) as Record<ScreenKey, ScreenState>;
const pathOf = (href: string) => href.split("#")[0].split("?")[0];

/** Every address the machine and the menus make today, with the queries and places links carry. */
const MACHINE_HREFS: string[] = (() => {
  const bases = [...new Set([...NAV.flatMap((s) => s.items.map((i) => i.href)), ...JOB_SCREENS, ...SETUP_ORDER, "/event#courses", "/event?course=c1", "/organization#access"])];
  const tails = ["", "?round=r2", "?round=r2&stepper=1", "#results", "?tie=t1#ties"];
  return bases.flatMap((b) => tails.map((t) => (b.includes("?") || b.includes("#") ? b : b + t)));
})();

/** The `SCREEN_ACCESS` key of an old door's screen (`NAV`'s own key for that address). */
const screenOfDoor = (door: string): string => {
  const path = pathOf(door.split("@")[0]);
  const item = NAV.flatMap((s) => s.items).find((i) => i.href === path);
  if (!item) throw new Error(`${door} is not a screen in NAV`);
  return item.key;
};

describe("which screens show", () => {
  it("switched off as shipped: nothing shows without a query, nor with the preview's alone", () => {
    for (const viewer of [NOBODY, OWNER]) {
      expect(mergesShown("", viewer, "preview")).toBe(NO_MERGES);
      expect(mergesShown("?stepper=1", viewer, "preview").size).toBe(0);
      expect(mergesShown("?stepper=1", viewer, "production").size).toBe(0);
      expect(mergesShown("?round=r1&view=timeline", viewer, "preview").size).toBe(0);
    }
    // Every screen is building until its PR has landed.
    expect(Object.values(CONSOLE_SCREENS)).toEqual(SCREEN_KEYS.map(() => "building"));
  });

  it("one key per screen of phase 1's list, and no other", () => {
    expect([...SCREEN_KEYS]).toEqual(["home", "event", "rounds", "players", "prizes", "teeTimes", "scoreEntry", "leaderboard", "results", "money", "events", "members", "courses", "clubSettings"]);
    expect(Object.keys(CONSOLE_SCREENS).sort()).toEqual([...SCREEN_KEYS].sort());
    expect(Object.keys(ROOMS).sort()).toEqual([...SCREEN_KEYS].sort());
  });

  it("building shows only with the engineer's query beside the preview's", () => {
    expect([...mergesShown("?stepper=1&build=1", NOBODY, "preview")].sort()).toEqual([...SCREEN_KEYS].sort());
    expect([...mergesShown("?build=1", NOBODY, "preview")]).toEqual([]);
    expect([...mergesShown("?stepper=1&build=1", NOBODY, undefined)].sort()).toEqual([...SCREEN_KEYS].sort());
  });

  it("building is NEVER shown in production, whatever the query and whoever asks (Hard rule 1)", () => {
    expect(mergesShown("?stepper=1&build=1", NOBODY, "production").size).toBe(0);
    expect(mergesShown("?stepper=1&build=1", OWNER, "production").size).toBe(0);
    // CONTROL: the same query outside production shows them, so the refusal is production's alone.
    expect(mergesShown("?stepper=1&build=1", NOBODY, "preview").size).toBe(SCREEN_KEYS.length);
  });

  it("a preview in production is shown to an owner only (review item 5; Ajay: no partial previews)", () => {
    const states = { ...statesAll("building"), leaderboard: "preview" as const };
    expect([...mergesShown("?stepper=1", OWNER, "production", states)]).toEqual(["leaderboard"]);
    // A pilot club's staff member, who runs real events, adds the query and sees nothing new.
    expect(mergesShown("?stepper=1", NOBODY, "production", states).size).toBe(0);
    expect(mergesShown("?stepper=1&build=1", NOBODY, "production", states).size).toBe(0);
    // CONTROL: outside production the preview is anybody's with the query (a preview deploy, dev, CI).
    expect([...mergesShown("?stepper=1", NOBODY, "preview", states)]).toEqual(["leaderboard"]);
    expect([...mergesShown("?stepper=1", NOBODY, undefined, states)]).toEqual(["leaderboard"]);
    // And without the query an owner sees nothing new either.
    expect(mergesShown("", OWNER, "production", states).size).toBe(0);
  });

  it("each state is drawn where it says", () => {
    const states: Record<ScreenKey, ScreenState> = { ...statesAll("building"), leaderboard: "preview", money: "on", courses: "preview" };
    expect([...mergesShown("", NOBODY, "preview", states, true)]).toEqual(["money"]);
    expect([...mergesShown("?stepper=1", NOBODY, "preview", states, true)].sort()).toEqual(["courses", "leaderboard", "money"]);
    expect([...mergesShown("?stepper=1&build=1", NOBODY, "preview", states, true)].sort()).toEqual([...SCREEN_KEYS].sort());
    // An "on" screen is everybody's, in production too.
    expect([...mergesShown("", NOBODY, "production", states, true)]).toEqual(["money"]);
  });

  it("no screen is on while the stepper is off — and one left on by mistake reaches only an owner with the preview's query", () => {
    expect(mergeStateRefusals()).toEqual([]);
    // CONTROL: a key switched on alone is refused; with the stepper on it may stand.
    expect(mergeStateRefusals({ ...statesAll("building"), teeTimes: "on" }, false)).toEqual(["teeTimes"]);
    expect(mergeStateRefusals({ ...statesAll("building"), teeTimes: "on" }, true)).toEqual([]);
    const mistaken = { ...statesAll("building"), teeTimes: "on" as const };
    expect(mergesShown("", OWNER, "production", mistaken, false).size).toBe(0);
    expect(mergesShown("?stepper=1", NOBODY, "production", mistaken, false).size).toBe(0);
    expect([...mergesShown("?stepper=1", OWNER, "production", mistaken, false)]).toEqual(["teeTimes"]);
  });
});

describe("relocate: the one map from old doors to new rooms", () => {
  it("switched off it is the identity, for every address the app makes, every role and every job", () => {
    let checked = 0;
    for (const href of MACHINE_HREFS) {
      for (const role of ROLES) {
        for (const job of [undefined, "draw", "knockouts", "lineup", "payout", "tee-sheet"]) {
          expect(relocate({ href, role, job, roundId: "r2" }, NO_MERGES)).toBe(href);
          // Off as shipped: the preview's query alone shows nothing, so nothing moves, in any deployment.
          for (const deployment of ["production", "preview"]) expect(relocate({ href, role, job, roundId: "r2" }, mergesShown("?stepper=1", OWNER, deployment))).toBe(href);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("every move is registered now: with every screen shown, the old doors lead into the new rooms", () => {
    const at = (href: string, role: Role, extra: { job?: string; roundId?: string; casual?: boolean } = {}) => relocate({ href, role, ...extra }, ALL);
    expect(at("/week?round=r2", "player")).toBe("/leaderboard?view=week&round=r2");
    expect(at("/bracket", "player")).toBe("/leaderboard?view=bracket");
    expect(at("/bracket", "admin")).toBe("/leaderboard?view=bracket");
    expect(at("/bracket", "assistant", { job: "knockouts", roundId: "ko" })).toBe("/entry?round=ko");
    expect(at("/cup", "player")).toBe("/leaderboard?view=cup");
    expect(at("/cup", "admin")).toBe("/cup");
    expect(at("/cup", "admin", { job: "lineup", roundId: "s2" })).toBe("/foursomes?round=s2");
    expect(at("/stages", "admin", { job: "draw", roundId: "r2" })).toBe("/foursomes?round=r2");
    expect(at("/stages", "admin", { job: "rounds" })).toBe("/stages");
    expect(at("/group-games", "admin")).toBe("/money#groups");
    expect(at("/group-games", "admin", { casual: true })).toBe("/group-games");
    expect(at("/group-games", "player")).toBe("/group-games");
    expect(at("/prizes", "admin")).toBe("/prizes");
    expect(at("/prizes", "admin", { job: "payout" })).toBe("/money");
    expect(at("/access", "admin")).toBe("/organization#access");
    expect(at("/event#courses", "admin")).toBe("/courses");
    expect(at("/event?course=c1", "admin")).toBe("/courses?course=c1");
    expect(at("/event", "admin")).toBe("/event");
    expect(at("/print?round=r2", "assistant")).toBe("/foursomes?round=r2#print");
    expect(at("/member?id=m1", "admin")).toBe("/member?id=m1");
    // The preview's own queries are never carried onto the new address.
    expect(at("/week?round=r2&stepper=1&build=1", "admin")).toBe("/leaderboard?view=week&round=r2");
  });

  it("a door waits for EVERY screen its jobs move into: the staff bracket needs the board, the draw and Score entry", () => {
    const only = (...keys: ScreenKey[]): ReadonlySet<ScreenKey> => new Set(keys);
    expect(relocate({ href: "/bracket", role: "player" }, only("leaderboard"))).toBe("/leaderboard?view=bracket");
    expect(relocate({ href: "/bracket", role: "admin" }, only("leaderboard"))).toBe("/bracket");
    expect(relocate({ href: "/bracket", role: "admin" }, only("leaderboard", "teeTimes"))).toBe("/bracket");
    expect(relocate({ href: "/bracket", role: "admin" }, only("leaderboard", "teeTimes", "scoreEntry"))).toBe("/leaderboard?view=bracket");
    // The courses door waits for Event too, where this event's course is still picked.
    expect(relocate({ href: "/event#courses", role: "admin" }, only("courses"))).toBe("/event#courses");
    expect(relocate({ href: "/event#courses", role: "admin" }, only("courses", "event"))).toBe("/courses");
    // Each move's needs are its room and its jobs' homes.
    for (const move of MOVES) expect(mergesNeeded(move)).toContain(move.room);
  });
});

describe("a door moves only when every job behind it has a home its people may open", () => {
  it("every registered move houses every job its door holds, for every role it names, in rooms they may open", () => {
    expect(MOVES.length).toBeGreaterThanOrEqual(13);
    for (const move of MOVES) {
      expect(unhousedJobs(move), doorKey(move)).toEqual([]);
      expect(roomRefusals(move), doorKey(move)).toEqual([]);
      for (const k of mergesNeeded(move)) expect(SCREEN_KEYS, doorKey(move)).toContain(k);
    }
  });

  it("every role × every old door, with everything shown, lands on a room that role may open", () => {
    let checked = 0;
    for (const [door, byRole] of Object.entries(DOOR_JOBS)) {
      for (const role of Object.keys(byRole) as Role[]) {
        const link = sampleLink(door, role);
        const landed = relocate(link, ALL);
        const room = roomOf(landed);
        expect(room, `${door} for ${role} lands on ${landed}, in no room`).not.toBeNull();
        expect(canAccessScreen(role, ROOMS[room!].access), `${door} for ${role} lands in ${room}, which ${role} may not open`).toBe(true);
        checked++;
      }
    }
    // Fifteen doors, 30 role-and-door pairs (R12 added closing a round): a sweep over nothing would pass everything above.
    expect(Object.keys(DOOR_JOBS)).toHaveLength(15);
    expect(checked).toBe(30);
  });

  it("the old doors name every role that may open them today (only a player's own group games are kept back)", () => {
    const kept: Record<string, Role[]> = { "/group-games": ["player"] };
    for (const door of Object.keys(DOOR_JOBS).filter((d) => !d.includes("@"))) {
      const may = ROLES.filter((r) => canAccessScreen(r, screenOfDoor(door)));
      const named = Object.keys(DOOR_JOBS[door]) as Role[];
      expect(named.sort(), door).toEqual(may.filter((r) => !(kept[door] ?? []).includes(r)).sort());
    }
  });

  it("each room is held to a rule SCREEN_ACCESS has, and each of its addresses is one room's", () => {
    for (const k of SCREEN_KEYS) expect(Object.keys(SCREEN_ACCESS), k).toContain(ROOMS[k].access);
    const paths = SCREEN_KEYS.flatMap((k) => ROOMS[k].paths);
    expect(new Set(paths).size).toBe(paths.length);
    // The two new rooms take the rule the design gives them: money is staff's, courses the organizer's.
    expect(ROLES.filter((r) => canAccessScreen(r, ROOMS.money.access))).toEqual(["admin", "assistant"]);
    expect(ROLES.filter((r) => canAccessScreen(r, ROOMS.courses.access))).toEqual(["admin"]);
  });

  it("CONTROL: the bracket moved for staff on the board alone is refused by name, and never taken", () => {
    const boardOnly: Move = { from: "/bracket", roles: ["admin", "assistant"], homes: { "read-the-bracket": "leaderboard" }, room: "leaderboard", to: () => "/leaderboard?view=bracket" };
    expect(unhousedJobs(boardOnly)).toEqual([
      "/bracket: admin would lose arrange-the-knockout",
      "/bracket: admin would lose record-a-knockout-result",
      "/bracket: admin would lose approve-a-reported-result",
      "/bracket: assistant would lose arrange-the-knockout",
      "/bracket: assistant would lose record-a-knockout-result",
      "/bracket: assistant would lose approve-a-reported-result",
    ]);
    expect(unhousedJobs({ from: "/zz-nowhere", roles: ["admin"], homes: {}, room: "home", to: () => "/" })).toEqual(["/zz-nowhere: not a door in DOOR_JOBS"]);
    expect(unhousedJobs({ from: "/access", roles: ["player"], homes: {}, room: "home", to: () => "/" })).toEqual(["/access: player has no job here today"]);
    for (const role of ["admin", "assistant"] as const) expect(relocate({ href: "/bracket", role }, ALL, [boardOnly])).toBe("/bracket");
  });

  it("CONTROL: a move into a room its people may not open is refused by name, and never taken (review item 4)", () => {
    // A player's week sent to Winners & money: housed, but money is staff's.
    const toMoney: Move = { from: "/week", roles: ["player"], homes: { "read-the-week": "money" }, room: "money", to: () => "/money" };
    expect(unhousedJobs(toMoney)).toEqual([]);
    expect(roomRefusals(toMoney)).toEqual(["/week: player may not open money", "/week: player may not open money, where read-the-week lives"]);
    expect(relocate({ href: "/week", role: "player" }, ALL, [toMoney])).toBe("/week");
    // A job housed in a room the role may not open, though the door's own room is fine.
    const homeShut: Move = { from: "/week", roles: ["assistant"], homes: { "read-the-week": "courses" }, room: "leaderboard", to: () => "/leaderboard" };
    expect(roomRefusals(homeShut)).toEqual(["/week: assistant may not open courses, where read-the-week lives"]);
    // A row whose address is not the room it names.
    const misnamed: Move = { from: "/access", roles: ["admin"], homes: { "manage-this-events-helpers": "clubSettings" }, room: "clubSettings", to: () => "/dashboard" };
    expect(roomRefusals(misnamed)).toEqual(["/access: leads to home, not clubSettings"]);
    expect(relocate({ href: "/access", role: "admin" }, ALL, [misnamed])).toBe("/access");
  });

  it("a door never moves into a room the edge says this person's event withholds from them", () => {
    // A blind event: the player has the cup's board and no Leaderboard.
    expect(relocate({ href: "/cup", role: "player", screens: new Set(["me", "cup", "entry"]) }, ALL)).toBe("/cup");
    // CONTROL: with the Leaderboard theirs, the same door moves.
    expect(relocate({ href: "/cup", role: "player", screens: new Set(["me", "cup", "entry", "leaderboard"]) }, ALL)).toBe("/leaderboard?view=cup");
  });

  it("a player's own door to their group's games is not a door any row may take (step 3 §4.4)", () => {
    expect(DOOR_JOBS["/group-games"].player).toBeUndefined();
    expect(relocate({ href: "/group-games", role: "player" }, ALL)).toBe("/group-games");
  });
});

/** Files under `src` (tests left out), as paths from the repository root. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== "__tests__") sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
}

/** The switches that read the server's environment: called from a server file, never a client one. */
const SERVER_SWITCHES = /\b(mergesShown|stepperShown)\(/;
const DEFINED_IN = ["src/lib/domain/console-merges.ts", "src/lib/domain/lifecycle-track.ts"];

/**
 * Why a file may not call `mergesShown(` or `stepperShown(`: it is a client file, or code a client
 * file can import. Server files are the route files and services under `src/app` and
 * `src/lib/services` that do not say "use client". The definitions themselves are allowed.
 */
function clientCallRefusal(file: string, src: string): string | null {
  const name = file.replace(/\\/g, "/");
  const call = SERVER_SWITCHES.exec(src);
  if (!call) return null;
  if (DEFINED_IN.some((d) => name.endsWith(d))) return null;
  if (/^\s*["']use client["']/m.test(src)) return `${name}: a client file calls ${call[1]}`;
  if (!/^src\/(app|lib\/services)\//.test(name)) return `${name}: not a server file (src/app or src/lib/services)`;
  return null;
}

/** R1c: the only files that may call `mergesShown(`, besides its definition. A page asks `screensShownFor`. */
const MERGES_CALLERS = ["src/app/(app)/layout.tsx", "src/lib/services/screens-shown.ts"];

function mergesCallerRefusal(file: string, src: string): string | null {
  const name = file.replace(/\\/g, "/");
  if (!/\bmergesShown\(/.test(src)) return null;
  if (name.endsWith("src/lib/domain/console-merges.ts")) return null;
  if (MERGES_CALLERS.includes(name)) return null;
  return `${name}: calls mergesShown( directly; ask screensShownFor (services/screens-shown.ts)`;
}

describe("the only callers of mergesShown( are the layout and screensShownFor (R1c)", () => {
  it("no other file under src calls it", () => {
    const refused: string[] = [];
    const callers: string[] = [];
    for (const file of sourceFiles("src")) {
      const src = readSource(file);
      const why = mergesCallerRefusal(file, src);
      if (why) refused.push(why);
      if (/\bmergesShown\(/.test(src)) callers.push(file.replace(/\\/g, "/"));
    }
    expect(refused).toEqual([]);
    expect(callers).toEqual(expect.arrayContaining(MERGES_CALLERS));
  });

  it("CONTROL: a page calling it directly is refused; the two allowed callers and the definition are not", () => {
    const call = 'const m = mergesShown("", { owner: false });';
    expect(mergesCallerRefusal("src/app/(app)/zz/page.tsx", call)).toBe(
      "src/app/(app)/zz/page.tsx: calls mergesShown( directly; ask screensShownFor (services/screens-shown.ts)",
    );
    expect(mergesCallerRefusal("src/app/(app)/layout.tsx", call)).toBeNull();
    expect(mergesCallerRefusal("src/lib/services/screens-shown.ts", call)).toBeNull();
    expect(mergesCallerRefusal("src/lib/domain/console-merges.ts", call)).toBeNull();
    expect(mergesCallerRefusal("src/app/(app)/zz/page.tsx", "screensShownFor(session);")).toBeNull();
  });
});

describe("the switches are called on the server only (review item 6; the stepper's owner gate)", () => {
  it("every caller under src is a server file", () => {
    const callers: string[] = [];
    const refused: string[] = [];
    for (const file of sourceFiles("src")) {
      const src = readSource(file);
      if (!SERVER_SWITCHES.test(src)) continue;
      callers.push(file.replace(/\\/g, "/"));
      const why = clientCallRefusal(file, src);
      if (why) refused.push(why);
    }
    expect(refused).toEqual([]);
    // The sweep found the callers there are, so it is not passing on nothing.
    expect(callers).toContain("src/app/(app)/layout.tsx");
  });

  it("CONTROL: a client component, or a shared lib file, calling either is refused", () => {
    expect(clientCallRefusal("src/components/ZzMenu.tsx", '"use client";\nconst m = mergesShown("", { owner: false });')).toBe("src/components/ZzMenu.tsx: a client file calls mergesShown");
    expect(clientCallRefusal("src/components/ZzBar.tsx", '"use client";\nconst s = stepperShown("", { owner: false });')).toBe("src/components/ZzBar.tsx: a client file calls stepperShown");
    expect(clientCallRefusal("src/app/(app)/zz/page.tsx", "stepperShown(q, v);")).toBeNull();
    expect(clientCallRefusal("src/lib/zz-nav.ts", 'const m = mergesShown("", { owner: false });')).toBe("src/lib/zz-nav.ts: not a server file (src/app or src/lib/services)");
    expect(clientCallRefusal("src/app/(app)/zz/ZzClient.tsx", "'use client'\nmergesShown(q, v);")).toBe("src/app/(app)/zz/ZzClient.tsx: a client file calls mergesShown");
    expect(clientCallRefusal("src/app/(app)/zz/page.tsx", "mergesShown(q, v);")).toBeNull();
  });
});
