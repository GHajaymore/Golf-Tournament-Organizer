import { describe, it, expect } from "vitest";
import { mayChangeMembership, mayDeleteClub } from "../membership-rule";
import { readSource } from "../../__tests__/source";

const ask = (actorRole: string | null, targetCurrentRole: string | null, targetNewRole: string | null, commissionerCount: number) =>
  mayChangeMembership({ actorRole, targetCurrentRole, targetNewRole, commissionerCount }).ok;

describe("who may change a club's staff", () => {
  it("lets a Commissioner do anything while another Commissioner remains", () => {
    expect(ask("owner", "member", "owner", 1)).toBe(true);
    expect(ask("owner", "owner", "admin", 2)).toBe(true);
    expect(ask("owner", "owner", null, 2)).toBe(true);
    expect(ask("owner", "admin", null, 1)).toBe(true);
  });
  it("lets an Admin work only up to Admin level", () => {
    expect(ask("admin", null, "admin", 1)).toBe(true);
    expect(ask("admin", "member", "admin", 1)).toBe(true);
    expect(ask("admin", "admin", null, 1)).toBe(true);
    expect(ask("admin", "member", "guest", 1)).toBe(true);
  });
  it("refuses an Admin each takeover step", () => {
    expect(ask("admin", "member", "owner", 1), "grant Commissioner").toBe(false);
    expect(ask("admin", null, "owner", 1), "add as Commissioner").toBe(false);
    expect(ask("admin", "owner", "admin", 2), "demote a Commissioner").toBe(false);
    expect(ask("admin", "owner", null, 2), "remove a Commissioner").toBe(false);
    expect(ask("admin", "owner", null, 1), "remove the last one").toBe(false);
  });
  it("keeps at least one Commissioner, self included", () => {
    expect(ask("owner", "owner", "admin", 1)).toBe(false);
    expect(ask("owner", "owner", null, 1)).toBe(false);
    expect(ask("owner", "owner", "owner", 1)).toBe(true);
  });
  it("refuses anybody who is not staff", () => {
    for (const r of ["member", "guest", null]) expect(ask(r, null, "member", 1)).toBe(false);
  });
  it("lets an Admin appoint the first Commissioner of an ownerless club", () => {
    expect(ask("admin", "member", "owner", 0)).toBe(true);
  });
  it("lets only a Commissioner delete the club", () => {
    expect(mayDeleteClub("owner")).toBe(true);
    for (const r of ["admin", "member", "guest", null]) expect(mayDeleteClub(r)).toBe(false);
  });
});

describe("every door asks the one rule", () => {
  const src = readSource("src/app/actions/organization.ts");
  for (const fn of ["addOrganizationMember", "setOrganizationMemberRole", "removeOrganizationMember"]) {
    it(`${fn} asks it inside a transaction`, () => {
      const own = src.split("export async function ").find((c) => c.startsWith(`${fn}(`)) ?? "";
      expect(own.includes("$transaction(") || own.includes("serially(")).toBe(true);
      expect(own).toContain("askMembershipRule(");
    });
  }
  it("deleteClub asks it through clubDeletionRefusal", () => {
    expect(readSource("src/lib/domain/club-deletion.ts")).toContain("mayDeleteClub(");
    expect(readSource("src/app/actions/club-deletion.ts")).toContain("clubDeletionRefusal(");
  });
});
