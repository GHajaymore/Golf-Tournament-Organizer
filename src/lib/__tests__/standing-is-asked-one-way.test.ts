import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * MEMBER OR GUEST IS ASKED ONE WAY (the no-email player identity, PR 1).
 *
 * Under Ajay's ruling of 2026-11-07 a member may have no email, so a blank email proves nothing
 * about who somebody is. The standing is stored (`Player.standing`, A039) and decided in ONE
 * place, `domain/entry-standing.ts` (`entryStanding` for a stored entry, `defaultStanding` for a
 * CSV row). This sweep refuses the shape of a second decision anywhere else: member or guest
 * worked out FROM an email — a ternary on an email giving "member"/"guest", an `if` on an email
 * setting a standing, or a guest flag assigned from an email's absence.
 *
 * The reverse direction is allowed and common: an email worked out from a standing ("a guest's
 * entry holds no email") is what keeps a guest's address away from a sign-in.
 */

const DECIDES_FROM_EMAIL: RegExp[] = [
  // email ? "member" : "guest"   /   !p.email ? GUEST : MEMBER
  /email[^?;\n]*\?\s*(["'`](member|guest)["'`]|\bGUEST\b|\bMEMBER\b)/i,
  // if (!email) standing = "guest"
  /if\s*\([^)\n]*email[^)\n]*\)\s*\{?\s*[\w.]*standing\s*=\s*["'`](guest|member)/i,
  // const guest = !p.email   /   isGuest = email === ""
  /\b\w*guest\w*\s*=\s*!?\s*\(?\s*[\w.]*email/i,
];

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const THE_ONE_PLACE = "src/lib/domain/entry-standing.ts";

describe("member or guest is decided in one place", () => {
  const files = walk(join(ROOT, "src")).map((f) => relative(ROOT, f).split("\\").join("/"));

  it("has source to sweep (control)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain(THE_ONE_PLACE);
  });

  it("sees each shape it bans (control)", () => {
    const shapes = [
      'const standing = row.email ? "member" : "guest";',
      "standing: !p.email.trim() ? GUEST : MEMBER,",
      'if (!email) standing = "guest";',
      "const guest = !p.email;",
      'const isGuestRow = email === "";',
    ];
    for (const s of shapes) expect(DECIDES_FROM_EMAIL.some((re) => re.test(s)), s).toBe(true);
    // And lets the reverse direction through: an email from a standing.
    for (const ok of [
      'const entryEmail = standing === GUEST ? "" : email;',
      'const cleanEmail = guest ? "" : String(input.email ?? "");',
    ]) {
      expect(DECIDES_FROM_EMAIL.some((re) => re.test(ok)), ok).toBe(false);
    }
  });

  it("finds no second decision outside entry-standing.ts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === THE_ONE_PLACE) continue;
      const src = readSource(...(file.split("/") as [string, ...string[]]));
      src.split("\n").forEach((line, i) => {
        if (DECIDES_FROM_EMAIL.some((re) => re.test(line))) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, "decide member or guest through domain/entry-standing.ts, never from an email").toEqual([]);
  });
});
