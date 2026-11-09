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
      // The body up to the next export — `split` already cut it there. A scoped
      // lock (`refuseIfLocked`, PR 5a) RETURNS its refusal rather than throwing,
      // but a live control that can only be refused is still an invitation to a
      // refused press, so its controls must know the lock all the same.
      if (/\b(assertUnlocked|refuseIfLocked)\(/.test(part)) out.set(name, relative(ROOT, f));
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
    // Withheld when locked — and, since 2026-10-16, where the club has no
    // drafting at all; the lock is still the first thing asked.
    expect(stages).toMatch(/const describeTournament =\s*locked \|\| [^?]*\? null :/);
    const setup = readSource("src", "app", "actions", "match-setup.ts");
    expect(setup).toMatch(/configUnlocked: true/);
  });

  /**
   * THE FIELD ACTIONS ASK THEIR OWN RULE (day-of field changes, PR A): after
   * launch Withdraw, Put back and a late entry stay open while setup is locked,
   * so a control reaching one of them takes the field's DOORS (`fieldDoors`, or
   * one door as a sentence), never the setup lock alone — the setup lock would
   * shut the very controls the morning needs. Swept as a class like the above.
   */
  it("each control reaching a field action receives the field's doors", () => {
    const fieldActions = new Set<string>();
    for (const f of files(join(ROOT, "src", "app", "actions"), /\.ts$/)) {
      for (const part of readSource(relative(ROOT, f)).split(/export async function /).slice(1)) {
        if (/\bfieldRefusal\(/.test(part)) fieldActions.add(part.slice(0, part.indexOf("(")).trim());
      }
    }
    // The control: the sweep finds the actions it is about.
    for (const a of ["addSignup", "removeSignup", "reinstateWithdrawn", "approveSignup", "addMembersToEvent"]) {
      expect(fieldActions.has(a), `${a} should ask the field rule`).toBe(true);
    }
    const reaching = callers(new Map([...fieldActions].map((a) => [a, ""])));
    expect(reaching.has("src/components/RegistrationClient.tsx")).toBe(true);
    expect(reaching.has("src/components/WithdrawnList.tsx")).toBe(true);
    const DOORS = /\b(doors\??:\s*FieldDoors|door\??:\s*string \| null|fieldLocked\??:\s*string \| null)/;
    const FIELD_EXEMPT: Record<string, string> = {
      ...EXEMPT,
      // Handed `locked={!!doors.add}` by RegistrationClient — the add door, as a boolean (asserted below).
      "src/components/RosterPicker.tsx": "given the add door by its one caller",
      // The Flights board shuts every move on the setup lock (and on a confirmed draw). After launch the
      // field rule refuses "move-flight" too; the one move it allows — placing an unplaced late entrant —
      // is offered on Entries instead. Stricter than the rule, never looser, so no refused press is offered.
      "src/components/FlightBoard.tsx": "shuts every move on the setup lock, stricter than the field rule",
    };
    const blind = [...reaching.entries()]
      .filter(([f]) => !(f in FIELD_EXEMPT))
      .filter(([f]) => !DOORS.test(readSource(f)))
      .map(([f, names]) => `${f} → ${names.join(", ")}`);
    expect(blind, "controls reaching a field action without the field's doors").toEqual([]);
    expect(readSource("src", "components", "RegistrationClient.tsx")).toMatch(/<RosterPicker [^>]*locked=\{!!doors\.add\}/);
  });

  it("each page hands its screen the lock", () => {
    expect(readSource("src", "app", "(app)", "stages", "page.tsx")).toMatch(/<StagesClient[\s\S]*?locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "teams", "page.tsx")).toMatch(/<TeamsClient\s+locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "event", "page.tsx")).toMatch(/<EventSetupClient[\s\S]*?locked=\{locked\}/);
    // The machine's scoped lock (state machine PR 5b): the rounds' for the arrangement (as `setBracketMode` asks, and as
    // the same picker on Rounds & formats draws — never the draw's, which a knockout in flights keeps open while live),
    // the rounds' for clearing scores.
    expect(readSource("src", "app", "(app)", "bracket", "page.tsx")).toMatch(/<BracketModePicker[^>]*locked=\{\(await scopeLockFor\(session\.eventId, "rounds"\)\) !== null\}/);
    expect(readSource("src", "app", "(app)", "entry", "page.tsx")).toMatch(/<EntryModes\s+setupLocked=\{\(await scopeLockFor\(session\.eventId, "rounds"\)\) !== null\}/);
    expect(readSource("src", "components", "EntryModes.tsx")).toMatch(/<ClearScores[\s\S]*?locked=\{setupLocked\}/);
  });
});
