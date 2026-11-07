import { describe, it, expect } from "vitest";
import {
  entryStanding,
  isGuest,
  readStanding,
  defaultStanding,
  standingWritten,
  handicapIdKey,
  standingHint,
  rosterNoEmailYet,
  previewSummary,
  importButtonWords,
  memberWithoutEmail,
  STANDING_CHOICE,
  GUEST,
} from "../domain/entry-standing";
import { planCsvSignups, readChoices, maskEmail, maskHandicapId } from "../domain/csv-signups";
import { parseCsv, matchColumn, standingCell, CSV_COLUMN_ALIASES } from "../csv";
import { HANDICAP_BODIES } from "../domain/handicap-body";
import { golfTermsFor } from "../domain/golf-terms";
import { ORG_GUEST_ROLES } from "../services/access";

/**
 * MEMBER OR GUEST (the no-email player identity, PR 1; Ajay, 2026-11-07): organizers need an
 * email; members may enter without one; a guest ("Guest (not a club member)") needs none.
 *
 * The CSV default is Ajay's table, row by row, asserted here from the TABLE — not from the
 * function's branches — so a change to the code that quietly re-orders the rows goes red.
 */

describe("a stored entry's standing", () => {
  it("is what was stored", () => {
    expect(entryStanding({ standing: "guest" })).toBe("guest");
    expect(entryStanding({ standing: "member" })).toBe("member");
  });

  it("reads '' (every entry made before A039) as a member — today's behaviour, never re-labelled", () => {
    expect(entryStanding({ standing: "" })).toBe("member");
    expect(entryStanding({})).toBe("member");
    expect(entryStanding({ standing: null })).toBe("member");
  });

  it("reads an unknown value as a member, never as the guest that later work anonymises", () => {
    expect(entryStanding({ standing: "visitor" })).toBe("member");
    expect(isGuest({ standing: "Guest" })).toBe(true);
    expect(isGuest({ standing: "member" })).toBe(false);
  });

  it("is the club's own word for a guest (ORG_GUEST_ROLES), not a second vocabulary", () => {
    expect((ORG_GUEST_ROLES as readonly string[]).includes(GUEST)).toBe(true);
  });

  it("accepts only a standing this app has from a caller", () => {
    expect(readStanding("guest")).toBe("guest");
    expect(readStanding("member")).toBe("member");
    for (const bad of ["", "Guest", "admin", 1, null, undefined, {}, ["guest"]]) expect(readStanding(bad)).toBeNull();
  });
});

describe("Ajay's CSV default (design §3.3)", () => {
  const TABLE: Array<[string, Parameters<typeof defaultStanding>[0], ReturnType<typeof defaultStanding>]> = [
    ["has an email", { written: null, email: "a@example.invalid", handicapId: "", rosterMatch: false }, { standing: "member" }],
    ["no email, has a handicap ID", { written: null, email: "", handicapId: "1234567", rosterMatch: false }, { standing: "member", check: "handicap-id" }],
    ["no email, name matches a roster member", { written: null, email: "", handicapId: "", rosterMatch: true }, { standing: "member", check: "roster-name" }],
    ["no email, no ID, no match", { written: null, email: "", handicapId: "", rosterMatch: false }, { standing: "guest" }],
    ["the file says guest (with an email)", { written: "guest", email: "a@example.invalid", handicapId: "", rosterMatch: false }, { standing: "guest" }],
    ["the file says member (nothing else)", { written: "member", email: "", handicapId: "", rosterMatch: false }, { standing: "member" }],
  ];
  for (const [row, input, want] of TABLE) {
    it(row, () => expect(defaultStanding(input)).toEqual(want));
  }

  it("does not count punctuation as a handicap ID", () => {
    expect(handicapIdKey(" 12-345 67 ")).toBe("1234567");
    expect(defaultStanding({ written: null, email: "", handicapId: " - ", rosterMatch: false })).toEqual({ standing: "guest" });
  });

  it("reads the file's own words", () => {
    for (const v of ["member", "M", "Club member"]) expect(standingWritten(v, "standing"), v).toBe("member");
    for (const v of ["guest", "G", "Guest (not a club member)", "visitor", "non-member"]) expect(standingWritten(v, "standing"), v).toBe("guest");
    for (const v of ["", "Social", "Junior"]) expect(standingWritten(v, "standing"), v).toBeNull();
    expect(standingWritten("yes", "guestFlag")).toBe("guest");
    expect(standingWritten("Y", "guestFlag")).toBe("guest");
    expect(standingWritten("no", "guestFlag")).toBe("member");
    expect(standingWritten("maybe", "guestFlag")).toBeNull();
  });
});

describe("the CSV's columns", () => {
  it("names a member-or-guest column and a guest yes/no column", () => {
    expect(matchColumn("Member or guest")).toBe("standing");
    expect(matchColumn("Member/Guest")).toBe("standing");
    expect(matchColumn("Guest")).toBe("guestFlag");
    // CONTROL: a "Member" header is still the player's name, as clubs' exports use it.
    expect(matchColumn("Member")).toBe("name");
  });

  it("reads a handicap ID under every body's own name for it", () => {
    for (const h of ["Handicap ID", "WHS number", "CDH", "CDH number", "Golf ID", "GHIN"]) expect(matchColumn(h), h).toBe("ghin");
    for (const b of HANDICAP_BODIES) expect(matchColumn(b.number), b.number).toBe("ghin");
    // CONTROL: the handicap index is not the handicap ID.
    expect(matchColumn("Handicap")).toBe("handicap");
    expect(new Set(CSV_COLUMN_ALIASES.ghin).size).toBe(CSV_COLUMN_ALIASES.ghin.length);
  });

  it("reads the member-or-guest column before a guest yes/no column", () => {
    const t = parseCsv("name,member or guest,guest\nA,member,yes\nB,,yes\nC,,")!;
    expect(standingCell(t, t.rows[0])).toBe("member");
    expect(standingCell(t, t.rows[1])).toBe("guest");
    expect(standingCell(t, t.rows[2])).toBeNull();
  });
});

describe("one reading of an entry list, for the preview and the import", () => {
  const facts = { existing: [{ email: "in@example.invalid", name: "Already In" }], rosterNames: ["zz Cleo Roster"], needsPhone: false };
  const file = [
    "name,email,handicap,handicap id,member or guest,phone",
    "zz Ann,ann@example.invalid,10,,,",
    "zz Ben,,12,1234567,,",
    "zz cleo roster,,8,,,",
    "zz Dev,,20,,,",
    "zz Eve,eve@example.invalid,5,,guest,",
    ",x@example.invalid,1,,,",
    "zz Dup,in@example.invalid,1,,,",
    "zz Bad,not-an-email,1,,,",
    "zz Dev,,20,,,",
  ].join("\n");
  const table = parseCsv(file)!;

  it("gives each row the default, its check, and what goes on the entry", () => {
    const plan = planCsvSignups(table, facts, {});
    const by = (i: number) => plan[i];
    expect([by(0).standing, by(0).check]).toEqual(["member", null]);
    expect([by(1).standing, by(1).check]).toEqual(["member", "handicap-id"]);
    expect([by(2).standing, by(2).check, by(2).rosterName]).toEqual(["member", "roster-name", "zz Cleo Roster"]);
    expect([by(3).standing, by(3).check]).toEqual(["guest", null]);
    // A guest's email is never put on the entry (it would make a sign-in account).
    expect([by(4).standing, by(4).entryEmail, by(4).emailDropped]).toEqual(["guest", "", true]);
    expect(by(5).skip).toBe("invalid");
    expect(by(6).skip).toBe("duplicate");
    expect(by(7).skip).toBe("invalid");
    // The same name twice without an email: the second is a duplicate within the file.
    expect(by(8).skip).toBe("duplicate");
    // CONTROL: the rows that should import, do.
    expect(plan.filter((p) => !p.skip).map((p) => p.row)).toEqual([0, 1, 2, 3, 4]);
  });

  it("applies the organizer's switches, and a switch clears the check", () => {
    const plan = planCsvSignups(table, facts, readChoices({ 1: "guest", 3: "member" }, table.rows.length));
    expect([plan[1].standing, plan[1].check]).toEqual(["guest", null]);
    expect([plan[3].standing, plan[3].check]).toEqual(["member", null]);
  });

  it("never asks a guest for a mobile, and still asks a member where the tournament does", () => {
    const t = parseCsv("name,phone,member or guest\nzz G,,guest\nzz M,,member")!;
    const plan = planCsvSignups(t, { existing: [], rosterNames: [], needsPhone: true }, {});
    expect(plan.map((p) => p.skip)).toEqual([null, "invalid"]);
  });

  it("drops a switch it cannot trust", () => {
    expect(readChoices({ 0: "guest", 1: "admin", 99: "member", "-1": "guest", x: "member" }, 3)).toEqual({ 0: "guest" });
    expect(readChoices("guest", 3)).toEqual({});
    expect(readChoices(["guest"], 3)).toEqual({});
  });

  it("masks what the screen shows", () => {
    expect(maskEmail("dana@example.invalid")).toBe("d…@example.invalid");
    expect(maskEmail("")).toBe("");
    expect(maskHandicapId("12-345 67")).toBe("•••4567");
    expect(maskHandicapId("")).toBe("");
  });
});

describe("the words (UX Writer: a guest is never lesser)", () => {
  const us = golfTermsFor("us");
  const uk = golfTermsFor("uk");

  it("says the hint in the club's golf words", () => {
    expect(standingHint("zz Club", us)).toBe(
      "Member: belongs to zz Club. Add their email so they can sign in. Guest (not a club member): no email needed. Everyone scores from the cart QR on the day.",
    );
    expect(standingHint("", uk)).toContain("belongs to the club.");
    expect(standingHint("", uk)).toContain("from the buggy QR");
    expect(rosterNoEmailYet("zz A and zz B", us)).toBe("zz A and zz B have no email yet. They're entered and score from the cart QR.");
    expect(rosterNoEmailYet("zz A", us)).toBe("zz A has no email yet. They're entered and score from the cart QR.");
  });

  it("says before the press that a member without an email turns round codes on (TD, 2026-11-07)", () => {
    expect(memberWithoutEmail(true)).toBe(
      "They can play and score now. Add an email later so they can sign in. This also turns round codes on for this tournament.",
    );
    // A tournament that already has round codes: nothing turns on, and nothing is said about it.
    expect(memberWithoutEmail(false)).toBe("They can play and score now. Add an email later so they can sign in.");
  });

  it("counts the preview the way the design wrote it", () => {
    expect(previewSummary({ members: 18, toCheck: 3, guests: 6, skipped: 2 })).toBe("18 members (3 to check), 6 guests. 2 rows skipped.");
    expect(previewSummary({ members: 1, toCheck: 0, guests: 1, skipped: 0 })).toBe("1 member, 1 guest.");
    expect(importButtonWords(24)).toBe("Import 24 players");
    expect(importButtonWords(1)).toBe("Import 1 player");
  });

  it("never calls a guest lesser", () => {
    const words = [STANDING_CHOICE.guest, standingHint("zz", us), previewSummary({ members: 1, toCheck: 0, guests: 2, skipped: 0 })].join(" ");
    expect(words).not.toMatch(/\b(only|just|limited|basic)\b/i);
    expect(STANDING_CHOICE.guest).toBe("Guest (not a club member)");
  });
});
