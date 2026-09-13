import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY SERVER ACTION THAT WRITES A MONEY ROW LEAVES A NAME AGAINST IT.
 *
 * The rule is not new — `expenses.ts` has stated it since the 2026-08-12 audit
 * called it out: "EVERY WRITE IS AUDITED. Money actions in this app did not
 * log... A number that changed with nobody's name against it is a number a
 * group cannot resolve an argument about."
 *
 * It was stated in four files and enforced in none, so it held wherever
 * somebody remembered. Swept on 2026-09-13: of 31 actions writing a money row,
 * TEN did not log.
 *
 *   the whole of skins.ts   the commonest bet in club golf. A pot that runs
 *                           every Saturday could be re-priced, emptied or
 *                           deleted, and a player's stake taken or un-taken,
 *                           with nothing recording who did it. Its sibling
 *                           `side-games.ts` — the same money under a different
 *                           name — audits every write and says so in its
 *                           header.
 *
 *   the four prize actions  what a club is putting up and who takes it.
 *                           `setPrizeWinner` awards a named person a sum, and
 *                           "who decided that" had no answer anywhere.
 *
 *   createMatch             writes a pot AND confirmed stakes for everybody in
 *                           it — "what the group just agreed standing on the
 *                           tee" — with nobody's name on the agreement.
 *
 * A RULE YOU MUST REMEMBER IS A RULE THAT WILL BE FORGOTTEN, which this
 * codebase says of itself and proved here. Swept from the filesystem rather
 * than a list, so an action added next month is covered the day it is added.
 */

/**
 * Tables that hold, price, or settle money.
 *
 * TAKEN FROM THE SCHEMA, NOT FROM MEMORY. The throwaway version of this sweep
 * guessed `skinsPotEntry`; the model is `SkinsEntry`, so it silently missed
 * the two actions that write a PLAYER'S STAKE — the sharpest rows in the file
 * it was pointed at. The test below checks every name here still exists.
 */
const MONEY_MODELS = [
  "expense",
  "expenseShare",
  "expensePayment",
  "settlement",
  "sideGame",
  "sideGameEntry",
  "contest",
  "contestEntry",
  "skinsPot",
  "skinsEntry",
  "tournamentFund",
  "prize",
] as const;

const WRITES = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "__tests__") walk(p);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk("src");
  return out;
}

/** Each exported action in a `"use server"` file, with its body. */
function moneyActions(): Array<{ name: string; file: string; body: string; writes: string[] }> {
  const found: Array<{ name: string; file: string; body: string; writes: string[] }> = [];
  for (const file of sourceFiles()) {
    const raw = readFileSync(file, "utf8");
    if (!/^\s*["']use server["']/m.test(raw)) continue;
    /**
     * Comments stripped, for the reason `source-guard.test.ts` exists: several
     * of these actions carry a paragraph explaining the audit rule, and a body
     * that no longer CALLS `logAudit` would still match a plain text search.
     * That is the one failure that looks exactly like a pass.
     */
    const src = readSource(file);
    const starts: Array<{ name: string; at: number }> = [];
    const re = /export\s+async\s+function\s+([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) starts.push({ name: m[1], at: m.index });
    for (let i = 0; i < starts.length; i += 1) {
      const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
      const body = src.slice(starts[i].at, end);
      const writes: string[] = [];
      for (const model of MONEY_MODELS) {
        for (const w of WRITES) if (body.includes(`prisma.${model}.${w}(`)) writes.push(`${model}.${w}`);
      }
      if (writes.length) found.push({ name: starts[i].name, file, body, writes });
    }
  }
  return found;
}

describe("money writes are audited", () => {
  const actions = moneyActions();

  it("finds them at all — the sweep's own control", () => {
    /**
     * WITHOUT THIS THE FILE PASSES VACUOUSLY. A typo in a model name, or a
     * regex that stops matching, makes "0 unaudited actions" true and
     * meaningless — which is exactly how the throwaway version reported the
     * whole app clean while missing `skinsEntry`.
     */
    expect(actions.length, "no money-writing actions found — the sweep is broken").toBeGreaterThan(20);
    const names = actions.map((a) => a.name);
    for (const known of ["addExpense", "recordSettlement", "saveSkinsPot", "setPrizeWinner"]) {
      expect(names, `${known} writes money and the sweep missed it`).toContain(known);
    }
  });

  it("names only models the schema actually has", () => {
    /**
     * The mistake that hid two actions. A name that no longer exists silently
     * narrows the sweep, and nothing else in this file would notice.
     *
     * Through `readSource`, which strips comments — `schema.prisma` is thick
     * with `///` doc blocks that discuss models by name, so a raw search would
     * be satisfied by a sentence ABOUT a model rather than the model. Caught
     * by `source-guard.test.ts` the first time this was run, which is the
     * whole reason that guard sweeps per file.
     */
    const schema = readSource("prisma", "schema.prisma");
    for (const model of MONEY_MODELS) {
      const asModel = model.charAt(0).toUpperCase() + model.slice(1);
      expect(schema, `no model named ${asModel}`).toContain(`model ${asModel} `);
    }
  });

  it("logs every one", () => {
    const silent = actions
      .filter((a) => !/\blogAudit\s*\(/.test(a.body))
      .map((a) => `${a.name} (${a.writes.join(", ")})`)
      .sort();

    expect(
      silent,
      "these change money with nobody's name against it — add a logAudit line saying what changed",
    ).toEqual([]);
  });
});
