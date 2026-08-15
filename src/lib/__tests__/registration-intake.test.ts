import { describe, it, expect } from "vitest";
import {
  approvalModeOf,
  decideIntake,
  placementOnApproval,
  cleanRegistration,
} from "../domain/registration-intake";

/**
 * Open (self-service) registration: the rules a stranger's sign-up runs through.
 *
 * Everything here guards one boundary — an unauthenticated public form writing
 * into a real tournament's field. The placement must match what the organizer
 * console shows, and the validation must reject junk without ever leaking a
 * thing about the event.
 */

// A field that is open, well before its deadline, with room to spare.
const OPEN = {
  eventStatus: "registration",
  deadline: "2099-12-31",
  capacity: 16,
  confirmedCount: 4,
  override: null as boolean | null,
  now: new Date("2026-01-01"),
};

describe("approval mode", () => {
  it("treats anything other than 'approve' as auto", () => {
    // The safe default: an unknown value must not silently park every entry in
    // a queue nobody is watching.
    expect(approvalModeOf("approve")).toBe("approve");
    for (const v of ["auto", "", null, undefined, "nonsense"]) {
      expect(approvalModeOf(v)).toBe("auto");
    }
  });
});

describe("where an entry lands", () => {
  it("refuses everyone when the link is switched off", () => {
    // Capacity is irrelevant — a closed switch accepts nobody, and the reason
    // is not disclosed (the caller can't tell this from a bad token).
    const d = decideIntake({ registrationOpen: false, approvalMode: "auto", reg: OPEN });
    expect(d.accepted).toBe(false);
  });

  it("confirms into a field with room, in auto mode", () => {
    const d = decideIntake({ registrationOpen: true, approvalMode: "auto", reg: OPEN });
    expect(d).toEqual({ accepted: true, status: "confirmed", waitlisted: false });
  });

  it("waitlists once the field is full, in auto mode", () => {
    const d = decideIntake({
      registrationOpen: true,
      approvalMode: "auto",
      reg: { ...OPEN, confirmedCount: 16 },
    });
    expect(d).toEqual({ accepted: true, status: "waitlisted", waitlisted: true });
  });

  it("never waitlists an unlimited field", () => {
    // capacity 0 is the "open / unlimited" sentinel used across the app.
    const d = decideIntake({
      registrationOpen: true,
      approvalMode: "auto",
      reg: { ...OPEN, capacity: 0, confirmedCount: 999 },
    });
    expect(d).toEqual({ accepted: true, status: "confirmed", waitlisted: false });
  });

  it("holds every entry as pending in approve mode, even with room", () => {
    // The whole point of approve mode: capacity is applied when the organizer
    // accepts, not on arrival. Placing a pending entry now would pre-empt them.
    const d = decideIntake({ registrationOpen: true, approvalMode: "approve", reg: OPEN });
    expect(d).toEqual({ accepted: true, status: "pending", waitlisted: false });
  });

  it("still refuses in approve mode once the deadline has passed", () => {
    // Approve mode is about placement, not about overriding a closed door.
    const d = decideIntake({
      registrationOpen: true,
      approvalMode: "approve",
      reg: { ...OPEN, deadline: "2020-01-01" },
    });
    expect(d.accepted).toBe(false);
  });

  it("refuses once the tournament has finished", () => {
    // D2: registerForEvent read the switch, the deadline and the capacity, and
    // never the event's own status — so a finished tournament kept taking
    // public entries into a field whose result was already published. The
    // switch being ON is the interesting case, because that is the state a
    // club leaves it in when the tournament ends.
    const d = decideIntake({
      registrationOpen: true,
      approvalMode: "auto",
      reg: { ...OPEN, eventStatus: "completed" },
    });
    expect(d.accepted).toBe(false);
  });

  it("refuses a finished tournament in approve mode too", () => {
    // Approve mode parks entries in a queue. A queue attached to a tournament
    // that is over is a queue nobody will ever look at.
    const d = decideIntake({
      registrationOpen: true,
      approvalMode: "approve",
      reg: { ...OPEN, eventStatus: "completed" },
    });
    expect(d.accepted).toBe(false);
  });

  it("keeps taking entries while the tournament is live", () => {
    // Not a blanket "started means closed": a club league runs for weeks and
    // members join mid-season. The organizer's switch decides that, and D2's
    // other half is that they can now reach it.
    const d = decideIntake({
      registrationOpen: true,
      approvalMode: "auto",
      reg: { ...OPEN, eventStatus: "live" },
    });
    expect(d.accepted).toBe(true);
  });

  it("refuses after the deadline, and honours an organizer extension", () => {
    const passed = { ...OPEN, deadline: "2020-01-01" };
    expect(decideIntake({ registrationOpen: true, approvalMode: "auto", reg: passed }).accepted).toBe(false);
    // override === false keeps entries open past the date (the "extended" case).
    const extended = decideIntake({
      registrationOpen: true,
      approvalMode: "auto",
      reg: { ...passed, override: false },
    });
    expect(extended).toEqual({ accepted: true, status: "confirmed", waitlisted: false });
  });
});

describe("placement when an organizer accepts a pending entry", () => {
  it("confirms while there's room and waitlists once full", () => {
    expect(placementOnApproval(16, 4)).toBe("confirmed");
    expect(placementOnApproval(16, 16)).toBe("waitlisted");
    expect(placementOnApproval(0, 999)).toBe("confirmed"); // unlimited
  });
});

describe("validating a public submission", () => {
  it("requires a name and a valid email", () => {
    expect(cleanRegistration({ name: "  ", email: "a@b.com" }).ok).toBe(false);
    expect(cleanRegistration({ name: "Pat", email: "not-an-email" }).ok).toBe(false);
    const ok = cleanRegistration({ name: "Pat Doe", email: "Pat@Club.com" });
    expect(ok.ok).toBe(true);
    // Email is lower-cased so it's one identity, not two.
    if (ok.ok) expect(ok.value.email).toBe("pat@club.com");
  });

  it("accepts a blank handicap as unknown rather than rejecting it", () => {
    // Not everyone signing up knows their index; a missing one is a 0 to be
    // corrected later, marked as source 'none' so it doesn't read as scratch.
    const r = cleanRegistration({ name: "Pat", email: "p@c.com", handicap: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.handicap).toBe(0);
      expect(r.value.handicapSource).toBe("none");
    }
  });

  it("reads a plus-handicap as a negative number", () => {
    // +2.4 is better than scratch — golfers write the plus, the app stores -2.4.
    const r = cleanRegistration({ name: "Pat", email: "p@c.com", handicap: "+2.4" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.handicap).toBeCloseTo(-2.4);
      expect(r.value.handicapSource).toBe("manual");
    }
  });

  it("rejects a handicap that isn't a number or is out of range", () => {
    expect(cleanRegistration({ name: "Pat", email: "p@c.com", handicap: "abc" }).ok).toBe(false);
    expect(cleanRegistration({ name: "Pat", email: "p@c.com", handicap: "99" }).ok).toBe(false);
    expect(cleanRegistration({ name: "Pat", email: "p@c.com", handicap: "-50" }).ok).toBe(false);
  });

  it("bounds the free-text fields a public form can't be trusted with", () => {
    const r = cleanRegistration({
      name: "Pat",
      email: "p@c.com",
      phone: "x".repeat(200),
      preferredTee: "y".repeat(200),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phone.length).toBeLessThanOrEqual(40);
      expect(r.value.preferredTee.length).toBeLessThanOrEqual(40);
    }
  });
});
