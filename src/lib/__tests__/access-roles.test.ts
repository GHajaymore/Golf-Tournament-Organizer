import { describe, it, expect } from "vitest";
import { describeRoleChange, isDemotion, roleLabel } from "@/lib/access-roles";

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
