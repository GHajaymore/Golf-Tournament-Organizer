import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { phoneRequiredFor, upgradeBenefits, PLANS, type PlanKey } from "@/lib/plans";
import { readSource } from "./source";

/**
 * Who has to give a mobile number.
 *
 * THE ORGANIZER DECIDES, PER TOURNAMENT, ON EVERY PLAN (Ajay, 2026-10-21,
 * decisions review A7: "go with your recommendations"). Until that day the
 * free plan forced a mobile on every entrant unless players used Round Codes,
 * and only a paid club could stop asking. A forced mobile costs entries, and
 * the members it turns away are disproportionately the older ones, so the
 * choice is now the club's whatever it pays: `Event.requirePhone`, off by
 * default. A tournament that asks, asks whatever the sign-in.
 *
 * The rule lives in one function because several places create an entrant —
 * the public form, a member's one-tap entry, the organizer's own add, the entry
 * CSV import and picking members off the club roster. Several copies of "is a
 * phone required here" is exactly how a form comes to ask for something the
 * action does not enforce, or refuse something the form said was optional.
 *
 * The plan axis is walked against real rows in
 * `a-free-club-asks-no-mobile-unless-it-chooses.audit.test.ts`; here, the
 * function, what the plans are sold on, and a sweep that no caller hands it a
 * plan again.
 */

const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

describe("whether a mobile is required", () => {
  it("is the tournament's own setting and nothing else", () => {
    expect(phoneRequiredFor(false)).toBe(false);
    expect(phoneRequiredFor(true)).toBe(true);
    // One argument: the plan and the sign-in no longer enter into it, and a
    // second parameter would be a place for them to creep back.
    expect(phoneRequiredFor.length).toBe(1);
  });

  it("the plans it is asked over are all four", () => {
    // CONTROL for the sweeps below: if a plan is added or renamed, they are
    // walking a list that knows it.
    expect([...PLAN_KEYS].sort()).toEqual(["club", "enterprise", "free", "society"]);
  });
});

describe("what a club is sold", () => {
  it.each(PLAN_KEYS)("%s: the mobile is not a reason to upgrade", (k) => {
    // Every plan has the choice, so offering it as a benefit would sell a free
    // club what it already has.
    const benefits = upgradeBenefits(k);
    expect(benefits.some((b) => /mobile|phone/i.test(b))).toBe(false);
  });

  it("CONTROL: the free plan is still offered something, so the list is being read", () => {
    expect(upgradeBenefits("free").length).toBeGreaterThan(0);
  });
});

/** Every .ts/.tsx under src, tests excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** The argument lists of every `phoneRequiredFor(...)` call in a file. */
function callArgs(src: string): string[] {
  const out: string[] = [];
  const re = /phoneRequiredFor\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

describe("nobody asks the plan again", () => {
  const root = join(process.cwd(), "src");
  const files = sourceFiles(root).map((f) => relative(process.cwd(), f));
  const calls = files.flatMap((f) =>
    callArgs(readSource(f))
      .filter((args) => !/^\s*eventRequirePhone\s*:/.test(args)) // the declaration itself
      .map((args) => ({ file: f.replace(/\\/g, "/"), args })),
  );

  it("CONTROL: the sweep recognises the old three-argument shape", () => {
    expect(callArgs('phoneRequiredFor(await planForEvent(id), event.requirePhone, event.playerAccess)')).toEqual([
      "await planForEvent(id), event.requirePhone, event.playerAccess",
    ]);
  });

  it("CONTROL: the sweep finds the callers that create an entrant", () => {
    const where = new Set(calls.map((c) => c.file));
    for (const f of [
      "src/app/actions/enter.ts",
      "src/app/actions/register.ts",
      "src/app/actions/tournament.ts",
      "src/lib/services/registration.ts",
      "src/lib/services/roster.ts",
      "src/app/(app)/registration/page.tsx",
    ]) {
      expect(where.has(f), `${f} asks phoneRequiredFor`).toBe(true);
    }
  });

  it("every call hands it one thing: the tournament's setting", () => {
    const bad = calls.filter((c) => c.args.includes(","));
    expect(bad).toEqual([]);
  });

  it("the free plan's lock is gone from every screen", () => {
    const left = files.filter((f) => /PHONE_REQUIRED_FREE|phoneLocked/.test(readSource(f)));
    expect(left).toEqual([]);
  });
});
