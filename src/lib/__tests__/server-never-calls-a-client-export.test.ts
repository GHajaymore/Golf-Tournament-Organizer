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
function valueNames(clause: string): Array<{ name: string; isDefault: boolean }> {
  const names: Array<{ name: string; isDefault: boolean }> = [];
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const t = part.trim();
      if (!t || /^type\s/.test(t)) continue;
      names.push({ name: t.split(/\s+as\s+/)[0].trim(), isDefault: false });
    }
  }
  const def = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
  if (def && !def.startsWith("*")) names.push({ name: def, isDefault: true });
  return names;
}

/**
 * A name is a COMPONENT only when the client module declares it as one (G1): `function Name(` or `const Name = (`
 * (also `async`, `memo(` and `forwardRef(`). PascalCase alone is not enough: `RoundThirdPlaceShown` is
 * PascalCase and is a function a page would call.
 */
function isDeclaredComponent(clientSrc: string, name: string): boolean {
  if (!/^[A-Z][a-z0-9]/.test(name) || /^[A-Z0-9_]+$/.test(name)) return false;
  const n = name.replace(/[$]/g, "\\$&");
  return new RegExp(`\\bfunction\\s+${n}\\s*[(<]|\\bconst\\s+${n}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\(|memo\\(|forwardRef\\()`).test(stripComments(clientSrc));
}

/**
 * Returns what a server file wrongly imports from client modules, as `file: name from module`.
 * `readClient` answers the client module's source, or null when the module is not a "use client" file.
 * A default import is named by its importer, so it is held to the component's PascalCase only.
 */
export function serverImportsOfClientValues(files: Array<{ path: string; src: string }>, readClient: (p: string) => string | null): string[] {
  const bad: string[] = [];
  for (const { path, src } of files) {
    const code = stripComments(src);
    for (const m of code.matchAll(IMPORT)) {
      const target = resolveModule(path, m[2]);
      if (!target) continue;
      const clientSrc = readClient(target);
      if (clientSrc === null) continue;
      for (const { name, isDefault } of valueNames(m[1])) {
        const ok = isDefault ?/^[A-Z][a-z0-9]/.test(name) && !/^[A-Z0-9_]+$/.test(name) : isDeclaredComponent(clientSrc, name);
        if (!ok) bad.push(`${path.slice(SRC.length + 1).split(sep).join("/")}: ${name} from ${m[2]}`);
      }
    }
  }
  return bad;
}

describe("a server file never calls a function exported from a use-client file", () => {
  // G1: every .ts and .tsx under src/ (tests excepted), not only the pages and components. A service or a
  // helper in src/lib is a server file too, and a lowercase import from a client module breaks it the same way.
  const all = walk(SRC);
  const sources = all.map((path) => ({ path, src: readFileSync(path, "utf8") }));
  const clientCache = new Map<string, string | null>();
  const readClient = (p: string) => {
    if (!clientCache.has(p)) {
      const s = readFileSync(p, "utf8");
      clientCache.set(p, isClient(s) ? s : null);
    }
    return clientCache.get(p)!;
  };
  const servers = sources.filter((s) => !isClient(s.src));

  it("finds the files (a broken read would make the sweep vacuous)", () => {
    expect(servers.length).toBeGreaterThan(500);
    expect(servers.some((s) => s.path.endsWith(".ts"))).toBe(true);
  });

  it("imports only components from client modules", () => {
    expect(serverImportsOfClientValues(servers, readClient)).toEqual([]);
  });

  const CLIENT_SRC = [
    '"use client";',
    "export function ScopeLockBanner() { return null; }",
    "export function scopeLockBannerDrawn() { return true; }",
    "export const Row = () => null;",
  ].join("\n");
  const client = (p: string) => (p.endsWith("ScopeLockBanner.tsx") ? CLIENT_SRC : null);

  it("CONTROL: the sweep sees the R9a shape (a lowercase function imported from a client module)", () => {
    const fake = { path: join(SRC, "components", "setup", "LockedOnce.tsx"), src: 'import { ScopeLockBanner, scopeLockBannerDrawn } from "@/components/ScopeLockBanner";' };
    expect(serverImportsOfClientValues([fake], client)).toEqual(["components/setup/LockedOnce.tsx: scopeLockBannerDrawn from @/components/ScopeLockBanner"]);
  });

  it("CONTROL: a planted src/lib/services/x.ts importing a lowercase name from a client file is caught", () => {
    const fake = { path: join(SRC, "lib", "services", "x.ts"), src: 'import { scopeLockBannerDrawn } from "@/components/ScopeLockBanner";' };
    expect(serverImportsOfClientValues([fake], client)).toEqual(["lib/services/x.ts: scopeLockBannerDrawn from @/components/ScopeLockBanner"]);
  });

  it("CONTROL: a PascalCase name the client module does not declare as a component is caught; declared ones are not", () => {
    const fake = { path: join(SRC, "lib", "services", "y.ts"), src: 'import { Row, ScopeLockBanner } from "@/components/ScopeLockBanner";' };
    expect(serverImportsOfClientValues([fake], client)).toEqual([]);
    const constant = { path: join(SRC, "lib", "services", "z.ts"), src: 'import { MAX_ROWS, Rows } from "@/components/ScopeLockBanner";' };
    const clientConst = (p: string) => (p.endsWith("ScopeLockBanner.tsx") ? '"use client";\nexport const MAX_ROWS = 3;\nexport const Rows = { a: 1 };' : null);
    expect(serverImportsOfClientValues([constant], clientConst)).toEqual([
      "lib/services/z.ts: MAX_ROWS from @/components/ScopeLockBanner",
      "lib/services/z.ts: Rows from @/components/ScopeLockBanner",
    ]);
  });
});
