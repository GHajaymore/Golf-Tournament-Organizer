import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLONED_EVENT_FIELDS,
  NOT_CLONED_EVENT_FIELDS,
  CLONE_IGNORED_RELATIONS,
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
    const m = /export async function cloneEvent[\s\S]*?\n\}\n/.exec(action());
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
    const clone = /export async function cloneEvent[\s\S]*?\n\}\n/.exec(action);
    expect(clone, "cloneEvent not found").toBeTruthy();
    expect(clone![0]).not.toMatch(/accessCode/);
    expect(clone![0]).not.toMatch(/shareToken:\s*source\./);
  });
});
