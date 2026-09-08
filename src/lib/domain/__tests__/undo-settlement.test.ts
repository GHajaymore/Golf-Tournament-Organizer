import { describe, it, expect } from "vitest";
import { canUndoSettlement } from "../expenses";

const handover = {
  recordedBy: "Priya Nair",
  fromPlayerId: "p-priya",
  toPlayerId: "p-aj",
};

describe("who may undo a recorded handover", () => {
  it("lets an organizer undo anything", () => {
    expect(canUndoSettlement(handover, { isStaff: true })).toBe(true);
    // Staff even when they are nobody named on it and did not record it.
    expect(
      canUndoSettlement(handover, { isStaff: true, name: "Someone Else", playerId: "p-other" }),
    ).toBe(true);
  });

  it("lets whoever recorded it undo it, by name or by email", () => {
    expect(canUndoSettlement(handover, { name: "Priya Nair" })).toBe(true);
    // `recordedBy` stores `session.name || session.email`, so a session with no
    // name records an email and must still match.
    const byEmail = { ...handover, recordedBy: "priya@example.invalid" };
    expect(canUndoSettlement(byEmail, { email: "PRIYA@example.invalid" })).toBe(true);
  });

  it("lets EITHER party undo it, whoever recorded it", () => {
    /**
     * The sharper half of the rule. The two people are the ones who know
     * whether the money actually changed hands — a handover recorded between
     * them by an assistant, which neither of them can remove, is worse than
     * one anybody can make.
     */
    expect(canUndoSettlement(handover, { playerId: "p-priya" }), "the payer").toBe(true);
    expect(canUndoSettlement(handover, { playerId: "p-aj" }), "the payee").toBe(true);
  });

  it("refuses a player who is neither party nor the recorder", () => {
    expect(canUndoSettlement(handover, { name: "Tom Halloran", playerId: "p-tom" })).toBe(false);
  });

  it("refuses on empty identity rather than matching everything", () => {
    // The failure that would let anybody undo anything: a blank viewer, or a
    // settlement whose recordedBy was never written, matching on "" === "".
    expect(canUndoSettlement(handover, {})).toBe(false);
    expect(canUndoSettlement(handover, { name: "", email: "", playerId: "" })).toBe(false);
    expect(canUndoSettlement({ ...handover, recordedBy: "" }, { name: "" })).toBe(false);
    expect(canUndoSettlement({ ...handover, recordedBy: "" }, { playerId: "" })).toBe(false);
  });

  it("does not let a blank player id match a settlement with blank parties", () => {
    // A settlement row is never written with empty parties, but "" === "" is
    // exactly how a permission check accidentally returns true for everyone.
    const blank = { recordedBy: "", fromPlayerId: "", toPlayerId: "" };
    expect(canUndoSettlement(blank, { playerId: "" })).toBe(false);
    expect(canUndoSettlement(blank, { name: "" })).toBe(false);
  });
});
