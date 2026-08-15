import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvalModeOf,
  decideIntake,
  placementOnApproval,
  cleanRegistration,
  parseHandicapInput,
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

describe("reading a handicap the way a golfer writes one", () => {
  /**
   * D4. Both importers used bare parseFloat, which is wrong in the one place
   * it matters most: "+2.4" is a PLUS handicap — 2.4 strokes better than
   * scratch — and parseFloat reads it as 2.4 worse. Every scratch-and-better
   * player imported with the sign flipped and was then GIVEN the strokes they
   * should have been giving.
   */
  it("reads a plus handicap as better than scratch", () => {
    // Rules of Handicapping: a Handicap Index better than scratch is written
    // with a leading plus and is negative in the arithmetic — the player gives
    // strokes back to the course.
    expect(parseHandicapInput("+2.4")).toEqual({ ok: true, value: -2.4, source: "manual" });
    expect(parseHandicapInput("+0.5")).toEqual({ ok: true, value: -0.5, source: "manual" });
  });

  it("gets the sign the opposite way round from parseFloat", () => {
    // The bug, stated as the difference. If this ever passes, the old reading
    // is back.
    expect(parseHandicapInput("+2.4")).toMatchObject({ value: -2.4 });
    expect(parseFloat("+2.4")).toBe(2.4);
  });

  it("still reads an ordinary handicap unchanged", () => {
    expect(parseHandicapInput("12.4")).toEqual({ ok: true, value: 12.4, source: "manual" });
    expect(parseHandicapInput("0")).toEqual({ ok: true, value: 0, source: "manual" });
    expect(parseHandicapInput("-2.4"), "already-negative notation").toMatchObject({ value: -2.4 });
  });

  it("reads a blank box as unknown, not as scratch", () => {
    // A 0 is a claim to be scratch. An empty cell is the absence of a claim,
    // and the roster shows the two differently.
    expect(parseHandicapInput("")).toEqual({ ok: true, value: 0, source: "none" });
    expect(parseHandicapInput("   ")).toMatchObject({ source: "none" });
    expect(parseHandicapInput(null)).toMatchObject({ source: "none" });
    expect(parseHandicapInput(undefined)).toMatchObject({ source: "none" });
  });

  it("refuses what parseFloat would have accepted", () => {
    // parseFloat stops at the first character it doesn't understand and
    // returns what it has, so a spreadsheet cell of "12.4 (est)" became a
    // handicap. Nothing downstream range-checked either.
    for (const bad of ["12.4abc", "abc", "n/a", "999", "-500", "1e9", "54.1", "+10.1"]) {
      expect(parseHandicapInput(bad).ok, bad).toBe(false);
    }
  });

  it("keeps the WHS range, at both ends, inclusive", () => {
    expect(parseHandicapInput("54")).toMatchObject({ value: 54 });
    expect(parseHandicapInput("+10")).toMatchObject({ value: -10 });
  });
});

describe("the bulk delete takes the rows it counted", () => {
  /**
   * D3, client half. One `selected` Set is shared by the confirmed, waitlist
   * and pending tables — which is fine, ids are unique — but the delete used
   * every id in it while the button counted only the rows of the table it sat
   * in. Tick three confirmed and two waitlisted, press "Delete 2 selected",
   * and all five went. No confirmation, no undo, and `removeSignup`
   * hard-deleted the row.
   *
   * Asserted at the source: the failure is a mismatch between two expressions
   * in one component, and there is no rendering of it that would show it —
   * the screen looks correct right up until the rows disappear.
   */
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = stripComments(
    readFileSync(join(process.cwd(), "src/components/RegistrationClient.tsx"), "utf8"),
  );

  it("scopes the delete to this table's rows", () => {
    // It takes the rows, and narrows the selection by them. `[...selected]`
    // ignores which table asked.
    expect(src).toMatch(/const deleteSelected = \(rows: Signup\[\]\) =>/);
    expect(src).toMatch(/rows\.filter\(\(r\) => selected\.has\(r\.id\)\)\.map\(\(r\) => r\.id\)/);
    expect(src).not.toMatch(/const ids = \[\.\.\.selected\]/);
  });

  it("counts what it is about to delete the same way it selects it", () => {
    // The label and the action have to read the same expression, or the next
    // person to change one of them reopens this.
    expect(src).toMatch(/rows\.filter\(\(r\) => selected\.has\(r\.id\)\)\.length/);
    expect(src).toMatch(/onClick=\{\(\) => deleteSelected\(rows\)\}/);
  });

  it("asks before it deletes anybody", () => {
    expect(src).toMatch(/window\.confirm\(/);
  });
});

describe("every path that reads a handicap uses that one reading", () => {
  // The form was right and the two importers were wrong, and the difference
  // was invisible until a plus-handicapper entered. Asserted at the source
  // because the alternative is three copies drifting again.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8"));

  const paths = [
    "src/app/actions/roster.ts", // the club roster importer
    "src/app/actions/tournament.ts", // the entry-list importer
    "src/components/RegistrationClient.tsx", // the organizer's manual add
  ];

  for (const p of paths) {
    it(`${p.split("/").pop()} asks parseHandicapInput`, () => {
      expect(read(p)).toMatch(/parseHandicapInput\(/);
    });
  }

  it("nobody parses a handicap with parseFloat any more", () => {
    for (const p of paths) {
      const src = read(p);
      // parseFloat survives elsewhere for genuinely numeric fields; what must
      // not survive is parseFloat applied to a handicap.
      expect(src, p).not.toMatch(/parseFloat\((raw)?[Hh]andicap/);
      expect(src, p).not.toMatch(/handicap\s*=\s*parseFloat/i);
    }
  });
});

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
