import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { stripComments } from "./source";

/**
 * A SERVER FILE MAY IMPORT A COMPONENT FROM A "use client" FILE, NEVER A FUNCTION OR A CONSTANT.
 *
 * On the server, everything a "use client" module exports is a client reference. Rendering one as a
 * component is the point; CALLING one (or reading a constant) throws "Attempted to call
 * scopeLockBannerDrawn() from the server" and the page answers 500. It typechecks, it unit-tests
 * (vitest has no server/client boundary), and only a running server finds it: R9a took down the tee
 * sheet and the draw page that way.
 *
 * A pure rule shared by both sides lives in a module with no directive (`scope-lock-rules.ts`).
 * This sweep reads every .tsx under src/app and src/components WITHOUT "use client" and refuses a
 * value import from a "use client" module unless the name is a component (PascalCase). Types are free.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const isClient = (src: string) => /^\s*["']use client["']/.test(src.split("\n").find((l) => l.trim().length > 0) ?? "");

function resolveModule(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base + ".tsx", base + ".ts", join(base, "index.tsx"), join(base, "index.ts")]) if (existsSync(c)) return c;
  return null;
}

const IMPORT = /import\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/g;

/** The value names imported by one clause: `{ A, type B, c as D }`, a default, or both. */
function valueNames(clause: string): string[] {
  const names: string[] = [];
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const t = part.trim();
      if (!t || /^type\s/.test(t)) continue;
      names.push(t.split(/\s+as\s+/)[0].trim());
    }
  }
  const def = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
  if (def && !def.startsWith("*")) names.push(def);
  return names;
}

/** Returns what a server file wrongly imports from client modules, as `file: name from module`. */
export function serverImportsOfClientValues(files: Array<{ path: string; src: string }>, readClient: (p: string) => boolean): string[] {
  const bad: string[] = [];
  for (const { path, src } of files) {
    const code = stripComments(src);
    for (const m of code.matchAll(IMPORT)) {
      const target = resolveModule(path, m[2]);
      if (!target || !readClient(target)) continue;
      for (const name of valueNames(m[1])) {
        if (!/^[A-Z][a-z0-9]/.test(name) || /^[A-Z0-9_]+$/.test(name)) bad.push(`${path.slice(SRC.length + 1).split(sep).join("/")}: ${name} from ${m[2]}`);
      }
    }
  }
  return bad;
}

describe("a server file never calls a function exported from a use-client file", () => {
  const all = walk(join(SRC, "app")).concat(walk(join(SRC, "components"))).filter((p) => p.endsWith(".tsx"));
  const sources = all.map((path) => ({ path, src: readFileSync(path, "utf8") }));
  const clientCache = new Map<string, boolean>();
  const readClient = (p: string) => {
    if (!clientCache.has(p)) clientCache.set(p, isClient(readFileSync(p, "utf8")));
    return clientCache.get(p)!;
  };
  const servers = sources.filter((s) => !isClient(s.src));

  it("finds the files (a broken read would make the sweep vacuous)", () => {
    expect(servers.length).toBeGreaterThan(50);
  });

  it("imports only components from client modules", () => {
    expect(serverImportsOfClientValues(servers, readClient)).toEqual([]);
  });

  it("CONTROL: the sweep sees the R9a shape (a lowercase function imported from a client module)", () => {
    const fake = { path: join(SRC, "components", "setup", "LockedOnce.tsx"), src: 'import { ScopeLockBanner, scopeLockBannerDrawn } from "@/components/ScopeLockBanner";' };
    const found = serverImportsOfClientValues([fake], (p) => p.endsWith("ScopeLockBanner.tsx"));
    expect(found).toEqual(["components/setup/LockedOnce.tsx: scopeLockBannerDrawn from @/components/ScopeLockBanner"]);
  });
});
