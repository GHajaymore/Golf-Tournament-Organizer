import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A WHO-KEY NEVER COMES FROM THE CALLER (J39/J40 PR 2; design §9, "a forged
 * who-key").
 *
 * `guest:<playerId>` is a string. If any `"use server"` export let a caller
 * hand one in, anybody could write as a guest, or open a direct thread naming
 * one, by typing it. So keys are made in exactly two places — from the viewer
 * (`membershipFor`) and from an entry of the caller's own event
 * (`whoKeysForEntry`) — and the one function that takes keys,
 * `openDirectThread`, is not exported, so nothing outside its module can call it.
 */

const messaging = readSource("src", "lib", "services", "messaging.ts");

/** The action files' exports that pass an argument into a who-key maker. */
export function keysFromArguments(src: string): string[] {
  const found: string[] = [];
  for (const piece of src.split("export async function ").slice(1)) {
    const name = piece.slice(0, piece.indexOf("("));
    const params = piece.slice(piece.indexOf("(") + 1, piece.indexOf(")")).split(",").map((p) => p.split(":")[0].trim()).filter(Boolean);
    for (const p of params) {
      const reaches = new RegExp(`(guestWhoKey|openDirectThread|directKeyFor)\\(\\s*[^)]*\\b${p}\\b`);
      if (reaches.test(piece)) found.push(`${name}(${p})`);
    }
  }
  return found;
}

describe("a who-key never comes from the caller", () => {
  it("openDirectThread, the one function that takes keys, is not exported", () => {
    expect(messaging).toMatch(/\nasync function openDirectThread\(/);
    expect(messaging).not.toMatch(/export async function openDirectThread\(/);
    expect(messaging).not.toMatch(/export\s*\{[^}]*\bopenDirectThread\b[^}]*\}/);
  });

  it("the picker's door turns entries of the caller's own event into keys, never takes keys", () => {
    const door = messaging.slice(messaging.indexOf("export async function openDirectThreadWithPlayers("), messaging.indexOf("async function openDirectThread(", messaging.indexOf("export async function openDirectThreadWithPlayers(") + 10));
    expect(door).toContain("where: { id: { in: wanted }, eventId: ctx.eventId }");
    expect(door).toContain("players.flatMap((p) => whoKeysForEntry(p))");
  });

  it("no server action passes an argument into a key", () => {
    const dir = join("src", "app", "actions");
    const hits = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => keysFromArguments(readSource("src", "app", "actions", f)).map((h) => `${f}: ${h}`));
    expect(hits).toEqual([]);
  });

  it("a guest's context takes its key from the pass, never an argument", () => {
    const body = messaging.slice(messaging.indexOf("async function guestMembershipFor("), messaging.indexOf("async function contextFrom("));
    expect(body).toContain("const whoKey = guestWhoKey(guest.playerId);");
    expect(body).toContain("await myPlayerIdsFor({ email: \"\", guest }, eventId)");
  });

  it("CONTROL: an action that hands its argument to a key maker is seen", () => {
    expect(keysFromArguments("export async function messageAsGuest(playerId: string, body: string) {\n  const k = guestWhoKey(playerId);\n}\n")).toEqual(["messageAsGuest(playerId)"]);
    expect(keysFromArguments("export async function startIt(keys: string[]) {\n  return openDirectThread(ctx, keys, n);\n}\n")).toEqual(["startIt(keys)"]);
  });

  it("CONTROL: an exported openDirectThread would be seen", () => {
    const exported = "export async function openDirectThread(ctx, keys) {}";
    expect(/export async function openDirectThread\(/.test(exported)).toBe(true);
    expect(readFileSync(join("src", "lib", "services", "messaging.ts"), "utf8")).toContain("NOT EXPORTED");
  });
});

/**
 * THE A046 MIGRATION NAMES ONLY THE GUEST'S TWO TABLES (design §5): the
 * who-key renames are `@map` only, so a messaging table in this SQL would mean
 * a rename leaked into the database and would break the old deployment
 * mid-deploy.
 */
describe("A046 touches only PlayerPass and PlayerPassPush", () => {
  const sql = readFileSync(join("prisma", "migrations", "A046_a_guest_is_told_and_can_be_quietened", "migration.sql"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const tables = (s: string) => [...new Set([...s.matchAll(/"([A-Z][A-Za-z]+)"/g)].map((m) => m[1]).filter((t) => /^[A-Z]/.test(t) && !t.includes("_")))];

  it("every quoted table is one of the two", () => {
    expect(tables(sql).filter((t) => !["PlayerPass", "PlayerPassPush"].includes(t))).toEqual([]);
    expect(sql).not.toMatch(/\b(DROP|RENAME)\b/);
  });

  it("CONTROL: a rename of a messaging column would be seen", () => {
    const leaked = `ALTER TABLE "Message" RENAME COLUMN "authorEmail" TO "authorKey";`;
    expect(tables(leaked)).toContain("Message");
    expect(leaked).toMatch(/\bRENAME\b/);
  });
});
