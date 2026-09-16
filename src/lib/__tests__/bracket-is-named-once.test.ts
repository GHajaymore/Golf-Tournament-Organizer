import { describe, it, expect } from "vitest";
import { bracketScreenName } from "@/lib/domain/bracket-name";

/**
 * ONE DESTINATION, ONE NAME PER READER.
 *
 * `/bracket` calls itself "Bracket manager" for staff and "Live bracket" for a
 * player, which is right: an organizer opens a thing they drive and a player
 * opens a thing they watch.
 *
 * The dashboard tile linking to it said "Open bracket manager" to everybody, so
 * a player was offered a manager and landed on a read-only board. Nothing was
 * exposed — the controls are gated on `isStaff` and the heading was already
 * correct — but the screen doing the INVITING was the one ignoring the role.
 *
 * Found by diffing what each role is shown on the screens both of them open.
 */

describe("what the bracket screen is called", () => {
  it("is a manager for somebody who can drive it", () => {
    expect(bracketScreenName(false)).toBe("Bracket manager");
  });

  it("is a live board for somebody who can only watch", () => {
    expect(bracketScreenName(true)).toBe("Live bracket");
  });

  it("never calls a read-only board a manager", () => {
    /**
     * The defect in one line, and the direction that matters: offering a
     * player a "manager" promises a control they will not find.
     */
    expect(bracketScreenName(true).toLowerCase()).not.toContain("manager");
  });

  it("gives the two readers different words at all", () => {
    // A single shared name would satisfy every assertion above except this
    // one, and would be the original defect with an extra function in it.
    expect(bracketScreenName(true)).not.toBe(bracketScreenName(false));
  });
});
