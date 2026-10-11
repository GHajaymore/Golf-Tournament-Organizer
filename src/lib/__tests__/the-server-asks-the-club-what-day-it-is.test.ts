import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { deadlinePassed, deadlineState, todayIso } from "../deadline";
import { playerMayChange } from "../domain/attendance";
import { registrationStatus } from "../registration";

/**
 * THE SERVER ASKS THE CLUB WHAT DAY IT IS (2026-10-11).
 *
 * Every deadline in the app is a day, and a day belongs to a place. The day
 * was whatever the server's clock said — UTC in production — so a club in New
 * York had its entries close at 8pm on the closing day, and one in Sydney saw
 * Saturday's round as "tomorrow" until eleven on Saturday morning. Nothing saw
 * it, because every test ran the server and the club on one machine.
 *
 * The fix is `domain/club-clock.ts` and a zone on the club. THIS holds it:
 *
 *   1. The day helpers no longer have a clock of their own. `todayIso`,
 *      `deadlinePassed`, `deadlineState`, `playerMayChange` and
 *      `registrationStatus` must be TOLD the day — the compiler refuses a call
 *      that leaves it out, and the `@ts-expect-error` lines below fail the
 *      type-check the day somebody gives one of them a default again.
 *   2. And what they are told is not the server's clock. No file outside the
 *      two that define the rule may hand a day helper `new Date()`.
 *
 * What it does NOT see: code that works a day out by hand from `new Date()`
 * with `getDate()` and friends. There was none on the day this was written
 * (`PaceOfPlay` does, in the browser, deliberately: the committee's own watch).
 */

function filesUnder(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = `${dir}/${name}`;
    if (statSync(join(process.cwd(), path)).isDirectory()) filesUnder(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** The helpers that ask what DAY it is. Each takes the day as an argument or a field. */
const DAY_HELPERS = [
  "todayIso",
  "deadlinePassed",
  "deadlineState",
  "playerMayChange",
  "splitBySchedule",
  "currentDatedRoundIndex",
  "registrationStatus",
  "ownWithdrawalOpen",
  "decideIntake",
];

/** Where the rule itself lives: the only files that may turn the server's clock into a day. */
const THE_RULE = ["src/lib/domain/club-clock.ts", "src/lib/deadline.ts"];

/** The text from an opening bracket to its match. */
function bracketed(src: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Calls to a day helper that hand it the machine's own clock, or nothing. */
function asksItsOwnClock(src: string): string[] {
  const out: string[] = [];
  for (const name of DAY_HELPERS) {
    let from = 0;
    for (;;) {
      const at = src.indexOf(`${name}(`, from);
      if (at < 0) break;
      from = at + name.length;
      const before = src[at - 1] ?? " ";
      // A longer name ending in this one, or the declaration itself.
      if (/[A-Za-z0-9_$.]/.test(before)) continue;
      if (src.slice(Math.max(0, at - 9), at) === "function ") continue;
      const args = bracketed(src, at + name.length);
      if (args === null) continue;
      const flat = args.replace(/\s+/g, " ");
      if (flat.includes("new Date()") || flat.includes("Date.now()") || (name === "todayIso" && flat.trim() === "")) {
        out.push(`${name}(${flat.slice(0, 70)})`);
      }
    }
  }
  return out;
}

const SOURCES = filesUnder(
  "src",
  (p) => (p.endsWith(".ts") || p.endsWith(".tsx")) && !p.includes("__tests__/") && !THE_RULE.includes(p),
);

describe("what day it is, on the server", () => {
  it("is never the server's own — no day helper is handed this machine's clock", () => {
    const wrong = SOURCES.flatMap((file) => asksItsOwnClock(readSource(...file.split("/"))).map((c) => `${file} — ${c}`));
    expect(wrong).toEqual([]);
  });

  it("CONTROL: the day helpers are really called from the source this reads", () => {
    // If the reader found no calls, there would be nothing to refuse.
    const callers = (name: string) => SOURCES.filter((f) => readSource(...f.split("/")).includes(`${name}(`));
    expect(SOURCES.length).toBeGreaterThan(400);
    expect(callers("registrationStatus").length).toBeGreaterThanOrEqual(3);
    expect(callers("playerMayChange").length).toBeGreaterThanOrEqual(3);
    expect(callers("decideIntake").length).toBeGreaterThanOrEqual(2);
    expect(callers("clubDay").length + callers("clubDayForEvent").length).toBeGreaterThanOrEqual(6);
  });

  it("CONTROL: a call that reads this machine's clock is seen, and one told the club's day is not", () => {
    expect(asksItsOwnClock("if (!playerMayChange(stage.optDeadline, new Date())) {")).toEqual([
      "playerMayChange(stage.optDeadline, new Date())",
    ]);
    expect(asksItsOwnClock("const today = todayIso();")).toEqual(["todayIso()"]);
    expect(asksItsOwnClock("registrationStatus({ deadline, now: new Date(), locale })")).toEqual([
      "registrationStatus({ deadline, now: new Date(), locale })",
    ]);
    expect(asksItsOwnClock("decideIntake({ reg: { deadline, now: new Date(Date.now()) } })").length).toBe(1);
    // Told the club's day:
    expect(asksItsOwnClock("playerMayChange(stage.optDeadline, await clubDayForEvent(eventId))")).toEqual([]);
    expect(asksItsOwnClock("registrationStatus({ deadline, now: clubDay(zone), locale })")).toEqual([]);
    expect(asksItsOwnClock("const today = todayIso(clubNow);")).toEqual([]);
    // Another function whose name merely ends the same way, and a declaration.
    expect(asksItsOwnClock("notTodayIso()")).toEqual([]);
    expect(asksItsOwnClock("export function todayIso(now: Date): string {")).toEqual([]);
  });

  it("the day helpers have no clock of their own to fall back on", () => {
    // Each line below must NOT compile. If one of these helpers is given a
    // default again, its directive goes unused and the type-check fails.
    const never = (run: () => unknown) => {
      try {
        run();
      } catch {
        /* a missing day is undefined at runtime; only the compiler matters here */
      }
    };
    // @ts-expect-error — todayIso must be told the day
    never(() => todayIso());
    // @ts-expect-error — deadlinePassed must be told the day
    never(() => deadlinePassed("2026-10-12"));
    // @ts-expect-error — deadlineState must be told the day
    never(() => deadlineState("2026-10-12", null));
    // @ts-expect-error — playerMayChange must be told the day
    never(() => playerMayChange("2026-10-12"));
    never(() =>
      // @ts-expect-error — registrationStatus must be told the day
      registrationStatus({ eventStatus: "registration", deadline: "", opens: "", capacity: 0, confirmedCount: 0, override: null }),
    );
    expect(true).toBe(true);
  });
});
