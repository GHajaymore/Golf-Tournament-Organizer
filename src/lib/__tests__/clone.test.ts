import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLONED_EVENT_FIELDS,
  NOT_CLONED_EVENT_FIELDS,
  CLONE_IGNORED_RELATIONS,
  CLONED_STAGE_FIELDS,
  NOT_CLONED_STAGE_FIELDS,
} from "../services/clone";

/** Field names declared on a model in schema.prisma, in declaration order. */
function modelFields(model: string): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const block = new RegExp(`^model ${model} \\{$([\\s\\S]*?)^\\}$`, "m").exec(schema);
  if (!block) throw new Error(`model ${model} not found in schema.prisma`);
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"))
    .filter((line) => !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0])
    .filter((n) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n));
}

describe("clone field policy", () => {
  const fields = modelFields("Event");

  it("finds the Event model", () => {
    // Guards the parser itself: a silently-empty field list would make every
    // other assertion in this file pass for the wrong reason.
    expect(fields).toContain("shareToken");
    expect(fields.length).toBeGreaterThan(30);
  });

  it("classifies every field on Event", () => {
    // The point of the whole file. Add a column to Event and this fails until
    // you decide, in writing, whether a copy should inherit it.
    const classified = new Set<string>([
      ...CLONED_EVENT_FIELDS,
      ...Object.keys(NOT_CLONED_EVENT_FIELDS),
      ...CLONE_IGNORED_RELATIONS,
    ]);
    const unclassified = fields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Event fields missing from src/lib/services/clone.ts — decide whether a copy inherits each: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("names nothing that isn't on the model", () => {
    // Stops the lists drifting into fiction after a rename.
    const onModel = new Set(fields);
    const phantom = [
      ...CLONED_EVENT_FIELDS,
      ...Object.keys(NOT_CLONED_EVENT_FIELDS),
      ...CLONE_IGNORED_RELATIONS,
    ].filter((f) => !onModel.has(f));
    expect(phantom, `listed in clone.ts but not on Event: ${phantom.join(", ")}`).toEqual([]);
  });

  it("puts no field in two lists at once", () => {
    const all = [
      ...CLONED_EVENT_FIELDS,
      ...Object.keys(NOT_CLONED_EVENT_FIELDS),
      ...CLONE_IGNORED_RELATIONS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("never copies the share token", () => {
    // It is unique, so copying collides on insert; worse, it would give the
    // copy the original's public leaderboard link.
    expect(CLONED_EVENT_FIELDS).not.toContain("shareToken");
    expect(NOT_CLONED_EVENT_FIELDS.shareToken).toBeTruthy();
  });

  it("never copies lifecycle state", () => {
    // A copy of a finished tournament is a draft, not a finished tournament.
    for (const f of ["status", "launchedAt", "configUnlocked", "createdAt", "updatedAt", "id"]) {
      expect(CLONED_EVENT_FIELDS, `${f} must not be copied`).not.toContain(f);
    }
  });

  it("never copies dates", () => {
    // Last year's dates are the one thing guaranteed wrong on this year's copy,
    // and a stale registration deadline silently closes entry.
    expect(CLONED_EVENT_FIELDS).not.toContain("dates");
    expect(CLONED_EVENT_FIELDS).not.toContain("regDeadline");
  });

  it("carries every tournament setting across", () => {
    // The settings are the reason to copy at all — a copy that dropped them
    // would be no better than starting fresh.
    for (const f of [
      "leaderboardVisibility",
      "scoreEntryBy",
      "scoreEntryWindow",
      "voiceEntry",
      "playerAccess",
      "scoreApproval",
    ]) {
      expect(CLONED_EVENT_FIELDS, `${f} should carry across`).toContain(f);
    }
  });

  it("keeps the copy in the same organization", () => {
    expect(CLONED_EVENT_FIELDS).toContain("organizationId");
  });

  it("gives a reason for every deliberate exclusion", () => {
    for (const [field, why] of Object.entries(NOT_CLONED_EVENT_FIELDS)) {
      expect(why.length, `${field} has no stated reason`).toBeGreaterThan(10);
    }
  });
});

describe("cloneEvent authorization", () => {
  const action = () =>
    readFileSync(join(process.cwd(), "src", "app", "actions", "tournament.ts"), "utf8");
  /** cloneEvent's body with comments stripped — the guard comment names the
   *  very anti-pattern being asserted against, so prose would false-positive. */
  const cloneBody = () => {
    // `\r?\n`, not `\n`. git is configured with core.autocrlf=true here, so a
    // fresh checkout writes every source file with CRLF — and this regex then
    // matched nothing, failing three tests with "cloneEvent not found" while
    // the function sat right there. A source-scanning test that depends on the
    // checkout's line endings is a test that reports a security hole it cannot
    // actually see.
    const m = /export async function cloneEvent[\s\S]*?\r?\n\}\r?\n/.exec(action());
    if (!m) throw new Error("cloneEvent not found");
    return m[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  };

  it("requires organizer, not merely access", () => {
    // effectiveAccess returns a role for players too, so `if (!access)` would
    // let anyone entered in a club's tournament copy it — and because the copy
    // is created in the *source's* organization, they'd end up owning an event
    // inside a club they only play in.
    const body = cloneBody();
    expect(body).toMatch(/access\?\.role\s*!==\s*"admin"/);
    expect(body, "a bare !access check is not sufficient here").not.toMatch(/if\s*\(\s*!access\s*\)/);
  });

  it("authorizes against the source event", () => {
    // Not the caller's active event: the copy inherits the source's
    // organization, so the source is what has to be checked.
    expect(cloneBody()).toMatch(/effectiveAccess\(session\.email,\s*sourceEventId\)/);
  });
});

describe("clone never carries a Round Code", () => {
  it("Stage.accessCode exists and is excluded by name", () => {
    // Round Codes are credentials. A copy that inherited them would let last
    // season's players walk into this season's tournament. cloneEvent builds
    // each Stage field by field precisely so this can't be copied by accident.
    const stage = modelFields("Stage");
    expect(stage).toContain("accessCode");

    const action = readFileSync(
      join(process.cwd(), "src", "app", "actions", "tournament.ts"),
      "utf8",
    );
    // `\r?\n` for the same reason as above: CRLF checkouts.
    const clone = /export async function cloneEvent[\s\S]*?\r?\n\}\r?\n/.exec(action);
    expect(clone, "cloneEvent not found").toBeTruthy();
    expect(clone![0]).not.toMatch(/accessCode/);
    expect(clone![0]).not.toMatch(/shareToken:\s*source\./);
  });
});

/**
 * The same policy, for a ROUND.
 *
 * The Event had one and the copy honoured 30 of its 43 entries. The Stage loop
 * had none at all, so nothing could notice that it copied four cut fields and
 * not `cutScope` — turning a per-flight cut into an overall one, which advances
 * a different set of players — or that it dropped the committee's own
 * `handicapAllowance`, `allowanceWeights` and `countBest`.
 */
describe("clone field policy — rounds", () => {
  const fields = modelFields("Stage");

  it("finds the Stage model", () => {
    // Guards the parser, exactly as the Event block above does.
    expect(fields).toContain("cutScope");
    expect(fields.length).toBeGreaterThan(20);
  });

  it("classifies every field on Stage", () => {
    // Add a column to Stage and this fails until you decide, in writing,
    // whether a copied round inherits it.
    const classified = new Set<string>([
      ...CLONED_STAGE_FIELDS,
      ...Object.keys(NOT_CLONED_STAGE_FIELDS),
    ]);
    const unclassified = fields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Stage fields missing from src/lib/services/clone.ts — decide whether a copy inherits each: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("never classifies a field as both", () => {
    const both = CLONED_STAGE_FIELDS.filter((f) => f in NOT_CLONED_STAGE_FIELDS);
    expect(both).toEqual([]);
  });

  it("carries the settings a committee actually chose", () => {
    // Each of these reverted to a schema default on every copied round, which
    // is a silent change of the arithmetic rather than an empty field.
    for (const f of [
      "cutScope",
      "handicapAllowance",
      "allowanceWeights",
      "countBest",
      "scoringBasis",
      "scoreInput",
    ]) {
      expect(CLONED_STAGE_FIELDS, `${f} should carry across`).toContain(f);
    }
  });

  it("never carries a Round Code or last year's dates", () => {
    for (const f of ["accessCode", "playedOn", "deadline", "teeSheet"]) {
      expect(CLONED_STAGE_FIELDS, `${f} must not be copied`).not.toContain(f);
      expect(NOT_CLONED_STAGE_FIELDS[f], `${f} needs a stated reason`).toBeTruthy();
    }
  });

  it("gives every exclusion a reason somebody can read", () => {
    for (const [field, why] of Object.entries(NOT_CLONED_STAGE_FIELDS)) {
      expect(why.length, `${field} needs a real reason`).toBeGreaterThan(10);
    }
  });
});

/**
 * The policy is what the action actually writes.
 *
 * This is the gap that let thirteen declared-clonable Event fields go missing:
 * the policy said one thing, and `cloneEvent` kept its own hand-written list
 * that said another. A test can only be sure they agree if the write is
 * DERIVED from the policy, so that is asserted here rather than the field
 * names, which would just be a third list to keep in step.
 */
describe("cloneEvent copies from the declared policy", () => {
  const action = readFileSync(
    join(process.cwd(), "src", "app", "actions", "tournament.ts"),
    "utf8",
  );
  const body = action.slice(action.indexOf("export async function cloneEvent"));

  it("builds the event from CLONED_EVENT_FIELDS", () => {
    expect(body).toMatch(/CLONED_EVENT_FIELDS\.map\(/);
  });

  it("builds each round from CLONED_STAGE_FIELDS", () => {
    expect(body).toMatch(/CLONED_STAGE_FIELDS\.map\(/);
  });

  it("does not keep a second list of event fields by hand", () => {
    // The shape that dropped `shape`, `bracketMode`, `moneyMode` and ten more.
    expect(body).not.toMatch(/scoreEntryBy: source\.scoreEntryBy/);
    expect(body).not.toMatch(/qualifyPerGroup: source\.qualifyPerGroup/);
  });

  it("still sets for itself the four things a copy must not inherit", () => {
    // Derived-from-policy must not mean derived-from-everything.
    expect(body).toMatch(/dates: "",/);
    expect(body).toMatch(/regDeadline: "",/);
    expect(body).toMatch(/status: "draft",/);
    expect(body).toMatch(/shareToken: generateShareToken\(\)/);
  });
});
