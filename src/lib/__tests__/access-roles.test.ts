import { describe, it, expect } from "vitest";
import { describeOrgRoleChange, describeRoleChange, isDemotion, roleLabel } from "@/lib/access-roles";

/**
 * The access screen used to commit a role the instant a radio changed. A stray
 * click was a silent re-role — and in testing it silently demoted a member.
 * The fix routes every change through a confirmation, and this is the logic
 * that confirmation is built on: what a change *is*, so the prompt can say so
 * and a demotion of the last organizer can be caught before it is even tried.
 */

describe("role labels", () => {
  it("names each stored role", () => {
    expect(roleLabel("admin")).toBe("Organizer");
    expect(roleLabel("assistant")).toBe("Assistant");
    expect(roleLabel("player")).toBe("Player");
  });

  it("falls back to the raw value rather than printing undefined", () => {
    expect(roleLabel("mystery")).toBe("mystery");
  });
});

describe("demotion direction", () => {
  it("counts a move to less access as a demotion", () => {
    expect(isDemotion("admin", "assistant")).toBe(true);
    expect(isDemotion("admin", "player")).toBe(true);
    expect(isDemotion("assistant", "player")).toBe(true);
  });

  it("does not count a promotion or a lateral non-move", () => {
    expect(isDemotion("player", "assistant")).toBe(false);
    expect(isDemotion("assistant", "admin")).toBe(false);
    expect(isDemotion("player", "player")).toBe(false);
  });
});

describe("describing a proposed change", () => {
  const member = { name: "Ann Doyle", role: "player" };

  it("is null when the role does not actually change", () => {
    // The regression guard: re-selecting the current role is a no-op, never a
    // silent re-save.
    expect(describeRoleChange(member, "player", 2)).toBeNull();
  });

  it("describes a promotion in both directions of the change", () => {
    const change = describeRoleChange(member, "assistant", 2);
    expect(change).toMatchObject({ name: "Ann Doyle", from: "Player", to: "Assistant", demotion: false });
  });

  it("flags a demotion so the prompt can warn what is lost", () => {
    const change = describeRoleChange({ name: "Rob", role: "admin" }, "player", 2);
    expect(change?.demotion).toBe(true);
    expect(change?.lastAdmin).toBe(false);
  });

  it("flags demoting the only organizer, the change the server refuses", () => {
    // adminCount includes this account, so 1 means there is no other organizer.
    const change = describeRoleChange({ name: "Rob", role: "admin" }, "assistant", 1);
    expect(change?.lastAdmin).toBe(true);
  });

  it("does not flag last-admin when another organizer remains", () => {
    const change = describeRoleChange({ name: "Rob", role: "admin" }, "player", 2);
    expect(change?.lastAdmin).toBe(false);
  });

  it("does not flag last-admin when the only organizer stays an organizer", () => {
    // Promoting nothing here — role is unchanged — but even a same-rank guard
    // must never treat keeping admin as removing the last one.
    expect(describeRoleChange({ name: "Rob", role: "admin" }, "admin", 1)).toBeNull();
  });
});

/**
 * THE SAME QUESTION AT THE CLUB (2026-10-13). A role there reaches every
 * tournament the club runs, and its screen still committed on the radio after
 * a tournament's had stopped. `e2e/club-staff.spec.ts` holds the screen; this
 * holds what the question says.
 */
describe("describing a proposed change of role at the club", () => {
  const label = (role: string) => ({ owner: "Commissioner", admin: "Admin", member: "Member", guest: "Guest" })[role] ?? role;
  const ask = (role: string, next: string, owners = 2) => describeOrgRoleChange({ name: "Rob", role }, next, owners, label, "club");

  it("is nothing when the role is the one they hold", () => {
    for (const role of ["owner", "admin", "member", "guest"]) expect(ask(role, role)).toBeNull();
  });

  it("names both roles in the club's own words", () => {
    expect(ask("member", "admin")).toMatchObject({ name: "Rob", from: "Member", to: "Admin", adminName: "Commissioner" });
  });

  it("calls every step down a demotion and no step up one", () => {
    const order = ["guest", "member", "admin", "owner"];
    for (const [i, from] of order.entries()) {
      for (const [j, to] of order.entries()) {
        if (i === j) continue;
        expect(ask(from, to)?.demotion, `${from} to ${to}`).toBe(j < i);
      }
    }
  });

  it("says what is handed over only when somebody starts running the club's tournaments", () => {
    // News: they did not organize anything, and now organize everything.
    expect(ask("member", "admin")?.grants).toBe("Rob becomes an organizer on every tournament this club runs.");
    expect(ask("guest", "owner")?.grants).toBe("Rob becomes an organizer on every tournament this club runs.");
    // Not news: an Admin already does, and a Member or a Guest never will.
    expect(ask("admin", "owner")?.grants).toBe("");
    expect(ask("owner", "admin")?.grants).toBe("");
    expect(ask("guest", "member")?.grants).toBe("");
  });

  it("uses the outfit's own word for itself", () => {
    expect(describeOrgRoleChange({ name: "Rob", role: "member" }, "admin", 1, label, "society")?.grants).toContain("this society runs");
  });

  it("warns when the only Commissioner would stop being one, and only then", () => {
    expect(ask("owner", "admin", 1)?.lastAdmin).toBe(true);
    expect(ask("owner", "guest", 1)?.lastAdmin).toBe(true);
    expect(ask("owner", "admin", 2)?.lastAdmin).toBe(false);
    // Somebody else moving is never the last Commissioner leaving.
    expect(ask("admin", "member", 1)?.lastAdmin).toBe(false);
  });

  it("does not say 'on the event' of a club", () => {
    expect(ask("owner", "admin", 1)?.place).toBe("");
  });
});
