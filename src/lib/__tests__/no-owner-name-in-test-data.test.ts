import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE OWNER'S NAME IS NOT A SAMPLE PLAYER (Hard rule 2: the repository is public).
 *
 * The owner's own name sat in the e2e fixture, two specs and the style guide
 * as the short plain Latin name in a deliberately varied field. It is a real
 * person's name, so it was replaced with an invented one ("Ned Calloway").
 * This sweep keeps it replaced: the owner's full name, his surname, and the
 * short spelling may not be written into e2e/, scripts/, src/ or prisma/ again — comments
 * included, because a name in a comment is just as public.
 *
 * The strings are assembled at run time so this file does not contain what it
 * bans. The history of the repository still holds the old name; this cannot
 * change that, only stop it coming back.
 */

const SURNAME = ["Mo", "ore"].join("");
const FIRST = ["A", "j"].join("");
const BANNED: { what: string; re: RegExp }[] = [
  { what: "the owner's full name", re: new RegExp(`\\b${FIRST}\\.?\\s+${SURNAME}\\b`, "i") },
  { what: "the owner's surname", re: new RegExp(`\\b${SURNAME}\\b`, "i") },
];

const ROOT = process.cwd();
const ROOTS = ["e2e", "scripts", "src", "prisma"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-ci", ".next-e2e", "test-results"]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|md|css|prisma|yml|yaml|txt)$/;
// This file spells the pieces apart on purpose; it is still scanned, so a slip here shows.

function files(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) files(p, out);
    else if (TEXT.test(n)) out.push(p);
  }
  return out;
}

export function findOwnerName(text: string): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const b of BANNED) if (b.re.test(line)) hits.push(`line ${i + 1}: ${b.what}`);
  });
  return hits;
}

describe("the owner's real name is not test data", () => {
  it("CONTROL: the sweep can see the name, the surname and the short spelling", () => {
    expect(findOwnerName(`const f = ["${FIRST} ${SURNAME}"];`).length).toBeGreaterThan(0);
    expect(findOwnerName(`name: "${FIRST}. ${SURNAME}"`).length).toBeGreaterThan(0);
    expect(findOwnerName(`// ${SURNAME} led the field`).length).toBeGreaterThan(0);
    expect(findOwnerName(`const f = ["Ned Calloway"];`)).toEqual([]);
  });

  it("CONTROL: the sweep reads files (it is not walking an empty tree)", () => {
    const all = ROOTS.flatMap((r) => files(join(ROOT, r)));
    expect(all.length).toBeGreaterThan(200);
  });

  it("no file in e2e/, scripts/, src/ or prisma/ names him", () => {
    const found: string[] = [];
    for (const r of ROOTS) {
      for (const f of files(join(ROOT, r))) {
        for (const h of findOwnerName(readFileSync(f, "utf8"))) {
          found.push(`${relative(ROOT, f).split(sep).join("/")} ${h}`);
        }
      }
    }
    expect(found, "a real person's name in a public repository — use an invented one").toEqual([]);
  });
});
