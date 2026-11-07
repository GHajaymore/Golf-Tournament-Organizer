import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import {
  EVENT_ROWS_WITHOUT_A_CASCADE,
  ROUND_ROWS_WITHOUT_A_CASCADE,
  KEPT_ON_EVENT_DELETE,
  KEPT_ON_ROUND_DELETE,
  NEVER_PURGED,
} from "../services/purge";

/**
 * DELETING A ROUND OR A TOURNAMENT IS A PURGE (Ajay, 2026-11-07).
 *
 * A model that carries an `eventId` or a `stageId` is a table that names a
 * tournament or a round. Either the database removes it with its parent
 * (`onDelete: Cascade` on that very column) or `services/purge.ts` removes it
 * by hand, or it is KEPT on purpose with a reason. A model that is none of the
 * three is a table that outlives the thing it describes, still naming people:
 * `Scorecard`, `RoundHandicap` and `HonoursEntry` were exactly that.
 *
 * Adding a model with a bare `eventId` or `stageId` fails here until its author
 * decides which of the three it is.
 */

type Field = { name: string; line: string };
type Model = { name: string; fields: Field[] };

export function modelsOf(schema: string): Model[] {
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
    name,
    fields: body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/"))
      .map((line) => ({ name: line.split(/\s+/)[0], line })),
  }));
}

/** What the models in `schema` leave unhandled for one column (`eventId` | `stageId`). */
export function unhandled(
  schema: string,
  column: "eventId" | "stageId",
  byHand: readonly string[],
  kept: Record<string, string>,
): string[] {
  const parent = column === "eventId" ? "Event" : "Stage";
  const bad: string[] = [];
  for (const m of modelsOf(schema)) {
    if (!m.fields.some((f) => f.name === column)) continue;
    const cascades = m.fields.some(
      (f) => f.line.includes("@relation(") && f.line.includes(`fields: [${column}]`) && f.line.includes("onDelete: Cascade") && new RegExp(`\\s${parent}\\??\\s`).test(f.line),
    );
    if (cascades || byHand.includes(m.name) || m.name in kept) continue;
    bad.push(m.name);
  }
  return bad;
}

/**
 * Every model a purge reaches by CASCADE: start at the roots (Event, Stage) and
 * add any model with a foreign key to one already in the set with
 * `onDelete: Cascade`. Deleting a parent deletes these; the other direction
 * (a Member deleted, a Player's memberId set null) is not a cascade INTO it.
 */
export function cascadeClosure(schema: string, roots: string[]): Set<string> {
  const edges: Array<{ child: string; parent: string }> = [];
  for (const m of modelsOf(schema)) {
    for (const f of m.fields) {
      const t = f.line.split(/\s+/)[1]?.replace("?", "");
      if (f.line.includes("@relation(") && f.line.includes("fields: [") && f.line.includes("onDelete: Cascade") && t) {
        edges.push({ child: m.name, parent: t });
      }
    }
  }
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      if (out.has(e.parent) && !out.has(e.child)) {
        out.add(e.child);
        grew = true;
      }
    }
  }
  return out;
}

export function reachableNeverPurged(schema: string, never: string[]): string[] {
  const reached = cascadeClosure(schema, ["Event", "Stage"]);
  return never.filter((n) => reached.has(n));
}

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

describe("every model that names a tournament or a round is purged with it", () => {
  it("every eventId is a cascade, deleted by hand, or kept with a reason", () => {
    expect(unhandled(schema, "eventId", EVENT_ROWS_WITHOUT_A_CASCADE, KEPT_ON_EVENT_DELETE)).toEqual([]);
  });

  it("every stageId is a cascade, deleted by hand, or kept with a reason", () => {
    expect(unhandled(schema, "stageId", ROUND_ROWS_WITHOUT_A_CASCADE, KEPT_ON_ROUND_DELETE)).toEqual([]);
  });

  it("a CONTROL: a model with a bare eventId or stageId is seen", () => {
    const added = `${schema}\nmodel ZzNewThing {\n  id String @id\n  eventId String\n  stageId String\n}\n`;
    expect(unhandled(added, "eventId", EVENT_ROWS_WITHOUT_A_CASCADE, KEPT_ON_EVENT_DELETE)).toEqual(["ZzNewThing"]);
    expect(unhandled(added, "stageId", ROUND_ROWS_WITHOUT_A_CASCADE, KEPT_ON_ROUND_DELETE)).toEqual(["ZzNewThing"]);
    // ...and a KEPT reason or a hand delete clears it, so the lists are the way out.
    expect(unhandled(added, "eventId", [...EVENT_ROWS_WITHOUT_A_CASCADE, "ZzNewThing"], {})).toEqual([]);
    expect(unhandled(added, "stageId", ROUND_ROWS_WITHOUT_A_CASCADE, { ZzNewThing: "reason" })).toEqual([]);
  });

  it("the lists name real models, with a reason for every kept one", () => {
    const names = new Set(modelsOf(schema).map((m) => m.name));
    for (const n of [...EVENT_ROWS_WITHOUT_A_CASCADE, ...ROUND_ROWS_WITHOUT_A_CASCADE, ...Object.keys(KEPT_ON_EVENT_DELETE), ...Object.keys(KEPT_ON_ROUND_DELETE)]) {
      expect(names.has(n), n).toBe(true);
    }
    for (const why of [...Object.values(KEPT_ON_EVENT_DELETE), ...Object.values(KEPT_ON_ROUND_DELETE)]) {
      expect(why.length).toBeGreaterThan(10);
    }
  });

  it("purge.ts really deletes each model it lists", () => {
    const src = readSource("src", "lib", "services", "purge.ts");
    for (const n of [...EVENT_ROWS_WITHOUT_A_CASCADE, ...ROUND_ROWS_WITHOUT_A_CASCADE]) {
      const accessor = n[0].toLowerCase() + n.slice(1);
      expect(src.includes(`tx.${accessor}.deleteMany`), n).toBe(true);
    }
  });

  it("no cascade from a tournament or a round reaches a club- or person-level row", () => {
    expect(reachableNeverPurged(schema, Object.keys(NEVER_PURGED))).toEqual([]);
    // A CONTROL: the closure does see a cascade child, and does see a new person-level one.
    expect(cascadeClosure(schema, ["Event", "Stage"]).has("Player")).toBe(true);
    expect(cascadeClosure(schema, ["Event", "Stage"]).has("Scorecard")).toBe(true);
    const bad = `${schema}\nmodel ZzMemberCopy {\n  id String @id\n  eventId String\n  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)\n}\n`;
    expect(reachableNeverPurged(bad, ["ZzMemberCopy"])).toEqual(["ZzMemberCopy"]);
  });

  it("the person-level lists name real models and purge.ts never deletes one", () => {
    const names = new Set(modelsOf(schema).map((m) => m.name));
    const src = readSource("src", "lib", "services", "purge.ts");
    for (const n of Object.keys(NEVER_PURGED)) {
      expect(names.has(n), n).toBe(true);
      const accessor = n[0].toLowerCase() + n.slice(1);
      expect(src.includes(`.${accessor}.delete`), `${n} is deleted in purge.ts`).toBe(false);
      expect(NEVER_PURGED[n].length).toBeGreaterThan(5);
    }
    // And the kept-on-purpose and by-hand lists never overlap with them.
    for (const n of [...EVENT_ROWS_WITHOUT_A_CASCADE, ...ROUND_ROWS_WITHOUT_A_CASCADE]) expect(n in NEVER_PURGED, n).toBe(false);
    // The link that keeps a Member alive: deleting an entry never touches it.
    expect(schema).toMatch(/member\s+Member\?\s+@relation\(fields: \[memberId\], references: \[id\], onDelete: SetNull\)/);
  });

  it("every delete path goes through the purge", () => {
    expect(readSource("src", "app", "actions", "tournament.ts")).not.toMatch(/prisma\.event\.delete(Many)?\(/);
    for (const f of ["club-archive.ts", "round-sweep.ts", "par-sweep.ts", "demo-club.ts"]) {
      expect(readSource("src", "lib", "services", f), f).not.toMatch(/prisma\.event\.delete(Many)?\(/);
    }
  });
});
