import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A REFUSED ACTION ALWAYS SAYS SOMETHING.
 *
 * Eight components each wrote their own "call the action, show the error"
 * helper, and the copies had drifted. Four of them ended in
 *
 *     if (!res.ok && res.error) setError(res.error);
 *
 * so a refusal carrying NO message set nothing at all: the control does not
 * work, the screen says nothing, and the person clicks it again. Nothing
 * reaches those four in that shape today — every refusal they can receive
 * carries text — but `error` is optional in the signature, so it is one new
 * action away, and the failure is silent by construction rather than by
 * accident.
 *
 * `useAction` is the one copy now, and it always sets something. This stops
 * the shape coming back, in the hook or in a ninth component that writes its
 * own.
 *
 * Not a ban on reading `res.error` — a screen may well want the message for
 * something else. What is banned is making the SHOWING of a refusal
 * conditional on the message existing.
 */

function sourceFiles(dir = "src", out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

describe("a refusal the screen cannot explain", () => {
  it("is still shown, rather than swallowed", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      for (const line of readSource(f).split("\n")) {
        // `!res.ok && res.error` and its variants: the refusal is only
        // reported when the server happened to send words.
        if (/!\s*\w+\.ok\s*&&\s*\w+\.error/.test(line)) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      `show something when an action is refused with no message: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("is reported by the one helper the screens share", () => {
    /**
     * The hook exists, and it falls back. Asserted as PRESENCE here and as
     * absence above, because the two fail differently: a missing fallback is
     * caught by this, and a ninth component writing its own swallowing copy is
     * caught by that.
     */
    const hook = readSource(join("src", "components", "useAction.ts"));
    expect(hook).toMatch(/if \(!res\.ok\) \{\s*setError\(res\.error \?\? "[^"]+"\);/);
  });

  it("is not something eight components decide for themselves any more", () => {
    /**
     * The duplication that allowed the drift. `useAction` is the only place
     * this shape belongs; a component re-declaring it is how three different
     * fallbacks and two different error-clearing positions got into the app in
     * the first place.
     */
    const offenders = sourceFiles().filter(
      (f) =>
        !f.endsWith(join("components", "useAction.ts")) &&
        /const run = \(fn: \(\) => Promise<\{ ok: boolean/.test(readSource(f)),
    );
    expect(offenders, `use useAction() instead: ${offenders.join(", ")}`).toEqual([]);
  });
});
