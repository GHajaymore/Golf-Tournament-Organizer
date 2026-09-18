import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A CLIENT COMPONENT IS STILL SERVER-RENDERED, AND THE CLOCK MOVES BETWEEN.
 *
 * `"use client"` says where a component becomes interactive, not where it is
 * first drawn: Next.js renders it on the server for the initial HTML and React
 * renders it again on the client to hydrate. Anything read from the clock
 * during render is therefore read TWICE, at two different instants — and when
 * the two land either side of a boundary the component cares about, the text
 * differs and React throws away the server HTML for that subtree:
 *
 *     Minified React error #418 ... args[]=text
 *
 * That appeared SEVEN TIMES in one CI run on 2026-09-18, in a log whose actual
 * failure was the documented Chromium SEGV, and it had never reproduced on
 * demand — because it needs a minute boundary (or a 48-hour one) to fall
 * between the two renders, which is a race nobody can schedule.
 *
 * Two components were doing it:
 *
 *   MessagesClient      `when()` called `Date.now()` in the body of the
 *                       function that formats every timestamp in the thread
 *                       list. A message posted 59 seconds before the response
 *                       was written went out as "now" and hydrated as "1m".
 *   RegistrationClient  `PromotedBadge` computed a 48-hour deadline the same
 *                       way, under a comment saying it was "rendered on the
 *                       client on purpose" — which is the misconception this
 *                       file is named after.
 *
 * `LiveRefresh` had already solved it and written down why, which is the part
 * worth noticing: the knowledge was in the repository and the class was never
 * swept. Hence a sweep.
 *
 * THE RULE IS A REGISTER, not a scope analysis. Telling "inside `useEffect`"
 * from "during render" needs a parser, and a regex that tries is the kind of
 * sweep CLAUDE.md records shipping while measuring nothing. So instead: every
 * client component that touches the clock is listed here with a reason and a
 * COUNT. A new file goes red, and so does a new read inside a file already
 * listed — which is the hole a bare file allowlist would leave open.
 */

/** Read through `readSource`: three of these files discuss `Date.now()` in prose. */
const CLOCK = ["new Date()", "Date.now()", "Math.random()"];

const ALLOWED: Record<string, { reads: number; why: string }> = {
  "src/components/LiveRefresh.tsx": {
    reads: 2,
    why: "mount-only state plus its one-second tick, both inside useEffect — the component that documented this bug",
  },
  "src/components/MessagesClient.tsx": {
    reads: 2,
    why: "mount-only state plus its one-minute tick, both inside useEffect; `when` takes the clock as an argument",
  },
  "src/components/RegistrationClient.tsx": {
    reads: 1,
    why: "mount-only state inside useEffect; PromotedBadge draws nothing until there is a clock",
  },
  "src/components/FoursomeMaker.tsx": {
    reads: 2,
    why: "stamping savedAt inside save handlers, which run only on the client and never during render",
  },
};

function clientComponents(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) clientComponents(rel, out);
    else if (e.name.endsWith(".tsx") && readSource(rel).includes('"use client"')) out.push(rel);
  }
  return out;
}

function clockReads(file: string): number {
  const src = readSource(file);
  return CLOCK.reduce((n, needle) => n + src.split(needle).length - 1, 0);
}

describe("no client component reads the clock while rendering", () => {
  const FILES = clientComponents("src/components").concat(clientComponents("src/app"));

  it("found the client components at all", () => {
    // The control. A sweep that walks nothing reports a clean app, calmly.
    expect(FILES.length, "no client components found — the walk is broken").toBeGreaterThan(30);
    expect(
      FILES.some((f) => f.endsWith("LiveRefresh.tsx")),
      "a file known to be a client component is missing",
    ).toBe(true);
    expect(clockReads("src/components/LiveRefresh.tsx"), "the counter reads nothing").toBe(2);
  });

  it("has no client component touching the clock that is not accounted for", () => {
    const unlisted = FILES.filter((f) => clockReads(f) > 0 && !ALLOWED[f]);
    expect(
      unlisted,
      `these read the clock with no reason recorded — is it during render?\n  ${unlisted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no NEW clock read inside a component already accounted for", () => {
    const drifted = Object.entries(ALLOWED)
      .map(([file, { reads }]) => ({ file, reads, actual: clockReads(file) }))
      .filter((r) => r.actual !== r.reads)
      .map((r) => `${r.file}: recorded ${r.reads}, found ${r.actual}`);
    expect(
      drifted,
      `the count moved — a read was added or removed, and the reason above may no longer cover it:\n  ${drifted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the register honest about what it lists", () => {
    // An entry for a file that no longer exists, or no longer reads the clock,
    // is a reason protecting nothing — the register has to shrink too.
    const stale = Object.keys(ALLOWED).filter((f) => !FILES.includes(f));
    expect(stale, `listed but not a client component any more: ${stale.join(", ")}`).toEqual([]);
  });
});
