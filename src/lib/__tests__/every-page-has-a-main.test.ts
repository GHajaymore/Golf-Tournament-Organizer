import { describe, it, expect } from "vitest";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY PAGE HAS ONE MAIN LANDMARK (2026-10-08).
 *
 * The console and the player app get theirs from their layouts. The pages
 * that stand on their own did not: the public board a club sends every
 * member, the casual round's /play, the public registration form, choosing a
 * tournament, starting a round, the account page and the password reset. A
 * screen reader had no way to jump past the header to the content on any of
 * them. Found by a probe that waited for `main` on /live and waited for ever.
 *
 * Swept from the filesystem, so a standalone page added later is covered the
 * day it exists. A page counts as having one if its own source renders
 * `<main`, or it renders a component of ours that does.
 */
const APP = join(process.cwd(), "src", "app");
// The two route groups whose layouts supply the landmark.
const GROUPED = ["(app)", "(player)"];
// Internal, unlinked, and a catalogue of components rather than a page.
const EXEMPT = new Set(["styleguide"]);

function pages(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!rel && (GROUPED.includes(name) || EXEMPT.has(name) || name === "api" || name === "actions")) continue;
      out.push(...pages(full, rel ? `${rel}/${name}` : name));
    } else if (name === "page.tsx") {
      out.push(rel ? `${rel}/page.tsx` : "page.tsx");
    }
  }
  return out;
}

const rendersMain = (src: string) => /<main[\s>]/.test(src);

function componentsOf(src: string): string[] {
  return [...src.matchAll(/from "@\/components\/([A-Za-z]+)"/g)].map((m) => m[1]);
}

describe("every standalone page", () => {
  const found = pages(APP);

  it("is found at all (control)", () => {
    expect(found).toContain("live/[token]/page.tsx");
    expect(found).toContain("play/page.tsx");
    expect(found.some((p) => p.startsWith("(app)"))).toBe(false);
  });

  for (const page of found) {
    it(`${page} renders a main landmark`, () => {
      const src = readSource("src", "app", ...page.split("/"));
      const via = componentsOf(src).filter((c) => {
        const file = join(process.cwd(), "src", "components", `${c}.tsx`);
        return existsSync(file) && rendersMain(readSource("src", "components", `${c}.tsx`));
      });
      expect(rendersMain(src) || via.length > 0, `${page} has no <main>, directly or through a component`).toBe(true);
    });
  }
});
