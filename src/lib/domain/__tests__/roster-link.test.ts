import { describe, it, expect } from "vitest";
import { unlinkedPlayers, fieldRosterSummary } from "@/lib/domain/roster-link";

const p = (over: Partial<{ id: string; name: string; email: string; memberId: string | null }> = {}) => ({
  id: "p1",
  name: "Tom Halloran",
  email: "tom@example.invalid",
  memberId: null,
  ...over,
});

describe("who in the field is on the roster", () => {
  it("links by member id", () => {
    expect(unlinkedPlayers([p({ memberId: "m1" })], [{ id: "m1", email: "" }])).toEqual([]);
  });

  it("links by email when the entry predates the roster", () => {
    // The common case: a field typed in or imported before the club list
    // existed, then a member added later with the same address.
    expect(unlinkedPlayers([p()], [{ id: "m9", email: "TOM@example.invalid" }])).toEqual([]);
  });

  it("does not link a stale member id to a member who no longer exists", () => {
    // A deleted member leaves entries pointing at nothing. Reporting those as
    // linked would hide them from the one screen that could repair them.
    expect(unlinkedPlayers([p({ memberId: "gone" })], [{ id: "m1", email: "" }])).toHaveLength(1);
  });

  it("counts a player with no email and no member as unlinked", () => {
    // Placeholders from resizing a field, and anything entered before the
    // roster existed. There is nothing to match them on, and saying so is the
    // point rather than a hole in the matching.
    expect(unlinkedPlayers([p({ email: "", memberId: null })], [])).toHaveLength(1);
  });

  it("never matches two people on a shared blank email", () => {
    // Blank must not be a key. Otherwise one member with no address would
    // silently absorb every entry that also had none.
    const players = [p({ id: "a", email: "" }), p({ id: "b", email: "" })];
    expect(unlinkedPlayers(players, [{ id: "m1", email: "" }])).toHaveLength(2);
  });

  it("finds only the unlinked ones in a mixed field", () => {
    const field = [
      p({ id: "a", memberId: "m1" }),
      p({ id: "b", email: "sam@example.invalid" }),
      p({ id: "c", email: "", memberId: null }),
    ];
    const members = [{ id: "m1", email: "" }, { id: "m2", email: "sam@example.invalid" }];
    expect(unlinkedPlayers(field, members).map((x) => x.id)).toEqual(["c"]);
  });
});

describe("what the count says", () => {
  it("explains a field where nobody is on the roster", () => {
    // The exact contradiction this exists to end: 32 confirmed on one screen,
    // a bare 0 on the next.
    const s = fieldRosterSummary(32, 32);
    expect(s.linked).toBe(0);
    expect(s.note).toBe("none of the 32 in the field are on the roster yet");
  });

  it("explains a partial gap", () => {
    const s = fieldRosterSummary(32, 5);
    expect(s.linked).toBe(27);
    expect(s.note).toMatch(/5 more in the field aren’t on the roster yet/);
  });

  it("says nothing special when everyone is accounted for", () => {
    const s = fieldRosterSummary(32, 0);
    expect(s.linked).toBe(32);
    expect(s.note).toBe("entered in the open tournament");
  });

  it("handles an empty tournament without claiming a gap", () => {
    expect(fieldRosterSummary(0, 0).note).toBe("nobody entered yet");
  });

  it("reads properly for one", () => {
    expect(fieldRosterSummary(10, 1).note).toMatch(/1 more in the field isn’t/);
  });

  it("never reports a negative linked count", () => {
    // Defensive: the two numbers come from separate queries, so a race between
    // them must degrade to zero rather than to "-1 of 3".
    expect(fieldRosterSummary(3, 5).linked).toBe(0);
  });
});
