import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";

/**
 * THE SEALED CODE IS OPENED IN THREE PLACES (J39/J40 PR 3B; Security Lead condition 1, 20 Nov).
 *
 * `unsealCode` turns a pass's sealed entry code back into the code a person types. Its three callers are the guest's
 * retry answer (`actions/guest-entry.ts`), the staff slip (`services/player-link-slips.ts`) and the pass service that
 * defines it (`services/player-link.ts`): none of them a render path. A fourth caller, a waiting screen say, would put a
 * secret into a page anybody holding the cookie can load. Read through `readSource`, so a comment cannot satisfy it.
 *
 * Break-it (seen red): import `unsealCode` in `src/components/GuestWaitingCard.tsx`.
 */

const ALLOWED = new Set(["src/app/actions/guest-entry.ts", "src/lib/services/player-link-slips.ts", "src/lib/services/player-link.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") walk(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(relative(process.cwd(), full).split(sep).join("/"));
  }
  return out;
}

/** The files, among `files` (path to comment-free source), that mention `unsealCode` and are not allowed to. */
export function strayUnseals(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([f, src]) => /\bunsealCode\b/.test(src) && !ALLOWED.has(f))
    .map(([f]) => f);
}

describe("unsealCode has three callers", () => {
  it("control: a planted import is flagged; a clean file and an allowed one are not", () => {
    expect(
      strayUnseals({
        "src/components/GuestWaitingCard.tsx": 'import { unsealCode } from "@/lib/services/player-link";',
        "src/components/Other.tsx": "const x = 1;",
        "src/lib/services/player-link.ts": "export function unsealCode() {}",
      }),
    ).toEqual(["src/components/GuestWaitingCard.tsx"]);
  });

  it("the three allowed files still use it (a renamed function would make the guard vacuous)", () => {
    for (const f of ALLOWED) expect(readSource(f), f).toMatch(/\bunsealCode\b/);
  });

  it("no other file in src names it", () => {
    const files: Record<string, string> = {};
    for (const f of walk(join(process.cwd(), "src"))) files[f] = readSource(f);
    expect(strayUnseals(files)).toEqual([]);
  });
});
