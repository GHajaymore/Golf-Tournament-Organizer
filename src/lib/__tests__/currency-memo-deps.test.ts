import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A memo that parses money must depend on the parser.
 *
 * `useMoney()` hands back closures BOUND TO THE CLUB'S CURRENCY — `parse`
 * turns "500" into 50,000 minor units under the dollar and into 500 under the
 * yen. They are memoized on the currency, so each one takes a NEW IDENTITY the
 * moment the club's currency changes.
 *
 * The trap is that this looks like a stale-closure warning nobody needs to
 * act on, because "the club's currency doesn't change while you're looking at
 * a screen". It does. Every money action ends in `revalidatePath("/",
 * "layout")`, the layout re-reads the club's currency, and the new value
 * arrives in context WITHOUT unmounting the screen — React keeps client state
 * across a server re-render, which is the whole point of it. So a `useMemo`
 * that calls `parse` but does not list it goes on returning amounts parsed in
 * the currency the club used to be in, while every unmemoized amount beside it
 * has already moved to the new one.
 *
 * MoneyClient had exactly this on its `shares` and `payers` memos, and the
 * visible symptom is the worst kind: the exact-split total disagrees with the
 * bill by a factor of a hundred, so a split whose numbers plainly add up on
 * screen refuses to submit and the person typing it has nothing to correct.
 *
 * Enforced from the filesystem rather than remembered, like the currency and
 * brand-mark sweeps, because a dependency array is precisely the thing an
 * editor drops without noticing — and `react-hooks/exhaustive-deps` is a
 * WARNING, so the build stays green while it is wrong.
 */

const ROOTS = [join(process.cwd(), "src", "components"), join(process.cwd(), "src", "app")];

/** Every .tsx under the roots, so a screen added tomorrow is swept too. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * The local names taken from `useMoney()`, renames included.
 *
 * `parse: centsFrom` is the real case — MoneyClient renames it so the call
 * sites read as arithmetic — and a checker that only looked for `parse` would
 * have found nothing in the one file that had the bug.
 */
function moneyBindings(src: string): string[] {
  const names: string[] = [];
  const re = /(?:const|let)\s*\{([^}]*)\}\s*=\s*useMoney\(\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      // `parse: centsFrom` binds `centsFrom`; a bare `money` binds `money`.
      const renamed = piece.split(":");
      names.push((renamed[1] ?? renamed[0]).trim());
    }
  }
  return names.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

/**
 * Walk from a call's opening paren to its matching close, skipping anything
 * inside a string, a template literal or a comment.
 *
 * A regex cannot do this: the memo bodies here contain JSX, nested calls and
 * apostrophes in comments, all of which unbalance a naive count.
 */
function callSpan(src: string, openParen: number): { body: string; end: number } | null {
  let depth = 0;
  let i = openParen;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) return null;
      continue;
    }
    if (c === "/" && next === "*") {
      i = src.indexOf("*/", i);
      if (i === -1) return null;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(openParen + 1, i), end: i };
    }
    i++;
  }
  return null;
}

/** The dependency array of a hook call: the last top-level `[...]` in it. */
function depsOf(body: string): string | null {
  const close = body.lastIndexOf("]");
  if (close === -1) return null;
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = body[i];
    if (c === "]") depth++;
    else if (c === "[") {
      depth--;
      if (depth === 0) return body.slice(i, close + 1);
    }
  }
  return null;
}

describe("a memo that parses money depends on the parser", () => {
  const files = ROOTS.flatMap(tsxFiles);

  it("finds the screens", () => {
    // A broken read would make the sweep below vacuous, which is the failure
    // mode of every filesystem guard.
    expect(files.length).toBeGreaterThan(20);
  });

  it("lists every useMoney() value a hook body uses in that hook's deps", () => {
    const offenders: string[] = [];

    for (const full of files) {
      const src = readFileSync(full, "utf8");
      const bindings = moneyBindings(src);
      if (!bindings.length) continue;

      const hook = /\buse(?:Memo|Callback)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = hook.exec(src))) {
        const openParen = src.indexOf("(", m.index + m[0].length - 1);
        const span = callSpan(src, openParen);
        if (!span) continue;
        const deps = depsOf(span.body);
        // No dependency array at all means "recompute every render", which is
        // never stale. Nothing to enforce.
        if (!deps) continue;
        const code = span.body.slice(0, span.body.lastIndexOf(deps));

        for (const name of bindings) {
          const used = new RegExp(`\\b${name}\\s*\\(`).test(code);
          const listed = new RegExp(`\\b${name}\\b`).test(deps);
          if (used && !listed) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push(
              `${full.replace(process.cwd(), "").replace(/\\/g, "/")}:${line} calls ${name}() ` +
                `but its deps are ${deps.replace(/\s+/g, " ")}`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      "these memos keep amounts parsed in the club's PREVIOUS currency after it changes:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
