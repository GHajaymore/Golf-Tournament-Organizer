import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A hook in a server component throws on every request.
 *
 * `SkinsSeason.tsx` had no "use client" and was rendering on the server. A
 * hook was added to it, and /prizes — the organizer's money screen — returned
 * 500 to every visitor. It typechecked. It built. Three thousand tests passed.
 * It reached production, because the only thing that catches this is asking a
 * running server for the page, and the smoke test runs after the unit suite.
 *
 * This is the cheap half of that check: the shape is visible in the source, so
 * it does not need a server to find. It runs in milliseconds with the rest of
 * the suite, which means it fails on the machine where the mistake was made
 * rather than eight minutes later in CI.
 *
 * It does NOT replace `npm run smoke`. That catches the whole class — a const
 * read above its declaration, a null dereference in a server component — of
 * which this is one known member.
 */

const COMPONENTS = join(process.cwd(), "src", "components");

/** React hooks that only work in a client component. */
const HOOK = /\buse(State|Effect|LayoutEffect|Memo|Callback|Ref|Reducer|Context|Transition|DeferredValue|Id|SyncExternalStore|FormStatus|Optimistic|Router|SearchParams|Pathname|SelectedLayoutSegment\w*|Money)\s*\(/;

describe("a hook only ever runs in a client component", () => {
  const files = readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx"));

  it("finds the components", () => {
    // A broken read would make the sweep below vacuous, which is how a guard
    // ends up reporting success about nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it("declares every hook-using component as a client one", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(COMPONENTS, f), "utf8");
      // Comments stripped first: a hook NAMED in a comment is not a call, and
      // several of these files discuss hooks at length.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (!HOOK.test(code)) continue;

      // The directive has to be the first statement in the file. Anywhere
      // else it is an ordinary string expression and does nothing at all —
      // which looks exactly as correct in a diff.
      const firstLine = src.split("\n").find((l) => l.trim().length > 0) ?? "";
      if (!/^\s*["']use client["']/.test(firstLine)) offenders.push(f);
    }
    expect(
      offenders,
      `these call a hook without "use client" as their first line, and will throw on every request:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
