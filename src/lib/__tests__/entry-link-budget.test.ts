import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  RATE_LIMITS,
  LARGEST_DAY_FIELD,
  decideRateLimit,
  entryLinkBudget,
  windowFor,
} from "../domain/rate-limit";
import { PLANS } from "../plans";
import { readSource } from "./source";

/**
 * HOW MANY SIGN-UPS ONE ENTRY LINK TAKES IN A WINDOW (2026-11-10).
 *
 * Round G583-1: a Birdie field of 64 opened its link, and members 61 to 72
 * were told "This entry form is very busy just now" — the link's flood cap was
 * a fixed sixty whatever the field. Security and the Tournament Director ruled
 * it a product limit: a field filling in the minutes after entries open must
 * never be turned away while places remain, and the cap is there for a script.
 *
 * The rule, in words, worked here by hand rather than by calling the code's
 * arithmetic: the people a link must take are the field plus a waiting list
 * half its size; each of them may need a second try (a mistyped handicap, a
 * double tap); the budget is twice that, never below sixty. An open field is
 * budgeted as the biggest day of golf, a two-fourball shotgun: 18 × 2 × 4 = 144.
 */

const FLOOR = 60;
/** Inside one window, so "the window turned over" is never what let one through. */
const now = RATE_LIMITS["register-token"].windowMs * 1000 + 1000;

/** How many of a burst of `n` sign-ups on one link the limiter lets through. */
function takenOf(n: number, budget: number): number {
  let taken = 0;
  for (let attempt = 1; attempt <= n; attempt += 1) {
    if (decideRateLimit("register-token", attempt, now, budget).allowed) taken += 1;
  }
  return taken;
}

describe("an entry link's budget grows with its field", () => {
  it("takes a 64-player field and eight on the list in one burst", () => {
    // 64 places + 32 on the list = 96 people; each may try twice: 192.
    const budget = entryLinkBudget({ live: true, fieldLimit: 64 });
    expect(budget).toBe(192);
    expect(takenOf(64 + 8, budget), "the scenario's CAP + 8 sign-ups").toBe(72);
    // CONTROL: the fixed sixty this replaces turned the 61st away — the test
    // sees the old fault, so a pass above is the budget, not a blind check.
    expect(takenOf(64 + 8, RATE_LIMITS["register-token"].limit)).toBe(60);
  });

  it("still refuses a scripted flood on a 50-player link, past its budget", () => {
    // 50 + 25 = 75 people, twice: 150. A thousand posts in the window get 150.
    const budget = entryLinkBudget({ live: true, fieldLimit: 50 });
    expect(budget).toBe(150);
    expect(takenOf(1000, budget)).toBe(150);
    const refused = decideRateLimit("register-token", 151, now, budget);
    expect(refused.allowed).toBe(false);
    // The words and the window are the kind's, unchanged.
    expect(refused.message).toMatch(/^This entry form is very busy just now\. Wait \d+ minutes? and try again\.$/);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(RATE_LIMITS["register-token"].windowMs).toBe(15 * 60_000);
    expect(windowFor(RATE_LIMITS["register-token"], now).endsAt - now).toBeLessThanOrEqual(15 * 60_000);
  });

  it("gives an open field a finite budget, the biggest day's", () => {
    // 144 + 72 = 216 people, twice: 432 — a number, never Infinity.
    expect(LARGEST_DAY_FIELD).toBe(18 * 2 * 4);
    const open = entryLinkBudget({ live: true, fieldLimit: 0 });
    expect(open).toBe(432);
    expect(Number.isFinite(open)).toBe(true);
    expect(takenOf(5000, open)).toBe(432);
    // Nonsense in is an open field, never an endless budget.
    for (const odd of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(entryLinkBudget({ live: true, fieldLimit: odd }), String(odd)).toBe(432);
    }
  });

  it("never falls below sixty, and a link not taking entries earns no more", () => {
    // Free's ten: 10 + 5 = 15 people, twice: 30 — the floor holds at 60.
    expect(entryLinkBudget({ live: true, fieldLimit: 10 })).toBe(FLOOR);
    expect(entryLinkBudget({ live: true, fieldLimit: 1 })).toBe(FLOOR);
    // An unknown token and a closed link are the floor alike: no oracle.
    expect(entryLinkBudget({ live: false })).toBe(FLOOR);
    expect(RATE_LIMITS["register-token"].limit).toBe(FLOOR);
  });

  it("on every plan, a field filled to the plan's cap with eight waiting is taken", () => {
    // Read from the plans, never typed: a plan with no cap is an open field.
    for (const plan of Object.values(PLANS)) {
      const cap = plan.limits.playersPerEvent;
      const budget = entryLinkBudget({ live: true, fieldLimit: cap ?? 0 });
      expect(Number.isFinite(budget), plan.key).toBe(true);
      const field = cap ?? LARGEST_DAY_FIELD;
      expect(takenOf(field + 8, budget), `${plan.key}: ${field} + 8`).toBe(field + 8);
    }
  });
});

describe("one rule, one place: only `entryLinkBudget` sizes a link's budget", () => {
  const SRC = join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(path);
      } else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk(SRC);
  const rel = (p: string) => p.slice(process.cwd().length + 1).replace(/\\/g, "/");
  const read = (p: string) => readSource(rel(p));

  it("finds the sources at all, so an empty sweep cannot pass", () => {
    expect(files.length).toBeGreaterThan(200);
    // CONTROL: the sweep sees the one place that does read the floor.
    expect(read(join(SRC, "lib", "domain", "rate-limit.ts"))).toMatch(/RATE_LIMITS\["register-token"\]/);
  });

  it("reads the link's floor nowhere but the rule and the limiter", () => {
    const allowed = new Set(["src/lib/domain/rate-limit.ts"]);
    const readers = files.filter((f) => /RATE_LIMITS\[\s*["']register-token["']\s*\]/.test(read(f)));
    expect(readers.map(rel).filter((f) => !allowed.has(f))).toEqual([]);
  });

  it("asks the rule from the one service, and the action asks the service", () => {
    const callers = files.filter((f) => /\bentryLinkBudget\(/.test(read(f)));
    expect(callers.map(rel).sort()).toEqual(["src/lib/domain/rate-limit.ts", "src/lib/services/registration.ts"]);
    expect(read(join(SRC, "app", "actions", "register.ts"))).toMatch(
      /checkRateLimit\("register-token", cleanToken, \(\) => entryLinkBudgetFor\(cleanToken\)\)/,
    );
  });
});
