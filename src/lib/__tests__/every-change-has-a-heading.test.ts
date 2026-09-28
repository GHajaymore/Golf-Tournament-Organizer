import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { changeKind } from "@/lib/domain/change-kind";

/**
 * EVERY LINE THE APP WRITES TO THE RECORD HAS A HEADING TO GO UNDER.
 *
 * Recent changes sorts each audit line by its action name (`change-kind.ts`),
 * and an action it does not know is shown under "Other" — the heading that
 * says nobody filed it. On 2026-09-28 two new field actions had to be added by
 * hand, which is the moment a third gets forgotten. So every action name
 * written anywhere in `src` is read off the source and must resolve to a real
 * heading.
 *
 * Read from the SOURCE rather than a list, so a writer added tomorrow is
 * covered the day it is added.
 */

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** Every string literal that appears as the ACTION of a `logAudit(...)` or an `auditLog.create`. */
function writtenActions(): Map<string, string> {
  const found = new Map<string, string>();
  const root = join(process.cwd(), "src");
  for (const file of filesUnder(root)) {
    const src = readSource(file.slice(process.cwd().length + 1));
    // logAudit(eventId, "action", ...) — the second argument, across newlines,
    // including both arms of a ternary.
    for (const call of src.split("logAudit(").slice(1)) {
      const args = call.slice(0, 400);
      const afterFirstComma = args.slice(args.indexOf(",") + 1);
      const second = afterFirstComma.slice(0, afterFirstComma.search(/,\s*[`"'$]|,\s*\n/) + 1 || undefined);
      for (const m of second.matchAll(/"([a-z][a-z0-9.-]*)"/g)) found.set(m[1], file);
    }
    for (const call of src.split("auditLog.create(").slice(1)) {
      const m = call.slice(0, 400).match(/action:\s*"([a-z][a-z0-9.-]*)"/);
      if (m) found.set(m[1], file);
    }
  }
  return found;
}

describe("every action written to the record has a heading", () => {
  const actions = writtenActions();

  it("finds the writers at all (control)", () => {
    // Without this, a reader that matched nothing would pass the rule below.
    for (const known of ["entered", "removed", "approved", "promoted", "score", "money.mode", "match.forfeit"]) {
      expect(actions.has(known), `did not find "${known}"`).toBe(true);
    }
    expect(actions.size).toBeGreaterThan(30);
  });

  it("files none of them under Other", () => {
    const unfiled = [...actions.entries()]
      .filter(([action]) => changeKind(action) === "Other")
      .map(([action, file]) => `${action} (${file.slice(process.cwd().length + 1)})`);
    expect(unfiled).toEqual([]);
  });
});
