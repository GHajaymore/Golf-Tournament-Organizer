import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ORG_ROLE_LABEL, orgRoleName } from "../roles";
import { readSource } from "./source";

/**
 * A CLUB ROLE IS NAMED THE WAY THE SCREEN NAMES IT (sweep 1, d11 and d4,
 * 2026-10-10).
 *
 * The club's top role is "Commissioner" on Staff & access — a considered
 * choice (2026-08-21). Its stored key is `owner`, and the key had leaked into
 * the words people read: the invitation email said "has given you owner
 * access", two refusals said "This is the only owner", and two dozen more
 * said "Only an organization owner or admin can…" — on screens that offer
 * nobody an "owner" to be, or to go and find.
 *
 * A SWEEP OF THE CLASS, not the three that were reported: every string a
 * person can be shown, in every action and component, with a control that
 * proves the sweep can find one.
 */

const ROOTS = ["src/app", "src/components", "src/lib/domain", "src/lib/services", "src/lib/email.ts"];

function sources(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "owner" ? [] : sources(full);
    return /[.]tsx?$/.test(name) ? [full] : [];
  });
}

/** Wordings that name the club's top role by its key. Each is how a sentence to a person was written. */
const LEAKS = ["owner or admin", "only owner", "another owner", "an owner first", "owner access"];

function leaksIn(text: string): string[] {
  const lower = text.toLowerCase();
  return LEAKS.filter((phrase) => lower.includes(phrase));
}

describe("the club's roles, in words", () => {
  it("are the four the screen offers, under the names it uses", () => {
    expect(ORG_ROLE_LABEL).toEqual({ owner: "Commissioner", admin: "Admin", member: "Member", guest: "Guest" });
    expect(orgRoleName("owner")).toBe("Commissioner");
    // A key nobody has named is shown as it is rather than as nothing.
    expect(orgRoleName("steward")).toBe("steward");
  });

  it("CONTROL: the sweep finds the old sentences when they are there", () => {
    expect(leaksIn('return { ok: false, error: "Only an organization owner or admin can manage staff." };')).toEqual(["owner or admin"]);
    expect(leaksIn("This is the only owner — make someone else an owner first.")).toEqual(["only owner", "an owner first"]);
    expect(leaksIn("Only a Commissioner or Admin can manage staff.")).toEqual([]);
  });

  it("no sentence shown to a person names the role by its stored key", () => {
    const files = ROOTS.flatMap(sources);
    expect(files.length, "the sweep read almost nothing").toBeGreaterThan(300);
    const found = files.flatMap((file) => leaksIn(readSource(file.split("\\").join("/"))).map((phrase) => `${file}: "${phrase}"`));
    expect(found).toEqual([]);
  });

  it("the invitation email reads the role through the same table as the screen", () => {
    const email = readSource("src/lib/email.ts");
    expect(email).toContain("orgRoleName(opts.role)");
    expect(email).not.toContain("escapeHtml(opts.role)");
    expect(readSource("src/components/OrganizationAccess.tsx")).toContain("orgRoleName(");
  });

  it("the screen says what a Commissioner and a Member actually are", () => {
    const screen = readSource("src/components/OrganizationAccess.tsx");
    // Only the LAST Commissioner is kept; the others can be changed or removed.
    expect(screen).not.toContain("and cannot be removed");
    expect(screen).toContain("There is always at least");
    // A Member opens every tournament of the club as a player.
    expect(screen).not.toContain("access only where explicitly given");
  });
});
