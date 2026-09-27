import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * A CONTROL THAT REACHES A LOCK-REFUSING ACTION KNOWS ABOUT THE LOCK.
 *
 * `assertUnlocked` THROWS when setup is locked, and a server action that throws
 * inside a transition takes the whole page down to Next's "Application error".
 * The rule this app runs on is that a locked screen does not offer the control
 * — `SetupLockBanner` says "setup is read-only" — and five screens did not
 * follow it: Rounds & formats, Teams & pairs, the bracket arrangement,
 * Tournament details and Clear scores. Walked 2026-09-27 on the live seeded
 * club (the Registration "Add" button, then the bracket's "Two flights"), then
 * swept: 45 actions refuse a locked tournament, and 34 of them were reachable
 * from a control that stayed live.
 *
 * Swept as a CLASS, so a control added tomorrow is covered the day it lands:
 * every client file that imports an action whose body calls `assertUnlocked`
 * must read the lock itself. Read through `readSource`, so a comment that
 * merely says "locked" cannot satisfy it.
 */

const ROOT = process.cwd();

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p, ext);
    return ext.test(name) ? [p] : [];
  });
}

/** Every exported action whose body refuses a locked tournament. */
function lockRefusingActions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files(join(ROOT, "src", "app", "actions"), /\.ts$/)) {
    const src = readSource(relative(ROOT, f));
    const parts = src.split(/export async function /).slice(1);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("(")).trim();
      // The body up to the next export — `split` already cut it there.
      if (/\bassertUnlocked\(/.test(part)) out.set(name, relative(ROOT, f));
    }
  }
  return out;
}

/** Client files, and which lock-refusing actions each imports. */
function callers(locked: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const client = [
    ...files(join(ROOT, "src", "components"), /\.tsx$/),
    ...files(join(ROOT, "src", "app"), /\.tsx$/),
  ];
  for (const f of client) {
    const src = readSource(relative(ROOT, f));
    if (!/^\s*["']use client["']/.test(src)) continue;
    const names: string[] = [];
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/app\/actions\/[^"']+["']/g)) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (locked.has(name)) names.push(name);
      }
    }
    if (names.length) out.set(relative(ROOT, f).split("\\").join("/"), names);
  }
  return out;
}

/**
 * Files that call a lock-refusing action and need no lock of their own, each
 * with the reason. A reason must be a FACT about where the file renders.
 */
const EXEMPT: Record<string, string> = {
  // Renders only for a casual round, which is created `configUnlocked: true`
  // and never launched, so it cannot be locked — see match-setup.ts.
  "src/components/CasualRoundPanel.tsx": "casual rounds never lock",
  // Not rendered at all while setup is locked — asserted below.
  "src/components/DescribeTournament.tsx": "not rendered when locked",
};

describe("every control that reaches a lock-refusing action knows the lock", () => {
  const locked = lockRefusingActions();
  const found = callers(locked);

  it("finds the actions and the screens it is about (the control)", () => {
    // If the sweep's parsing broke, it would find nothing and pass. These are
    // known members of the class, from the walk and the sweep.
    // (`addStage` left this list on 2026-09-27: adding a round is running the
    // event, not setting it up. Deleting one still refuses.)
    for (const a of ["setBracketMode", "saveEvent", "clearRoundScores", "createTeam", "removeStage", "setStageCut"]) {
      expect(locked.has(a), `${a} should refuse a locked tournament`).toBe(true);
    }
    for (const f of [
      "src/components/StagesClient.tsx",
      "src/components/TeamsClient.tsx",
      "src/components/BracketModePicker.tsx",
      "src/components/EventSetupClient.tsx",
      "src/components/ClearScores.tsx",
      "src/components/CutControl.tsx",
      "src/components/RegistrationClient.tsx",
    ]) {
      expect(found.has(f), `${f} should be found calling a lock-refusing action`).toBe(true);
    }
  });

  /**
   * RECEIVES the lock — a typed prop or the Rounds & formats context — not
   * merely mentions it. The first draft accepted the bare word and passed on
   * the broken screen: `StagesClient` said `locked: false` and `locked={false}`
   * while taking no lock at all.
   */
  const RECEIVES = /\b(locked|setupLocked)\??:\s*boolean\b|useContext\(SetupLocked\)/;

  it("each one receives the lock, or is exempt for a stated reason", () => {
    const blind = [...found.entries()]
      .filter(([f]) => !(f in EXEMPT))
      .filter(([f]) => !RECEIVES.test(readSource(f)))
      .map(([f, names]) => `${f} → ${names.join(", ")}`);
    expect(blind, "controls offered on a locked tournament whose action will throw").toEqual([]);
  });

  it("nobody hands a lock-aware control a constant instead of the lock", () => {
    // `locked={false}` on the single-match picker and `locked: false` into the
    // carry-forward prompt were how two of these controls were wired: a lock
    // the component understood and the caller would not give it.
    const constants = [...found.keys()].filter((f) => /\blocked(=\{false\}|:\s*false\b)/.test(readSource(f)));
    expect(constants).toEqual([]);
  });

  it("an exemption is still true", () => {
    const stages = readSource("src", "app", "(app)", "stages", "page.tsx");
    expect(stages).toMatch(/const describeTournament = locked \? null :/);
    const setup = readSource("src", "app", "actions", "match-setup.ts");
    expect(setup).toMatch(/configUnlocked: true/);
  });

  it("each page hands its screen the lock", () => {
    expect(readSource("src", "app", "(app)", "stages", "page.tsx")).toMatch(/<StagesClient[\s\S]*?locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "teams", "page.tsx")).toMatch(/<TeamsClient\s+locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "event", "page.tsx")).toMatch(/<EventSetupClient[\s\S]*?locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "bracket", "page.tsx")).toMatch(/<BracketModePicker[^>]*locked=\{isSetupLocked\(state\.event\)\}/);
    expect(readSource("src", "app", "(app)", "entry", "page.tsx")).toMatch(/<EntryModes\s+setupLocked=\{isSetupLocked\(state\.event\)\}/);
    expect(readSource("src", "components", "EntryModes.tsx")).toMatch(/<ClearScores[\s\S]*?locked=\{setupLocked\}/);
  });
});
