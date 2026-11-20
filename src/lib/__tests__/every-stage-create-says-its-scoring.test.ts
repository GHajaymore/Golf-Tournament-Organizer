import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { CLONED_STAGE_FIELDS } from "../services/clone";
import { roundScoring, scoringDefaults } from "../domain/round-scoring";

/**
 * EVERY NEW ROUND SAYS WHO KEEPS ITS CARD (2026-11-04, sprint 2 part B).
 *
 * `Stage.scoreKeeping` and `Stage.endCheck` default, in the COLUMN, to what
 * every round did before they existed ("each", "off") — so a round that was
 * already being played keeps behaving as it did. A NEW round starts from
 * `scoringDefaults(shape)`: one scorer per group, the end-of-round check on
 * for a tournament and off for a casual round. A create that forgets it makes
 * a round with the OLD behaviour, silently, and nothing on any screen says so.
 *
 * Seven places made a Stage on the day this was written (match-setup, the
 * setup suggestion, add-a-round, the copy, a new tournament's rounds, and the
 * demo club's two). Each must spread `scoringDefaults(…)` — or, for the copy,
 * carry the source round's own choice through `CLONED_STAGE_FIELDS`.
 */

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The argument of every `stage.create(` / `createMany(` / `upsert(` call, balanced. */
export function stageCreates(src: string): string[] {
  const out: string[] = [];
  const re = /\.stage\.(create|createMany|upsert)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
      i += 1;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** Whether one create says its scoring: the defaults, or the copied round's own. */
export function saysItsScoring(body: string, fileSrc: string): boolean {
  if (body.includes("scoringDefaults(")) return true;
  return /\.\.\.round\b/.test(body) && fileSrc.includes("CLONED_STAGE_FIELDS");
}

describe("every Stage create says who keeps the card and who checks it", () => {
  const files = filesUnder("src");

  it("each create spreads scoringDefaults, or carries the copied round's own", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = readSource(f);
      for (const body of stageCreates(src)) {
        seen += 1;
        if (!saysItsScoring(body, src)) missing.push(`${f}: ${body.slice(0, 60).replace(/\s+/g, " ")}…`);
      }
    }
    expect(missing, "a new round would start with the old behaviour: spread ...scoringDefaults(shape)").toEqual([]);
    // CONTROL on the reader: it finds the creates there are (seven on 2026-11-04).
    expect(seen).toBeGreaterThanOrEqual(7);
  });

  it("the copy carries both fields", () => {
    expect(CLONED_STAGE_FIELDS).toContain("scoreKeeping");
    expect(CLONED_STAGE_FIELDS).toContain("endCheck");
  });

  it("CONTROL: the sweep sees a create that forgets, and is satisfied by the defaults", () => {
    const forgot = `await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round" } });`;
    const said = `await prisma.stage.create({ data: { eventId, position: 0, ...scoringDefaults(event.shape) } });`;
    expect(stageCreates(forgot)).toHaveLength(1);
    expect(saysItsScoring(stageCreates(forgot)[0], forgot)).toBe(false);
    expect(saysItsScoring(stageCreates(said)[0], said)).toBe(true);
    // A nested call inside the data does not cut the body short.
    const nested = `prisma.stage.createMany({ data: rounds.map((r) => ({ ...r, ...scoringDefaults(shape) })) })`;
    expect(saysItsScoring(stageCreates(nested)[0], nested)).toBe(true);
  });
});

describe("the defaults and the reader", () => {
  it("a tournament starts with one scorer per group and the check on; a casual round with it off", () => {
    expect(scoringDefaults("single")).toEqual({ scoreKeeping: "group", endCheck: "on" });
    expect(scoringDefaults("series")).toEqual({ scoreKeeping: "group", endCheck: "on" });
    expect(scoringDefaults("match")).toEqual({ scoreKeeping: "group", endCheck: "off" });
  });

  it("a stored value the app does not know reads as the column's default — today's behaviour", () => {
    expect(roundScoring({ scoreKeeping: "nonsense", endCheck: "maybe" })).toEqual({ scoreKeeping: "each", endCheck: "off" });
    expect(roundScoring({ scoreKeeping: null, endCheck: null })).toEqual({ scoreKeeping: "each", endCheck: "off" });
    expect(roundScoring({ scoreKeeping: " organizer ", endCheck: "on" })).toEqual({ scoreKeeping: "organizer", endCheck: "on" });
  });
});
