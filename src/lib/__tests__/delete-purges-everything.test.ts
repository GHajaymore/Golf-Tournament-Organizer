import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import {
  EVENT_ROWS_WITHOUT_A_CASCADE,
  ROUND_ROWS_WITHOUT_A_CASCADE,
  KEPT_ON_EVENT_DELETE,
  KEPT_ON_ROUND_DELETE,
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

  it("every delete path goes through the purge", () => {
    expect(readSource("src", "app", "actions", "tournament.ts")).not.toMatch(/prisma\.event\.delete(Many)?\(/);
    for (const f of ["club-archive.ts", "round-sweep.ts", "par-sweep.ts"]) {
      expect(readSource("src", "lib", "services", f), f).not.toMatch(/prisma\.event\.delete(Many)?\(/);
    }
  });
});
