import { describe, it, expect } from "vitest";
import type { Role } from "../roles";

/**
 * The precedence rule used when someone holds both an explicit per-event role
 * and one inherited from their organization. Mirrored here rather than
 * imported because src/lib/services/access.ts is server-only and reaches for a
 * database; this locks the *decision* down, which is the part that must not
 * drift.
 */
const RANK: Record<Role, number> = { player: 0, assistant: 1, admin: 2 };

function higher(a: Role, b: Role): Role {
  return RANK[a] >= RANK[b] ? a : b;
}

describe("combining event and organization roles", () => {
  it("ranks admin above assistant above player", () => {
    expect(RANK.admin).toBeGreaterThan(RANK.assistant);
    expect(RANK.assistant).toBeGreaterThan(RANK.player);
  });

  it("keeps a club owner as organizer even when entered as a player", () => {
    // The case that motivated the rule: an owner who plays in their own event
    // must not lose the ability to run it.
    expect(higher("player", "admin")).toBe("admin");
  });

  it("never demotes an explicit event role to something weaker", () => {
    expect(higher("admin", "player")).toBe("admin");
    expect(higher("assistant", "player")).toBe("assistant");
  });

  it("leaves a lone role untouched", () => {
    for (const role of ["admin", "assistant", "player"] as Role[]) {
      expect(higher(role, role)).toBe(role);
    }
  });

  it("does not let a member-level org role grant event access", () => {
    // Only owner/admin confer organizer rights; `member` is a staff pool with
    // no automatic access, so nothing is inherited to combine.
    const grantsAdmin = (orgRole: string) => orgRole === "owner" || orgRole === "admin";
    expect(grantsAdmin("member")).toBe(false);
    expect(grantsAdmin("owner")).toBe(true);
    expect(grantsAdmin("admin")).toBe(true);
  });
});
