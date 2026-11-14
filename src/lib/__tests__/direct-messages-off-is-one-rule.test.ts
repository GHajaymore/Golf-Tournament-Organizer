import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * WHOSE DIRECT MESSAGES ARE OFF IS READ IN ONE PLACE (review of #1133, PE-2).
 *
 * The switch lives on two records (an account's `Member.messagesOptOut`, a
 * guest's `PlayerPass.messagesOptOut`). The endpoint that refuses a direct
 * thread and the picker that lists who can be messaged once read them with two
 * copies of the rule — the 2026-10-11 lesson was exactly "the picker and the
 * endpoint disagreed". `directMessagesOff` in services/messaging.ts is now the
 * one reader, and both callers ask it.
 *
 * The shape banned: a query that FILTERS on the switch (`where: { …
 * messagesOptOut: true … }`) anywhere but inside `directMessagesOff`. Reading
 * one's OWN switch (`select: { messagesOptOut: true }`) and setting it
 * (`data:`) are not the rule and are left alone. A control proves the sweep
 * sees the old picker's copy.
 */

const ROOT = join(__dirname, "..", "..", "..");
const HOME = "src/lib/services/messaging.ts";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Each place the switch is used as a FILTER: the nearest `where:` / `select:` / `data:` before it is `where:`. */
function filtersOnTheSwitch(src: string): number[] {
  const code = stripComments(src);
  const at: number[] = [];
  for (const m of code.matchAll(/messagesOptOut\s*:\s*true\b/g)) {
    const before = code.slice(0, m.index);
    const last = Math.max(before.lastIndexOf("where:"), before.lastIndexOf("select:"), before.lastIndexOf("data:"));
    if (last >= 0 && before.startsWith("where:", last)) at.push(m.index!);
  }
  return at;
}

/** The text of `directMessagesOff`, from its signature to the next top-level declaration. */
function bodyOfTheRule(src: string): { from: number; to: number } {
  const code = stripComments(src);
  const from = code.indexOf("async function directMessagesOff(");
  const rest = code.slice(from + 1);
  const next = rest.search(/\n(export |async function |function |const )/);
  return { from, to: next < 0 ? code.length : from + 1 + next };
}

describe("whose direct messages are off: one reader", () => {
  it("the rule is where the inventory says, and filters on BOTH records", () => {
    const src = readSource(HOME);
    const { from, to } = bodyOfTheRule(src);
    expect(from, "directMessagesOff is gone from services/messaging.ts").toBeGreaterThan(-1);
    const body = src.slice(from, to);
    expect(body).toMatch(/prisma\.member\.findMany/);
    expect(body).toMatch(/prisma\.playerPass\.findMany/);
    expect(filtersOnTheSwitch(src).length, "the rule no longer filters on the switch").toBe(2);
  });

  it("the endpoint and the picker both ask it", () => {
    const src = readSource(HOME);
    const fn = (signature: string) => {
      const start = src.indexOf(signature);
      expect(start, `${signature} is gone`).toBeGreaterThan(-1);
      const rest = src.slice(start + 1);
      const end = rest.search(/\n(export |async function |function )/);
      return src.slice(start, end < 0 ? src.length : start + 1 + end);
    };
    expect(fn("export async function messageableField("), "the picker reads the switch for itself").toMatch(/directMessagesOff\(/);
    // The endpoint: the unexported opener every direct-start door shares.
    expect(fn("async function openDirectThread("), "the endpoint reads the switch for itself").toMatch(/directMessagesOff\(/);
  });

  it("no other query in the app filters on the switch", () => {
    const strays: string[] = [];
    for (const file of [...sourceFiles("src/app"), ...sourceFiles("src/lib"), ...sourceFiles("src/components")]) {
      const src = readSource(file);
      const hits = filtersOnTheSwitch(src);
      if (!hits.length) continue;
      if (file === HOME) {
        const { from, to } = bodyOfTheRule(src);
        for (const at of hits) if (at < from || at >= to) strays.push(`${file} @${at}`);
      } else strays.push(file);
    }
    expect(strays, "a second copy of 'direct messages off'; ask directMessagesOff").toEqual([]);
  });

  it("control: the sweep sees the old picker's own copy, and not a select or a write", () => {
    const oldPicker = `
      const [optedOut, guestsOff] = await Promise.all([
        prisma.member.findMany({ where: { organizationId: ctx.organizationId, messagesOptOut: true }, select: { email: true } }),
        prisma.playerPass.findMany({ where: { eventId: ctx.eventId, messagesOptOut: true }, select: { playerId: true } }),
      ]);`;
    expect(filtersOnTheSwitch(oldPicker)).toHaveLength(2);
    expect(filtersOnTheSwitch(`prisma.member.findFirst({ where: { id }, select: { messagesOptOut: true } })`)).toHaveLength(0);
    expect(filtersOnTheSwitch(`prisma.member.updateMany({ where: { id }, data: { messagesOptOut: true } })`)).toHaveLength(0);
  });
});
