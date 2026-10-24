import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SOCIAL_LINKS, socialLink } from "@/lib/social-links";
import { readSource } from "./source";

/**
 * TOURNEYHQ'S SOCIAL ADDRESSES ARE WRITTEN ONCE (2026-10-23).
 *
 * The Facebook Page went into the website footer and the FAQ's contact panel,
 * and more networks are to follow. Every surface reads `lib/social-links.ts`;
 * this file refuses the address typed out anywhere else in `src`, so a renamed
 * page cannot leave one link pointing at the old one.
 *
 * The match is on the address without its scheme and `www.`, ignoring case,
 * so `http://facebook.com/tourneyhq` is caught as well as the canonical form.
 * Comments are stripped (`readSource`), so prose may name a network.
 *
 * Two controls keep the sweep honest: it must FIND the module itself (so the
 * walk reaches the files and the matcher matches real source), and it must
 * catch a differently-spelled copy of each address handed to it directly.
 * Neither control writes an address here: both are built from the list.
 *
 * What it cannot see: an address assembled from pieces at run time, or one
 * outside `src` (e2e, scripts, public).
 */

const ROOT = process.cwd();
const MODULE = join("src", "lib", "social-links.ts");

/** The part of an address that identifies the profile: no scheme, no www, lower case. */
function core(href: string): string {
  return href.toLowerCase().replace("https://", "").replace("http://", "").replace("www.", "");
}

/** Which of the profiles a piece of source writes out. */
function addressesIn(src: string): string[] {
  const lower = src.toLowerCase();
  return SOCIAL_LINKS.filter((s) => lower.includes(core(s.href))).map((s) => s.id);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(name)) out.push(full);
  }
  return out;
}

describe("TourneyHQ's social addresses are written once", () => {
  const hits = sourceFiles(join(ROOT, "src"))
    .map((full) => relative(ROOT, full))
    .filter((rel) => addressesIn(readSource(...rel.split(sep))).length > 0);

  it("control: the sweep finds the module that holds them", () => {
    expect(hits).toContain(MODULE);
  });

  it("control: a copy spelled another way is still caught", () => {
    for (const s of SOCIAL_LINKS) {
      const shouted = `<a href="${s.href.toUpperCase()}">${s.label}</a>`;
      const bare = `const url = "${s.href.replace("https://www.", "http://")}";`;
      expect(addressesIn(shouted)).toEqual([s.id]);
      expect(addressesIn(bare)).toEqual([s.id]);
    }
    expect(addressesIn(`const url = "https://www.example.invalid/zz-social";`)).toEqual([]);
  });

  it("no file but lib/social-links.ts writes one out", () => {
    expect(hits.filter((h) => h !== MODULE)).toEqual([]);
  });

  it("the Facebook Page is the one Ajay named", () => {
    expect(socialLink("facebook").href).toBe(SOCIAL_LINKS[0].href);
    expect(core(socialLink("facebook").href)).toBe(["facebook.com", "tourneyhq"].join("/"));
  });
});
