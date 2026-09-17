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

/**
 * THE OTHER WAY A REFUSAL VANISHES: `void`.
 *
 * The cells above ban reporting a refusal only when it carries words. This
 * bans throwing the whole answer away — `void someAction(...)` discards `ok`,
 * `error` and `needsConfirm` together, so the control appears to work, the
 * server saved nothing, and the screen goes on showing the value it refused.
 *
 * Found by sweeping the class after one instance: `setStageCourse` ASKS FOR
 * CONFIRMATION on a round holding cards, and the venue dropdown voided the
 * answer — the one control of the four on that screen where the guard existed
 * and nobody listened. `setMatchCourse` and `setFlightCaptain` were the same
 * shape with plain refusals.
 *
 * The remaining sites are listed rather than hidden. Each entry is an action
 * whose refusal a screen currently drops, with the reason it is tolerable —
 * and the test refuses an entry whose action has since learned to ask for
 * confirmation, because that is the case nobody may ignore.
 */
const VOID_CALLS: Record<string, string> = {
  // Never refuses: it writes and returns nothing.
  markThreadRead: "returns void",
  setMatchTiebreakers: "cannot refuse — writes and returns",
  rotatePublicToken: "cannot refuse — writes and returns",
  removeSignup: "returns a status string, and the row disappears either way",
  setRegistrationOverride: "cannot refuse — writes and returns",
  setRegistrationOpen: "cannot refuse — writes and returns",
  setRegistrationApproval: "cannot refuse — writes and returns",
  setRequirePhone: "cannot refuse — writes and returns",
  approveSignup: "cannot refuse — writes and returns",
  disputeMatch: "cannot refuse — writes and returns",
  reopenMatch: "cannot refuse — writes and returns",
  // The FORCED delete, from inside the confirmation it already asked for.
  removeStage: "the force path, behind the confirmation it already showed",
  setStageOptDeadline: "refuses only a malformed date the picker cannot produce",
};

describe("an action whose answer is thrown away", () => {
  /** `void someAction(` where `someAction` was imported from the actions. */
  function voidCalls(file: string): string[] {
    const src = readSource(file);
    const imported = new Set<string>();
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@\/app\/actions\/[^"]+"/g)) {
      for (const name of m[1].split(",")) {
        const clean = name.trim().split(" as ").pop()?.trim();
        if (clean && !clean.startsWith("type ")) imported.add(clean);
      }
    }
    if (imported.size === 0) return [];
    const found: string[] = [];
    for (const line of src.split("\n")) {
      const m = line.match(/\bvoid\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (m && imported.has(m[1])) found.push(m[1]);
    }
    return found;
  }

  const calls = sourceFiles().flatMap((f) => voidCalls(f).map((name) => ({ file: f, name })));

  it("finds them — the control", () => {
    /**
     * A sweep that finds nothing may be broken rather than satisfied. These
     * are known-present today; if the list empties, check the sweep before
     * believing the app.
     */
    expect(calls.length).toBeGreaterThan(0);
  });

  it("is one the screen has a stated reason to ignore", () => {
    const unlisted = calls.filter((c) => !(c.name in VOID_CALLS)).map((c) => `${c.file}: ${c.name}`);
    expect(
      unlisted,
      "report the refusal, or add it to VOID_CALLS with the reason it cannot matter",
    ).toEqual([]);
  });

  it("never drops an answer that asks for confirmation", () => {
    /**
     * The dangerous half, and the reason this test exists. An action that can
     * come back `needsConfirm` has REFUSED and is waiting to be asked again —
     * dropping that answer means the click did nothing at all and the screen
     * says so nowhere. `removeStage` is exempt because its `void` call IS the
     * second ask.
     */
    const actionSrc = readdirSync(join(process.cwd(), "src/app/actions"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readSource(join("src/app/actions", f)))
      .join("\n");

    const asksConfirmation = (name: string): boolean => {
      const at = actionSrc.indexOf(`export async function ${name}(`);
      if (at < 0) return false;
      const next = actionSrc.indexOf("export async function ", at + 1);
      return /needsConfirm/.test(actionSrc.slice(at, next < 0 ? undefined : next));
    };

    const dropped = calls
      .filter((c) => c.name !== "removeStage" && asksConfirmation(c.name))
      .map((c) => `${c.file}: ${c.name}`);
    expect(
      dropped,
      "this action asks for confirmation and the screen throws the question away",
    ).toEqual([]);
  });
});
