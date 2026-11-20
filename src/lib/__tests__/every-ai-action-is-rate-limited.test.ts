import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY ACTION THAT ASKS THE AI IS RATE-LIMITED BEFORE IT ASKS.
 *
 * The AI budget is ONE monthly account shared by every club (`services/ai-spend.ts`): spent, it
 * switches AI off for everybody until the 1st. So an action that reaches `askClaude` with no
 * `checkRateLimit` ahead of it lets one signed-in person loop it and spend every club's AI
 * (PR #996 security review, R1: `suggestCommentary` had none). Read through `readSource`.
 */

const DIR = join("src", "app", "actions");

interface Fn {
  where: string;
  body: string;
}

/** Every function body, cut at the next top-level function. */
function functionsOf(file: string, src: string): Fn[] {
  const text = "\n" + src.replace(/\r\n/g, "\n");
  return text
    .split(/\n(?=(?:export )?(?:async )?function )/)
    .slice(1)
    .map((piece) => ({ where: `${file}: ${piece.slice(0, piece.indexOf("(")).replace(/^(export )?(async )?function /, "").trim()}`, body: piece }));
}

/** The functions that ask the model and do not ask the limiter first. */
function unthrottled(file: string, src: string): string[] {
  return functionsOf(file, src)
    .filter((f) => f.body.includes("askClaude("))
    .filter((f) => {
      const ask = f.body.indexOf("askClaude(");
      const limit = f.body.indexOf("checkRateLimit(");
      return limit < 0 || limit > ask;
    })
    .map((f) => f.where);
}

describe("every action that asks the AI is rate-limited first", () => {
  it("CONTROL: the sweep sees an action that asks with no limiter, and one that limits first", () => {
    const bare = `export async function a() {\n  const x = await askClaude({ job: "j" });\n}\n`;
    const late = `export async function a() {\n  await askClaude({ job: "j" });\n  await checkRateLimit("k", "u");\n}\n`;
    const ok = `export async function a() {\n  await checkRateLimit("k", "u");\n  await askClaude({ job: "j" });\n}\n`;
    expect(unthrottled("f.ts", bare)).toEqual(["f.ts: a"]);
    expect(unthrottled("f.ts", late)).toEqual(["f.ts: a"]);
    expect(unthrottled("f.ts", ok)).toEqual([]);
  });

  it("a refused draft puts no limiter wording into the commentary box (it sits one press from the public board)", () => {
    const fn = functionsOf("commentary.ts", readSource(DIR, "commentary.ts")).find((f) => f.where.endsWith("suggestCommentary"));
    expect(fn, "suggestCommentary must be found").toBeTruthy();
    expect(fn!.body, "return an empty draft when the limiter refuses, never its message").not.toMatch(/limit\.message|throttleMessage/);
    expect(fn!.body).toMatch(/if \(!limit\.allowed\) return \{ text: "", configured: true \}/);
  });

  it("no action file asks the model without a rate limit ahead of the call", () => {
    const files = readdirSync(join(process.cwd(), DIR)).filter((f) => f.endsWith(".ts"));
    const askers = files.filter((f) => readSource(DIR, f).includes("askClaude("));
    expect(askers.length, "the sweep must see the actions that ask the AI").toBeGreaterThanOrEqual(4);
    const offenders = askers.flatMap((f) => unthrottled(f, readSource(DIR, f)));
    expect(offenders, "add `checkRateLimit(...)` before `askClaude`, as card-photo.ts does").toEqual([]);
  });
});
