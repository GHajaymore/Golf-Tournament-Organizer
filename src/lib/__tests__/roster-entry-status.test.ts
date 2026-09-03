import { describe, it, expect } from "vitest";
import { memberEntryFor, fieldSizeOf, type EntryRow } from "@/lib/domain/roster-link";

/**
 * What the roster screen says about a member, and how many it calls the field.
 *
 * It asked one question — "is there a Player row?" — and tagged every answer
 * "in field". That is wrong for three of the four statuses. A waitlisted
 * member has no place, a pending one has asked and not been approved, and a
 * withdrawn one has left; all three read as being in the tournament, and the
 * organizer on this page is deciding who to add. The card said "35 entered in
 * the open tournament" for a field of thirty while Registration, one tab away,
 * said thirty, and both numbers were badged green.
 */

const member = { id: "m1", email: "Rita@Example.invalid" };

const entry = (status: string, over: Partial<EntryRow> = {}): EntryRow => ({
  memberId: "m1",
  email: "rita@example.invalid",
  status,
  ...over,
});

describe("where a member stands in the open tournament", () => {
  it("is in the field when confirmed", () => {
    expect(memberEntryFor(member, [entry("confirmed")])).toEqual({ status: "in", live: true });
  });

  it("is waiting, not in, when waitlisted", () => {
    expect(memberEntryFor(member, [entry("waitlisted")])).toEqual({
      status: "waitlisted",
      live: true,
    });
  });

  it("is awaiting approval, not in, when pending", () => {
    expect(memberEntryFor(member, [entry("pending")])).toEqual({ status: "pending", live: true });
  });

  it("is OUT when withdrawn, and may be entered again", () => {
    /**
     * The half that stranded people. A withdrawn member was tagged "in field"
     * and greyed out of the picker, so the only way back into the tournament
     * they had left was the other add path entirely.
     */
    expect(memberEntryFor(member, [entry("withdrawn")])).toEqual({ status: "out", live: false });
  });

  it("is out when they have no entry at all", () => {
    expect(memberEntryFor(member, [])).toEqual({ status: "out", live: false });
  });

  it("matches on email when the entry has no roster link", () => {
    // An entry imported before the roster existed carries an address and no
    // memberId, and must still count as this person.
    const row = entry("confirmed", { memberId: null });
    expect(memberEntryFor(member, [row]).status).toBe("in");
  });

  it("matches an address whatever its case", () => {
    const row = entry("confirmed", { memberId: null, email: "RITA@EXAMPLE.INVALID" });
    expect(memberEntryFor(member, [row]).status).toBe("in");
  });

  it("does not claim a stranger's entry", () => {
    const row = entry("confirmed", { memberId: "someone-else", email: "other@example.invalid" });
    expect(memberEntryFor(member, [row])).toEqual({ status: "out", live: false });
  });

  it("ignores a member with no email against an entry with none either", () => {
    // Two blanks are not a match; that would make every unlinked entry belong
    // to every member without an address.
    const blank = { id: "m2", email: "" };
    const row = entry("confirmed", { memberId: null, email: "" });
    expect(memberEntryFor(blank, [row])).toEqual({ status: "out", live: false });
  });

  it("takes the strongest live claim when somebody has re-entered", () => {
    /**
     * A member can hold more than one row across a tournament's life —
     * withdrawn in the morning, re-entered in the afternoon. The order of the
     * rows is whatever the query returned, so the answer must not depend on it.
     */
    const rows = [entry("withdrawn"), entry("confirmed")];
    expect(memberEntryFor(member, rows).status).toBe("in");
    expect(memberEntryFor(member, [...rows].reverse()).status).toBe("in");
  });

  it("still reports a withdrawal as live when a queue place survives it", () => {
    const rows = [entry("withdrawn"), entry("waitlisted")];
    expect(memberEntryFor(member, rows)).toEqual({ status: "waitlisted", live: true });
  });
});

describe("how many the screen calls the field", () => {
  const other = (status: string, n: number): EntryRow => ({
    memberId: `x${n}`,
    email: `x${n}@example.invalid`,
    status,
  });

  it("counts the confirmed entries and nothing else", () => {
    // The audit's own numbers: thirty in the field, thirty-five rows.
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => other("confirmed", i)),
      ...Array.from({ length: 3 }, (_, i) => other("withdrawn", 100 + i)),
      ...Array.from({ length: 2 }, (_, i) => other("pending", 200 + i)),
    ];
    expect(rows).toHaveLength(35);
    expect(fieldSizeOf(rows)).toBe(30);
  });

  it("does not count a queue place as a place", () => {
    expect(fieldSizeOf([other("confirmed", 1), other("waitlisted", 2)])).toBe(1);
  });

  it("is zero for a tournament nobody has entered", () => {
    expect(fieldSizeOf([])).toBe(0);
  });
});
