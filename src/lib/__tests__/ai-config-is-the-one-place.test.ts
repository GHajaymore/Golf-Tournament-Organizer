import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";
import { aiAccount, aiKey, jobStatus, JOBS, PROVIDERS } from "@/lib/ai-config";

/**
 * THE AI ACCOUNT IS CONFIGURATION, AND IT LIVES IN ONE FILE.
 *
 * Ajay, 2026-11-03: run the app's AI on his own Claude account now, and replace
 * it with the app's own account before or after launch. That is only a change
 * of environment values if no other file names a model, a provider's key
 * variable, or the account label — the day one does, switching the account is
 * a code change again, and the copy nobody remembers keeps spending on the old
 * account. So this sweep refuses all three outside `src/lib/ai-config.ts`.
 */

const CONFIG = join("src", "lib", "ai-config.ts");

/** A model id written as a string: "claude-haiku-5-5", 'claude-sonnet-5', … */
const MODEL_ID = /["'`]claude-(?:opus|sonnet|haiku|fable|mythos|instant)-[0-9][a-z0-9.-]*["'`]/;
/** An AI provider's key or the account label, named anywhere in code (a read, a message, a lookup). */
const KEY_NAME = /\b(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|AI_ACCOUNT_LABEL|GROQ_API_KEY|XAI_API_KEY|AI_GATEWAY_API_KEY)\b/;

function aiConfigOffences(code: string): string[] {
  const found: string[] = [];
  const m = code.match(MODEL_ID);
  if (m) found.push(`model id ${m[0]}`);
  const k = code.match(KEY_NAME);
  if (k) found.push(`key or label ${k[0]}`);
  return found;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      sourceFiles(rel, out);
    } else if (/\.(?:tsx?|mjs|cjs|js)$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

describe("the AI account is decided in one place", () => {
  it("CONTROL: the sweep sees a model id and a key read in code, and not in a comment", () => {
    expect(aiConfigOffences(`const m = "claude-haiku-5-5";`)).toEqual(['model id "claude-haiku-5-5"']);
    expect(aiConfigOffences("const k = process.env.ANTHROPIC_API_KEY;")).toEqual(["key or label ANTHROPIC_API_KEY"]);
    expect(aiConfigOffences(`askClaude({ model: 'claude-sonnet-5', x: env.AI_ACCOUNT_LABEL })`)).toHaveLength(2);
    // Read the way the sweep reads a file: a comment naming them is not an offence.
    expect(aiConfigOffences(stripComments("// set ANTHROPIC_API_KEY, model \"claude-haiku-5-5\"\nconst a = 1;"))).toEqual([]);
    // And it reads the config file itself, which is the one place they are allowed.
    expect(aiConfigOffences(readSource(CONFIG)).length).toBe(2);
  });

  it("no file but ai-config.ts names a model id, a provider key or the account label", () => {
    const files = [...sourceFiles("src"), ...sourceFiles("scripts")].filter((f) => f !== CONFIG);
    expect(files.length, "the sweep must have files to read").toBeGreaterThan(100);
    const offenders = files
      .map((f) => ({ f, why: aiConfigOffences(readSource(f)) }))
      .filter((o) => o.why.length > 0)
      .map((o) => `${o.f}: ${o.why.join(", ")}`);
    expect(offenders, "name a JOB and read the model and key from src/lib/ai-config.ts").toEqual([]);
  });
});

describe("what the owner is told about the account", () => {
  const SECRET = "sk-ant-test-0123456789abcdef";

  it("never contains the key or any part of it", () => {
    const said = JSON.stringify(aiAccount({ ANTHROPIC_API_KEY: SECRET, AI_ACCOUNT_LABEL: "Test account" }));
    expect(said).not.toContain(SECRET);
    for (let i = 0; i + 6 <= SECRET.length; i++) expect(said).not.toContain(SECRET.slice(i, i + 6));
    expect(said).toContain("Test account");
  });

  it("is on with a key and off without one, saying why", () => {
    expect(jobStatus("cardReading", { ANTHROPIC_API_KEY: SECRET }).on).toBe(true);
    const off = jobStatus("cardReading", {});
    expect(off.on).toBe(false);
    if (!off.on) expect(off.why).toMatch(/No ANTHROPIC_API_KEY is set/);
    expect(aiKey("commentary", {})).toBeNull();
    expect(aiKey("commentary", { ANTHROPIC_API_KEY: ` ${SECRET} ` })).toBe(SECRET);
  });

  it("keeps report drafting off until its provider is connected, whatever keys are set", () => {
    const s = jobStatus("reportDraft", { ANTHROPIC_API_KEY: SECRET });
    expect(s.on).toBe(false);
    if (!s.on) expect(s.why).toMatch(/not connected yet/);
    expect(aiKey("reportDraft", { ANTHROPIC_API_KEY: SECRET })).toBeNull();
  });

  it("never runs card reading on a provider that cannot read photographs", () => {
    for (const [job, j] of Object.entries(JOBS)) {
      if (j.needsImages && PROVIDERS[j.provider].callable) {
        expect(PROVIDERS[j.provider].readsImages, job).toBe(true);
      }
    }
  });
});
