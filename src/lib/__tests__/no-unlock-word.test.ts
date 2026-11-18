import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { readSource } from "./source";

/**
 * ONE WORD FOR CHANGING A LAUNCHED TOURNAMENT: "COMMITTEE CORRECTION" (state machine PR 9b;
 * the simplicity review's amendment 1, 14 Nov).
 *
 * Until 9b the app had two ways to change a tournament after launch — the blanket unlock and
 * the committee correction — and two words for them. 9b removes the blanket ("Lock setup
 * again", "unlocked as a whole"), so the second word goes with it: two words for one idea is
 * how the second idea comes back. This sweep reads what a PERSON reads — every string literal,
 * template and JSX text in the screens (`src/app`, `src/components`) and in the modules that
 * write words for them (the guide, the player's Help, the lock and field refusals) — and
 * refuses "unlock" in any form, and "lock setup again".
 *
 * Read through `readSource` (comments out) and then the TypeScript parser, so a comment
 * explaining the history and an identifier (`configUnlocked`, the wall's class A) are not
 * words on a screen. A literal that is ONE lowercase token (`afterLaunch: "unlock"`, compared
 * and passed as a code value, never drawn) is a value, not a sentence, and is not swept.
 */

const UNLOCK_WORD = /\bunlock(?:ed|s|ing)?\b|\block setup again\b/i;

/** The modules outside the screens whose strings are drawn as words. */
const WORD_MODULES = [
  "src/lib/guide-steps.ts",
  "src/lib/player-help.ts",
  "src/lib/domain/tournament-status.ts",
  "src/lib/domain/field-change.ts",
  "src/lib/domain/launch-check.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) {
      out.push(p.replace(/\\/g, "/"));
    }
  }
  return out;
}

function swept(): string[] {
  return [...walk("src/app"), ...walk("src/components"), ...WORD_MODULES].sort();
}

/** A code value, not a sentence: one lowercase token. */
const CODE_VALUE = /^[a-z][a-z0-9-]*$/;

/** Every piece of text a person could read in this source: string literals, templates, JSX text. */
export function wordsIn(path: string, src: string): string[] {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (!CODE_VALUE.test(node.text)) out.push(node.text);
    } else if (ts.isJsxText(node)) {
      const t = node.text.trim();
      if (t) out.push(t);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The pieces of text that say "unlock" or "lock setup again". */
export function unlockWords(path: string, src: string): string[] {
  return wordsIn(path, src).filter((w) => UNLOCK_WORD.test(w));
}

describe("no screen, refusal, guide or Help says “unlock” (PR 9b, amendment 1)", () => {
  it("CONTROL: a planted label, a sentence, JSX text and a template are seen", () => {
    expect(unlockWords("src/components/Zz.tsx", `export const Zz = () => <button>Unlock the field</button>;`)).toEqual(["Unlock the field"]);
    expect(unlockWords("src/app/zz.ts", `const said = "Setup was unlocked as a whole.";`)).toEqual(["Setup was unlocked as a whole."]);
    expect(unlockWords("src/components/Zz.tsx", `export const Zz = () => <p>Lock setup again</p>;`)).toEqual(["Lock setup again"]);
    expect(unlockWords("src/lib/guide-steps.ts", "const t = `nothing needs ${who} unlocking here`;")).toEqual([" unlocking here"]);
  });

  it("CONTROL: an identifier, a comment, a compared code value and a type are not words on a screen", () => {
    for (const line of [
      `const open = !row.configUnlocked;`,
      `// the blanket unlock was retired in PR 9b`,
      `/** Unlock configuration is gone */ const x = 1;`,
      `if (w.afterLaunch === "unlock") return;`,
      `const step = { afterLaunch: "unlock" as const };`,
      `type When = "open" | "unlock";`,
      `window.addEventListener("pointerdown", unlock, { once: true });`,
    ]) {
      // Planted as written, comments and all: the parser sees no string in a comment.
      expect(unlockWords("src/components/Zz.tsx", line), line).toEqual([]);
    }
  });

  it("CONTROL: the sweep reads the screens and the word modules", () => {
    const files = swept();
    expect(files.length, "too few files — the sweep reads nothing").toBeGreaterThan(300);
    for (const f of ["src/components/LifecycleBar.tsx", "src/components/ScopeLockBanner.tsx", "src/app/actions/tournament.ts", ...WORD_MODULES]) {
      expect(files, f).toContain(f);
    }
    // And what it reads is text: the guide's correction step is found.
    expect(wordsIn("src/lib/guide-steps.ts", readSource("src/lib/guide-steps.ts")).some((w) => w.includes("Make a committee correction"))).toBe(true);
  });

  it("nothing a person reads says it", () => {
    const found = swept()
      .flatMap((f) => unlockWords(f, readSource(f)).map((w) => `${f}: “${w.slice(0, 100)}”`));
    expect(found, "the one word is “committee correction” — say what opens, and how").toEqual([]);
  });
});

