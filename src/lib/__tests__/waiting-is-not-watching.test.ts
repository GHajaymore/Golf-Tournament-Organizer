import { describe, it, expect } from "vitest";
import { isWatching, isWaiting, switcherFor, type SwitchableRow } from "@/lib/domain/tournament-switcher";

/**
 * A MEMBER ON THE WAITING LIST IS NOT A SPECTATOR.
 *
 * `entered` means CONFIRMED — the rule `myPlayerIds` and every card guard use,
 * and rightly, because a waitlisted entry must never be handed a card. The
 * cost was that `!entered` swept the APPLICANT in with the STRANGER, and three
 * screens branched on the result:
 *
 *   Today          "You aren't entered in this tournament, so there's no card
 *                   here." — said to somebody who had put their name down
 *   the switcher   a "Watching · read-only" pill
 *   the play tabs  Money hidden (right, and right for both)
 *
 * Measured on the seeded club's Am-Am on 2026-09-20: the events list row Today
 * was reading already carried "You’re on the waiting list — the organizer will
 * confirm your place", so one screen contradicted the other off the same
 * object. The right answer existed one field away and had no way to travel —
 * the dominant cause in `a-screen-answering-the-wrong-question`.
 */

function row(over: Partial<SwitchableRow> = {}): SwitchableRow {
  return {
    eventId: "zz-ev",
    name: "zz Medal",
    band: "closed",
    bandLabel: "Closed",
    entered: false,
    canView: true,
    ...over,
  };
}

describe("waiting, watching and entered are three states", () => {
  it("calls a waitlisted member waiting, and not watching", () => {
    const waitlisted = row({ waiting: true });
    expect(isWaiting(waitlisted, false), "an applicant is waiting").toBe(true);
    expect(isWatching(waitlisted, false), "an applicant is not a spectator").toBe(false);
  });

  it("still calls a member in neither state watching", () => {
    // The half a narrow fix breaks: most of the events list.
    const stranger = row();
    expect(isWatching(stranger, false)).toBe(true);
    expect(isWaiting(stranger, false)).toBe(false);
  });

  it("says neither of a confirmed entrant", () => {
    const entrant = row({ entered: true });
    expect(isWatching(entrant, false)).toBe(false);
    expect(isWaiting(entrant, false)).toBe(false);
  });

  it("says neither of staff, who are running it rather than queuing for it", () => {
    // `isWatching` has excluded staff since it was written; `isWaiting` has to
    // agree or an organizer reviewing the player view is told they are in a
    // queue for their own tournament.
    expect(isWatching(row({ waiting: true }), true)).toBe(false);
    expect(isWaiting(row({ waiting: true }), true)).toBe(false);
    expect(isWatching(row(), true)).toBe(false);
  });

  it("a caller that knows nothing about waiting behaves exactly as before", () => {
    // `waiting` is optional on the row on purpose. Every existing caller
    // passes rows without it, and must keep the old answer.
    const old = row();
    delete (old as { waiting?: boolean }).waiting;
    expect(isWatching(old, false)).toBe(true);
    expect(isWaiting(old, false)).toBe(false);
  });

  describe("and the switcher says so", () => {
    it("labels the waiting row 'Waiting list' rather than 'Watching'", () => {
      const s = switcherFor([row({ eventId: "zz-a", waiting: true })], "zz-a", false);
      expect(s.current?.waiting).toBe(true);
      expect(s.current?.watching).toBe(false);
      expect(s.current?.note).toContain("Waiting list");
      expect(s.current?.note, "the old word survived").not.toContain("Watching");
    });

    it("still labels a spectator's row 'Watching'", () => {
      const s = switcherFor([row({ eventId: "zz-b" })], "zz-b", false);
      expect(s.current?.watching).toBe(true);
      expect(s.current?.waiting).toBe(false);
      expect(s.current?.note).toContain("Watching");
    });

    it("says 'You’re in' for an entrant, as it always did", () => {
      const s = switcherFor(
        [row({ eventId: "zz-c", entered: true, band: "entered", bandLabel: "You’re in" })],
        "zz-c",
        false,
      );
      expect(s.current?.note).toContain("You’re in");
      expect(s.current?.waiting).toBe(false);
      expect(s.current?.watching).toBe(false);
    });
  });
});
