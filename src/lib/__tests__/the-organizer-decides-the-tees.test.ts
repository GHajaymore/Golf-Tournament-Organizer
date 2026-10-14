import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import {
  courseHandicapMap,
  isWoman,
  ladiesTeeFor,
  ladiesTeeOn,
  teeIdFor,
  teeIsForWomen,
  type IndexHolder,
} from "../domain/handicap";
import {
  TEE_POLICY,
  TEE_POLICY_HELP,
  TEE_POLICY_LABEL,
  cleanSettings,
  flightTeeCounts,
  playerTeeCounts,
  readTeePolicy,
} from "../tournament-settings";

/**
 * THE ORGANIZER DECIDES THE TEES — AT THREE LEVELS, AND NOBODY ELSE AT ANY.
 *
 * Ajay, 2026-10-13: "for any tournament, it should be the organizer who should
 * decide who is playing from what tees based on the flights or some other
 * criteria"; "if it is senior championship, organizer can set the tees at the
 * tournament level, if it is club championship where mens, seniors, ladies
 * playing, organizer can set/override at the flight level"; "also organizer can
 * change the tees at player level"; and "use the common sense of defaulting the
 * tees based on gender".
 *
 * The three levels existed. What prompted the ruling is that an ENTRANT could
 * set their own tees through three doors — the Preferred tee box on the public
 * entry form, a member entering themselves, and adding a member from the
 * roster — each storing free text as the player's own set, where it beat the
 * flight's. And every test of tees was green over it, because every one of them
 * put a player on a set and asked whether it was honoured: none asked WHO had
 * put them there.
 *
 * So this file asks three things:
 *
 *   the order    which set a player is on, for every combination of what the
 *                organizer has and has not set — typed out by hand below, not
 *                derived, so it cannot agree with the resolver by construction
 *   the default  a woman nobody has put elsewhere plays the course's ladies'
 *                set; anything the organizer set beats it; one set for
 *                everyone ignores it
 *   the doors    nothing in the app writes a player's tees but the organizer's
 *                own action
 *
 * WHAT IT CANNOT SEE: that a screen offers the control or prints the tee it
 * resolved (`e2e/organizer-tees.spec.ts`), and that an entry made through a
 * real action lands with no tees (`the-organizer-decides-the-tees.audit.test.ts`).
 */

const here = () => true;

describe("which set a player is on", () => {
  // The four sets a case can name. "-" is: the organizer has set nothing at that level.
  type Case = { policy: string; player: string | null; flight: string | null; ladies: string | null; plays: string; why: string };
  const T = "tournament";
  const CASES: Case[] = [
    // ── nothing set below the tournament ──
    { policy: "own", player: null, flight: null, ladies: null, plays: T, why: "a man nobody has moved" },
    { policy: "flight", player: null, flight: null, ladies: null, plays: T, why: "a man nobody has moved" },
    { policy: "one", player: null, flight: null, ladies: null, plays: T, why: "one set for everyone" },
    // ── the default: a woman, with nothing else set ──
    { policy: "own", player: null, flight: null, ladies: "ladies", plays: "ladies", why: "the course's ladies' set" },
    { policy: "flight", player: null, flight: null, ladies: "ladies", plays: "ladies", why: "the course's ladies' set" },
    { policy: "one", player: null, flight: null, ladies: "ladies", plays: T, why: "one set means men and women alike" },
    // ── a flight's set beats the tournament's and the default ──
    { policy: "own", player: null, flight: "flight", ladies: null, plays: "flight", why: "her flight's" },
    { policy: "own", player: null, flight: "flight", ladies: "ladies", plays: "flight", why: "what the organizer set beats the default" },
    { policy: "flight", player: null, flight: "flight", ladies: "ladies", plays: "flight", why: "what the organizer set beats the default" },
    { policy: "one", player: null, flight: "flight", ladies: "ladies", plays: T, why: "one set stops at the tournament" },
    // ── one player, moved by the organizer, beats everything ──
    { policy: "own", player: "player", flight: null, ladies: null, plays: "player", why: "moved by the organizer" },
    { policy: "own", player: "player", flight: "flight", ladies: "ladies", plays: "player", why: "moved by the organizer" },
    // ── and does not count where the setting stops above the player ──
    { policy: "flight", player: "player", flight: "flight", ladies: "ladies", plays: "flight", why: "by flight: nobody is moved one by one" },
    { policy: "flight", player: "player", flight: null, ladies: "ladies", plays: "ladies", why: "by flight: her own set is stepped past, the default is not" },
    { policy: "flight", player: "player", flight: null, ladies: null, plays: T, why: "by flight, with no flight set" },
    { policy: "one", player: "player", flight: "flight", ladies: "ladies", plays: T, why: "one set for everyone" },
  ];

  for (const c of CASES) {
    const set = [c.player && "player", c.flight && "flight", c.ladies && "a woman"].filter(Boolean).join(" + ") || "nothing";
    it(`${c.policy}: ${set} set → ${c.plays} (${c.why})`, () => {
      expect(teeIdFor(c.policy, c.player, c.flight, T, here, c.ladies)).toBe(c.plays);
    });
  }

  it("CONTROL: the table reaches every level under every setting the app offers", () => {
    expect([...TEE_POLICY].sort()).toEqual(["flight", "one", "own"]);
    for (const policy of TEE_POLICY) {
      const mine = CASES.filter((c) => c.policy === policy);
      expect(mine.length, policy).toBeGreaterThanOrEqual(4);
    }
    // Every answer is given somewhere: no level is unreachable in the table.
    expect(new Set(CASES.map((c) => c.plays))).toEqual(new Set([T, "ladies", "flight", "player"]));
  });

  it("a set that is not at the course being played is stepped past, the ladies' included", () => {
    const atHome = (id: string) => id.startsWith("home");
    expect(teeIdFor("own", null, null, "home-white", atHome, "away-red")).toBe("home-white");
    expect(teeIdFor("own", null, "away-yellow", "home-white", atHome, "home-red")).toBe("home-red");
    expect(teeIdFor("own", "away-blue", "away-yellow", "home-white", atHome, "away-red")).toBe("home-white");
  });

  it("the two screens that offer a level offer it exactly where it counts", () => {
    for (const policy of TEE_POLICY) {
      expect(playerTeeCounts(policy), policy).toBe(teeIdFor(policy, "player", "flight", T, here, "ladies") === "player");
      expect(flightTeeCounts(policy), policy).toBe(teeIdFor(policy, null, "flight", T, here, "ladies") === "flight");
    }
  });
});

describe("the ladies' default", () => {
  it("reads a woman from the spellings a club's file has, and nobody else", () => {
    for (const g of ["F", "f", "female", "Female", " FEMALE ", "W", "woman", "Women", "Lady", "ladies", "girl", "Girls"]) {
      expect(isWoman(g), g).toBe(true);
      expect(teeIsForWomen(g), g).toBe(true);
    }
    // A blank is not known to be: nobody is moved to other tees on a guess.
    for (const g of ["", "   ", null, undefined, "M", "male", "Men", "any", "x", "fe", "female junior", "men & women"]) {
      expect(isWoman(g as string | null | undefined), String(g)).toBe(false);
    }
  });

  const TEES = new Map([
    ["blue", { courseId: "home", gender: "any", courseRating: 72.4, slopeRating: 134, par: 71 }],
    ["white", { courseId: "home", gender: "any", courseRating: 70.8, slopeRating: 129, par: 71 }],
    // Two sets rated for women at home: the whites as a woman plays them, and the reds.
    ["white-w", { courseId: "home", gender: "women", courseRating: 76.1, slopeRating: 138, par: 73 }],
    ["red", { courseId: "home", gender: "female", courseRating: 72.9, slopeRating: 127, par: 72 }],
    ["away-red", { courseId: "away", gender: "women", courseRating: 60.0, slopeRating: 100, par: 62 }],
    ["away-white", { courseId: "away", gender: "any", courseRating: 58.6, slopeRating: 96, par: 62 }],
  ]);

  it("is the lowest-rated set for women AT THAT COURSE: the shortest, which is what a club means", () => {
    expect(ladiesTeeOn(TEES, "home")).toBe("red");
    expect(ladiesTeeOn(TEES, "away")).toBe("away-red");
    // A set at another course is never the answer, however low its rating.
    expect(ladiesTeeOn([...TEES].filter(([id]) => id !== "red"), "home")).toBe("white-w");
  });

  it("is nothing where the course has no set for women, or no course is known", () => {
    expect(ladiesTeeOn([...TEES].filter(([, t]) => t.gender === "any"), "home")).toBeNull();
    expect(ladiesTeeOn(TEES, "nowhere")).toBeNull();
    expect(ladiesTeeOn(TEES, null)).toBeNull();
    expect(ladiesTeeOn(TEES, undefined)).toBeNull();
  });

  it("applies to a woman and to nobody else", () => {
    expect(ladiesTeeFor("female", "red")).toBe("red");
    expect(ladiesTeeFor("F", "red")).toBe("red");
    expect(ladiesTeeFor("male", "red")).toBeNull();
    expect(ladiesTeeFor("", "red")).toBeNull();
    expect(ladiesTeeFor(undefined, "red")).toBeNull();
    expect(ladiesTeeFor("female", null)).toBeNull();
  });

  /**
   * A course handicap, by the Rule (5.x / 6.1) in whole numbers: index × slope
   * / 113 + (rating − par), rounded once, a half upwards. In 1,130ths.
   */
  const byTheRule = (indexTenths: number, t: { courseRating: number; slopeRating: number; par: number }) => {
    const n = indexTenths * t.slopeRating + (Math.round(t.courseRating * 10) - t.par * 10) * 113;
    return Math.floor((2 * n + 1130) / 2260);
  };
  const p = (id: string, gender: string | null, teeId: string | null = null, flightTeeId: string | null = null): IndexHolder => ({
    id,
    // 12.0: thirteen strokes off the whites, fourteen off the reds, sixteen off the blues.
    handicap: 12.0,
    teeId,
    flightTeeId,
    gender,
  });

  it("a field's handicaps put a woman on the ladies' rating and everybody else on the tournament's", () => {
    const field = [p("ann", "female"), p("bob", "male"), p("cat", ""), p("dee", "F", "blue"), p("eve", "female", null, "white")];
    const map = courseHandicapMap(field, TEES, "white", 18, "own");
    expect(map.get("ann")).toBe(byTheRule(120, TEES.get("red")!));
    expect(map.get("bob")).toBe(byTheRule(120, TEES.get("white")!));
    // Not said: the tournament's.
    expect(map.get("cat")).toBe(byTheRule(120, TEES.get("white")!));
    // The organizer moved her to the blues, and put eve's flight on the whites: both beat the default.
    expect(map.get("dee")).toBe(byTheRule(120, TEES.get("blue")!));
    expect(map.get("eve")).toBe(byTheRule(120, TEES.get("white")!));
    // CONTROL: the red and the white really do give this index different strokes.
    expect(byTheRule(120, TEES.get("red")!)).not.toBe(byTheRule(120, TEES.get("white")!));
  });

  it("and the strokes for the pars follow the set she is on (Rule 6.2b)", () => {
    const field = [p("ann", "female"), p("bob", "male")];
    const map = courseHandicapMap(field, TEES, "white", 18, "own");
    // Red is par 72, white par 71.
    expect(map.parStrokes("ann")).toBe(1);
    expect(map.parStrokes("bob")).toBe(0);
  });

  it("one set for everyone puts her on it, with no stroke for a par nobody is playing", () => {
    const field = [p("ann", "female", "red", "red"), p("bob", "male")];
    const map = courseHandicapMap(field, TEES, "white", 18, "one");
    expect(map.get("ann")).toBe(byTheRule(120, TEES.get("white")!));
    expect(map.parStrokes("ann")).toBe(0);
  });

  it("at another course it is THAT course's ladies' set, not the home club's", () => {
    const map = courseHandicapMap([p("ann", "female"), p("bob", "male")], TEES, "away-white", 18, "own");
    expect(map.get("ann")).toBe(byTheRule(120, TEES.get("away-red")!));
    expect(map.get("bob")).toBe(byTheRule(120, TEES.get("away-white")!));
  });
});

describe("the setting says how far down the organizer's choice goes, and no further", () => {
  it("offers three answers, each worded as something the ORGANIZER sets", () => {
    expect(Object.keys(TEE_POLICY_LABEL).sort()).toEqual(["flight", "one", "own"]);
    expect(Object.keys(TEE_POLICY_HELP).sort()).toEqual(["flight", "one", "own"]);
    for (const text of [...Object.values(TEE_POLICY_LABEL), ...Object.values(TEE_POLICY_HELP)]) {
      expect(text).not.toMatch(/players? chooses?|golfers? chooses?|picks? their own|may choose/i);
    }
    // And the one place a player is mentioned says they do not choose.
    expect(TEE_POLICY_HELP.own).toMatch(/A player does not choose their own tees/);
  });

  it("says where the ladies' default applies, under the two settings that have it", () => {
    expect(TEE_POLICY_HELP.own).toMatch(/ladies/);
    expect(TEE_POLICY_HELP.flight).toMatch(/ladies/);
    expect(TEE_POLICY_HELP.one).toMatch(/men and women alike/);
  });

  it("a tournament stored with the retired setting reads as the one it was scored as", () => {
    expect(readTeePolicy("player")).toBe("own");
    expect(cleanSettings({ teePolicy: "player" }).teePolicy).toBe("own");
    // Nothing else is rewritten, and rubbish still falls back to the default.
    for (const policy of TEE_POLICY) expect(cleanSettings({ teePolicy: policy }).teePolicy).toBe(policy);
    expect(cleanSettings({ teePolicy: "nonsense" }).teePolicy).toBe("own");
    expect(cleanSettings({}).teePolicy).toBe("own");
  });
});

/**
 * NOTHING WRITES A PLAYER'S TEES BUT THE ORGANIZER'S OWN ACTION.
 *
 * Read from the source, because the fault had no runtime symptom anybody was
 * looking for: an entry that set its own tees produced a perfectly good card.
 */
describe("the doors", () => {
  function sources(dir = "src", out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const files = sources();
  const codeOf = new Map(files.map((f) => [f, readSource(f)]));

  /** Every write to a Player row in a file — create, update, upsert and their Many forms — as the text of the call. */
  function playerWrites(code: string): string[] {
    const out: string[] = [];
    for (const verb of ["create", "createMany", "update", "updateMany", "upsert"]) {
      const needle = `.player.${verb}(`;
      let at = code.indexOf(needle);
      while (at >= 0) {
        let depth = 0;
        let i = at + needle.length;
        for (; i < code.length; i += 1) {
          if (code[i] === "(") depth += 1;
          else if (code[i] === ")") {
            if (depth === 0) break;
            depth -= 1;
          }
        }
        out.push(code.slice(at, i));
        at = code.indexOf(needle, i);
      }
    }
    return out;
  }
  /** A write that sets the player's own tees: `teeId` as a key of what is written. */
  const setsTees = (call: string) => /\bteeId\b\s*[:,}]/.test(call.replace(/where:\s*\{[^}]*\}/g, ""));

  it("CONTROL: the sweep reads the app, finds the writes, and recognises one that sets tees", () => {
    expect(files.length).toBeGreaterThan(400);
    const all = files.flatMap((f) => playerWrites(codeOf.get(f)!));
    // Entry by form, by a member, from the roster, by import, by a casual round, and the edits.
    expect(all.length).toBeGreaterThan(20);
    expect(setsTees(".player.update({ where: { id: playerId }, data: { teeId } }")).toBe(true);
    expect(setsTees(".player.create({ data: { eventId, teeId: teeFor(person.preferredTee), name } }")).toBe(true);
    expect(setsTees(".player.update({ where: { id, teeId: x }, data: { name } }")).toBe(false);
    expect(setsTees(".player.create({ data: { eventId, name, preferredTee } }")).toBe(false);
  });

  it("one write in the whole app sets a player's tees, and it is the organizer's action", () => {
    const writers = files
      .flatMap((f) => playerWrites(codeOf.get(f)!).filter(setsTees).map(() => f))
      .sort();
    expect(writers).toEqual(["src/app/actions/courses.ts"]);
    const courses = codeOf.get("src/app/actions/courses.ts")!;
    const body = courses.slice(courses.indexOf("export async function setPlayerTee"), courses.indexOf("export async function verifyCourseCard"));
    expect(playerWrites(body).filter(setsTees)).toHaveLength(1);
  });

  it("that action turns away everybody but staff before it reads anything", () => {
    const courses = codeOf.get("src/app/actions/courses.ts")!;
    const body = courses.slice(courses.indexOf("export async function setPlayerTee"), courses.indexOf("export async function verifyCourseCard"));
    const gate = body.indexOf('session.role !== "admin" && session.role !== "assistant"');
    const firstRead = body.indexOf("prisma.");
    expect(gate, "the staff gate is gone").toBeGreaterThan(0);
    expect(gate).toBeLessThan(firstRead);
    // No branch left that looks up whose entry it is in order to let them through.
    expect(body).not.toMatch(/email: session\.email/);
  });

  it("the three doors an entrant came through write no tees", () => {
    for (const f of ["src/app/actions/enter.ts", "src/app/actions/register.ts", "src/app/actions/roster.ts"]) {
      const code = codeOf.get(f)!;
      expect(playerWrites(code).length, `${f} no longer creates a player, so this asserts nothing`).toBeGreaterThan(0);
      expect(playerWrites(code).filter(setsTees), f).toEqual([]);
      expect(code, f).not.toMatch(/teeMatcherFor|matchTee\(/);
    }
  });

  it("the public entry form does not ask which tees", () => {
    const form = codeOf.get("src/components/RegisterClient.tsx")!;
    expect(form).not.toMatch(/preferredTee/);
    expect(form).not.toMatch(/Preferred tee\s*</);
  });

  it("every reader of a round loads gender through the one select, so none can put a woman on other tees", () => {
    const service = codeOf.get("src/lib/services/handicaps.ts")!;
    expect(service).toMatch(/export const FIELD_PLAYER = \{ id: true, handicap: true, handicapType: true, teeId: true, gender: true \} as const;/);
    // The compiler holds the callers to the type; this holds the type to its word.
    expect(service).toMatch(/export type FieldPlayer = Omit<IndexHolder, "flightTeeId" \| "gender"> & \{ gender: string \| null \};/);
    expect(service).toMatch(/players: readonly FieldPlayer\[\];/);
    expect(service).toMatch(/field: readonly FieldPlayer\[\];/);
  });

  it("the tee resolver is called from the places that resolve a tee, and each passes the ladies' rung", () => {
    const callers = files.filter((f) => /(?<![A-Za-z])teeIdFor\(/.test(codeOf.get(f)!.replace("export function teeIdFor(", ""))).sort();
    expect(callers).toEqual([
      "src/app/(app)/registration/page.tsx",
      "src/lib/domain/handicap.ts",
      "src/lib/services/handicap-record.ts",
      "src/lib/services/handicaps.ts",
    ]);
    for (const f of callers) expect(codeOf.get(f), f).toMatch(/ladiesTeeFor\(/);
  });
});
