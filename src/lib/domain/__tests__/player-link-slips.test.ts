import { describe, it, expect } from "vitest";
import { SLIPS_PER_PAGE, SLIP_MM, SLIP_WORDS, slipIsNew, slipOutOfDate, slipPages, slipsFor, type SlipEntry } from "../player-link-slips";
import { PAPER_MM } from "../print-kit";

/**
 * WHO GETS A PLAYER LINK SLIP (J39/J40 PR 3; design §3.1, A10 to A12). The one
 * rule the Print kit's count and the print action both ask.
 */

const TODAY = "2026-12-05";
const LAST = "2026-12-06";

function guest(name: string, over: Partial<SlipEntry> = {}): SlipEntry {
  return { playerId: `id-${name}`, name, status: "confirmed", standing: "guest", pass: null, ...over };
}
const pass = (over: Partial<NonNullable<SlipEntry["pass"]>> = {}): NonNullable<SlipEntry["pass"]> => ({
  revokedAt: null,
  version: 1,
  slipPrintedVersion: null,
  madeDay: TODAY,
  ...over,
});
const names = (entries: SlipEntry[], onlyNew = false, lastDay = LAST) => slipsFor(entries, { today: TODAY, lastDay, onlyNew }).print.map((s) => s.name);

describe("who gets a slip", () => {
  it("a confirmed guest, with or without a link made yet", () => {
    expect(names([guest("Robin Vale"), guest("Tamsin Holloway", { pass: pass() })])).toEqual(["Robin Vale", "Tamsin Holloway"]);
  });

  it("never a member (D12), and never a guest still waiting for a place", () => {
    expect(names([guest("Esme Fairholt", { standing: "member" }), guest("Esme Two", { standing: "" })])).toEqual([]);
    expect(names([guest("Idris Penmarch", { status: "waitlisted" }), guest("Ffion Rhoswen", { status: "pending" })])).toEqual([]);
    expect(names([guest("Withdrawn One", { status: "withdrawn" })])).toEqual([]);
  });

  it("a turned-off link is counted and left out: New link makes the next one", () => {
    const plan = slipsFor([guest("Orla Brightwater", { pass: pass({ revokedAt: new Date("2026-12-01T10:00:00Z") }) })], { today: TODAY, lastDay: LAST, onlyNew: false });
    expect(plan).toEqual({ print: [], turnedOff: 1, expired: 0 });
  });

  it("a link past its 90th club day after the last round is counted as run its course", () => {
    // Worked by hand: 2026-08-01 + 90 days = 2026-10-30, before 5 December.
    const plan = slipsFor([guest("Robin Vale", { pass: pass() }), guest("Tamsin Holloway")], { today: TODAY, lastDay: "2026-08-01", onlyNew: false });
    expect(plan).toEqual({ print: [], turnedOff: 0, expired: 2 });
    // The 90th day itself still opens: 2026-09-06 + 90 = 2026-12-05.
    expect(names([guest("Robin Vale")], false, "2026-09-06")).toEqual(["Robin Vale"]);
  });

  it("only new: never printed, or printed for an older version of the link", () => {
    const entries = [
      guest("A Never", { pass: null }),
      guest("B Unprinted", { pass: pass({ version: 2 }) }),
      guest("C Printed", { pass: pass({ version: 2, slipPrintedVersion: 2 }) }),
      guest("D Stale", { pass: pass({ version: 3, slipPrintedVersion: 2 }) }),
    ];
    expect(names(entries, true)).toEqual(["A Never", "B Unprinted", "D Stale"]);
    expect(names(entries, false)).toEqual(["A Never", "B Unprinted", "C Printed", "D Stale"]);
  });
});

describe("a printed slip after New link", () => {
  it("is out of date once the link's version passes the one it was printed for", () => {
    expect(slipOutOfDate({ version: 2, slipPrintedVersion: 1 })).toBe(true);
    expect(slipOutOfDate({ version: 2, slipPrintedVersion: 2 })).toBe(false);
    expect(slipOutOfDate({ version: 2, slipPrintedVersion: null }), "never printed is not out of date").toBe(false);
    expect(slipIsNew(null)).toBe(true);
    expect(slipIsNew({ version: 1, slipPrintedVersion: 1 })).toBe(false);
  });
});

describe("the sheet", () => {
  it("is eight to a page, and eight fit inside a 10 mm margin on A4 and on US Letter", () => {
    expect(SLIPS_PER_PAGE).toBe(8);
    const slips = Array.from({ length: 17 }, (_, i) => i);
    expect(slipPages(slips).map((p) => p.length)).toEqual([8, 8, 1]);
    for (const paper of Object.values(PAPER_MM)) {
      expect(2 * SLIP_MM.w).toBeLessThanOrEqual(paper.w - 20);
      expect(4 * SLIP_MM.h).toBeLessThanOrEqual(paper.h - 20);
    }
  });

  it("speaks of a guest as a guest, never as less (UX Writer)", () => {
    const words = JSON.stringify(Object.values(SLIP_WORDS).map((v) => (typeof v === "function" ? (v as (...a: unknown[]) => string)(2, 1) : v)));
    expect(words).not.toMatch(/\b(only a guest|just a guest|limited)\b/i);
    expect(SLIP_WORDS.notYou("Robin Vale", "Spring Outing")).toBe("Robin Vale · Spring Outing. Not you? Hand this back to the desk.");
  });
});
