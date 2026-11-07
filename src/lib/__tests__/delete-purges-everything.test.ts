import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { readSource, readVerbatim } from "./source";

// purgeEvents must throw on an unscoped filter BEFORE it touches the database.
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: () => {
      throw new Error("the database was reached");
    },
  },
}));
import {
  purgeEvents,
  purgeScopeRefusal,
  HONOURS_GO_WITH,
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

const schema = readVerbatim("prisma", "schema.prisma");

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

  it("every delete path goes through the purge: nothing in src but purge.ts deletes an event or a round", () => {
    const files = sourceFilesUnder(join(process.cwd(), "src")).filter((f) => !f.endsWith(join("services", "purge.ts")));
    expect(files.length).toBeGreaterThan(300); // not an empty walk
    const offenders = files.filter((f) => DELETES_A_TOURNAMENT_OR_ROUND.test(readSource(relative(process.cwd(), f))));
    expect(offenders.map((f) => relative(process.cwd(), f))).toEqual([]);
  });

  it("a CONTROL: the sweep sees every spelling of a delete, and purge.ts itself holds both", () => {
    for (const s of [
      "await prisma.event.delete({ where: { id } })",
      "await prisma.event.deleteMany({})",
      "await tx.event.deleteMany({ where })",
      "await prisma.stage.delete({ where: { id } })",
      "await db.stage.deleteMany({ where })",
    ]) {
      expect(DELETES_A_TOURNAMENT_OR_ROUND.test(s), s).toBe(true);
    }
    expect(DELETES_A_TOURNAMENT_OR_ROUND.test("await prisma.stageOrder.deleteMany({})")).toBe(false);
    const purge = readSource("src", "lib", "services", "purge.ts");
    expect(purge).toMatch(/\.stage\.deleteMany\(/);
    expect(purge).toMatch(/\.event\.deleteMany\(/);
  });

  it("a filter that would match every tournament is refused, a scoped one is not", () => {
    expect(purgeScopeRefusal({})).toMatch(/needs a club/);
    expect(purgeScopeRefusal({ archivedAt: { not: null } })).toMatch(/needs a club/);
    expect(purgeScopeRefusal({ id: "" })).not.toBeNull();
    expect(purgeScopeRefusal({ id: { in: [] } })).not.toBeNull();
    expect(purgeScopeRefusal({ organizationId: undefined })).not.toBeNull();
    expect(purgeScopeRefusal({ id: "e1" })).toBeNull();
    expect(purgeScopeRefusal({ id: { in: ["e1", "e2"] } })).toBeNull();
    expect(purgeScopeRefusal({ organizationId: "o1", archivedAt: { not: null } })).toBeNull();
  });

  it("purgeEvents refuses an unscoped filter before it opens a transaction", async () => {
    await expect(purgeEvents({})).rejects.toThrow(/needs a club/);
    await expect(purgeEvents({ expiresAt: { lte: new Date() } })).rejects.toThrow(/needs a club/);
  });

  it("every purge transaction states its own timeout, and the honours ruling is one named switch", () => {
    const src = readSource("src", "lib", "services", "purge.ts");
    const calls = src.match(/\$transaction\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect((src.match(/\},\s*PURGE_TX\)/g) ?? []).length).toBe(calls.length);
    expect(src).toMatch(/PURGE_TX = \{ timeout: 60_000, maxWait: \d+/);
    expect(["every-delete", "deliberate-delete-only"]).toContain(HONOURS_GO_WITH);
    expect(HONOURS_GO_WITH).toBe("every-delete"); // today's behaviour, until the owner rules
    // It is the only place that decides: honours are deleted behind that switch and nowhere else.
    expect(src.match(/honoursEntry\.deleteMany/g)?.length).toBe(1);
    expect(src).toMatch(/HONOURS_GO_WITH === "every-delete" \|\| opts\.deliberate\)\s*await tx\.honoursEntry\.deleteMany/);
  });

  it("deleting a knockout round takes the bracket's results with it", () => {
    const src = readSource("src", "lib", "services", "purge.ts");
    expect(src).toMatch(/isKnockoutRound\(stage\.type\)[\s\S]*bracketWinner\.deleteMany[\s\S]*bracketReport\.deleteMany/);
  });
});

/** Any `.event.delete(` / `.stage.deleteMany(` — whatever the client is called. */
const DELETES_A_TOURNAMENT_OR_ROUND = /\.(event|stage)\.delete(Many)?\(/;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") out.push(...sourceFilesUnder(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
