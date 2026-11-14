import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKED_UP_TABLES, EXCLUDED_TABLES, isPlainTableName } from "../backup/tables";

/**
 * EVERY MODEL IS BACKED UP OR LEFT OUT ON PURPOSE (B21).
 *
 * A model added to `schema.prisma` and to neither list would be a table the
 * nightly copy silently leaves behind, found the day it is needed. This fails
 * first. (The restore drill does the same against a migrated database, which
 * also sees tables no model names.)
 */

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const backed = new Set<string>(BACKED_UP_TABLES);
const excluded = new Set(Object.keys(EXCLUDED_TABLES));

describe("the backup's table lists", () => {
  it("read the schema (control: the sweep is not looking at nothing)", () => {
    expect(models.length).toBeGreaterThan(50);
    expect(models).toContain("User");
    expect(models).toContain("Scorecard");
  });

  it("the schema maps no model to another table name (so a model's name is its table's)", () => {
    expect(schema).not.toMatch(/@@map\(/);
  });

  it("every model is in exactly one list", () => {
    const neither = models.filter((m) => !backed.has(m) && !excluded.has(m));
    const both = models.filter((m) => backed.has(m) && excluded.has(m));
    expect({ neither, both }).toEqual({ neither: [], both: [] });
  });

  it("every listed table is a model (or the migration history)", () => {
    const stale = [...backed, ...excluded].filter((t) => t !== "_prisma_migrations" && !models.includes(t));
    expect(stale).toEqual([]);
  });

  it("the migration history is copied, and first", () => {
    expect(BACKED_UP_TABLES[0]).toBe("_prisma_migrations");
  });

  it("only the three short-lived secret tables are left out, each with its reason", () => {
    expect(Object.keys(EXCLUDED_TABLES).sort()).toEqual(["EmailCode", "PasswordResetToken", "RateLimitHit"]);
    for (const reason of Object.values(EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(10);
  });

  it("no name repeats, and every name is safe to put into SQL", () => {
    expect(new Set(BACKED_UP_TABLES).size).toBe(BACKED_UP_TABLES.length);
    for (const t of [...backed, ...excluded]) expect(isPlainTableName(t)).toBe(true);
    expect(isPlainTableName('User"; DROP TABLE "User')).toBe(false);
    expect(isPlainTableName("")).toBe(false);
  });
});
