import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A CLIENT COMPONENT DOES NOT READ THE BROWSER INTO A VALUE WHILE IT RENDERS.
 *
 * `const x = typeof window !== "undefined" ? window.… : …` gives the server one
 * answer and the browser another for the SAME render, which is a hydration
 * mismatch: the server's HTML is thrown away or, for an attribute, left wrong.
 * Found 2026-10-06 sweeping for the player shell's intermittent React #418:
 * `RegistrationClient` drew the sign-up link "/register/…" on the server and
 * "https://…/register/…" in the browser on every visit.
 *
 * Read it in an effect, an event handler, or `useSyncExternalStore` with a
 * server snapshot. Choosing a HOOK by environment at module level
 * (`typeof window !== "undefined" ? useLayoutEffect : useEffect`) is not a
 * value in the render and is allowed.
 */

const ROOTS = [join("src", "app"), join("src", "components")];
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );

/** A value computed from `window` behind the environment check. */
const READ = /typeof window !== ["']undefined["']\s*\?\s*window\./g;

export function renderReads(src: string): string[] {
  if (!/^\s*["']use client["']/.test(src)) return [];
  return [...src.matchAll(READ)].map((m) => m[0]);
}

describe("a client component reads the browser after it renders, not while", () => {
  it("no client component computes a value from window behind typeof window", () => {
    const offenders = ROOTS.flatMap(files).flatMap((f) => renderReads(readSource(f)).map((r) => `${f}: ${r}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("CONTROL: catches the shape it is for, and lets a hook choice through", () => {
    expect(renderReads('"use client";\nconst o = typeof window !== "undefined" ? window.location.origin : "";')).toHaveLength(1);
    expect(renderReads('"use client";\nconst useX = typeof window !== "undefined" ? useLayoutEffect : useEffect;')).toHaveLength(0);
    // A server component has no hydration to mismatch.
    expect(renderReads('const o = typeof window !== "undefined" ? window.location.origin : "";')).toHaveLength(0);
  });

  it("the sign-up link is read after hydration", () => {
    const src = readSource(join("src", "components", "RegistrationClient.tsx"));
    expect(src).toMatch(/useSyncExternalStore\(\s*noSubscription,\s*\(\) => window\.location\.origin,\s*\(\) => "",?\s*\)/);
  });
});
