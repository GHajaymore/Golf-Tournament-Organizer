import { describe, it, expect } from "vitest";
import {
  defaultPaper,
  docsFrom,
  fingerprintOf,
  goneSheets,
  paperFrom,
  paperRefusals,
  parsePrintLog,
  sheetStatuses,
  staleSentence,
  strokesByNine,
  withPrinted,
  type KitSheet,
} from "../print-kit";

/**
 * THE PRINT KIT'S RULES (2026-10-23) — the paper, what was printed and whether
 * it is still true, a player's strokes on a sign, and what paper never carries.
 * The pages themselves are walked in `e2e/print-kit.spec.ts`; the strokes on
 * them against the score-entry screen in `print-kit-paper-equals-screen.audit.test.ts`.
 */

describe("the paper a club prints on", () => {
  it("is US Letter in the Americas that use it, A4 everywhere else", () => {
    for (const c of ["US", "United States", "CA", "MX", "PH"]) expect(defaultPaper(c), c).toBe("letter");
    for (const c of ["GB", "United Kingdom", "IE", "DE", "AU", "ZA", "IN", "JP"]) expect(defaultPaper(c), c).toBe("a4");
  });
  it("follows the app's default for a club that has not said — the United States", () => {
    expect(defaultPaper("")).toBe("letter");
    expect(defaultPaper(null)).toBe("letter");
  });
  it("takes the switch over the country, and nothing else from the address", () => {
    expect(paperFrom("a4", "letter")).toBe("a4");
    expect(paperFrom("letter", "a4")).toBe("letter");
    expect(paperFrom("tabloid", "a4")).toBe("a4");
    expect(paperFrom(undefined, "letter")).toBe("letter");
  });
});

describe("the documents the address may tick", () => {
  it("keeps the known ones, in the hub's order, and drops the rest", () => {
    expect(docsFrom("start,signs,cards,bogus")).toEqual(["cards", "signs", "start"]);
    expect(docsFrom("")).toEqual([]);
  });
});

describe("a sheet's fingerprint", () => {
  it("is the same for the same sheet however its object was built", () => {
    expect(fingerprintOf({ a: 1, b: [1, 2], c: { d: "x" } })).toBe(fingerprintOf({ c: { d: "x" }, b: [1, 2], a: 1 }));
  });
  it("changes with anything printed on it: a name, a time, a stroke, a code", () => {
    const base = { group: "Group 1", time: "8:00 AM", players: [{ name: "Ann", shots: [0, 1, 0] }], code: "ABCD-EFGH" };
    const fp = fingerprintOf(base);
    expect(fingerprintOf({ ...base, time: "8:10 AM" })).not.toBe(fp);
    expect(fingerprintOf({ ...base, players: [{ name: "Bea", shots: [0, 1, 0] }] })).not.toBe(fp);
    expect(fingerprintOf({ ...base, players: [{ name: "Ann", shots: [1, 0, 0] }] })).not.toBe(fp);
    expect(fingerprintOf({ ...base, code: "ABCD-EFGJ" })).not.toBe(fp);
  });
});

describe("what was printed, and whether it is still true", () => {
  const sheet = (key: string, fp: string): KitSheet => ({ key, doc: "signs", label: `${key} — cart sign`, fp });
  const at = new Date("2026-10-23T07:12:00Z");

  it("a sheet never printed is unprinted, and printing it makes it version 1 and current", () => {
    const s = [sheet("signs:Group 1", "a")];
    expect(sheetStatuses(parsePrintLog(""), s)[0].state).toBe("unprinted");
    const log = withPrinted(parsePrintLog(""), s, at);
    const [st] = sheetStatuses(log, s);
    expect(st.state).toBe("current");
    expect(st.printedVersion).toBe(1);
    expect(log.sheets["signs:Group 1"].at).toBe(at.toISOString());
  });

  it("a change after printing makes it stale, and only it", () => {
    const log = withPrinted(parsePrintLog(""), [sheet("signs:Group 1", "a"), sheet("signs:Group 2", "b")], at);
    const now = sheetStatuses(log, [sheet("signs:Group 1", "a2"), sheet("signs:Group 2", "b")]);
    expect(now.map((s) => s.state)).toEqual(["stale", "current"]);
    expect(now[0].nextVersion).toBe(2);
  });

  it("a reprint of what changed is the next version; another copy of the same is not", () => {
    let log = withPrinted(parsePrintLog(""), [sheet("k", "a")], at);
    log = withPrinted(log, [sheet("k", "a")], at);
    expect(log.sheets.k.version).toBe(1);
    log = withPrinted(log, [sheet("k", "b")], at);
    expect(log.sheets.k.version).toBe(2);
  });

  it("names a printed sheet whose group has gone — within the documents still offered", () => {
    const log = withPrinted(parsePrintLog(""), [sheet("signs:Group 4", "a")], at);
    expect(goneSheets(log, [], ["signs"])).toEqual([{ key: "signs:Group 4", label: "signs:Group 4 — cart sign" }]);
    // CONTROL: not when the document is not offered for the round at all.
    expect(goneSheets(log, [], ["cards"])).toEqual([]);
  });

  it("survives a stored log that is not one", () => {
    for (const junk of ["", "{", "null", '{"sheets":5}', '{"sheets":{"k":{"fp":1}}}']) {
      expect(parsePrintLog(junk).sheets, junk).toEqual({});
    }
  });

  it("says how many in words a secretary acts on", () => {
    expect(staleSentence(0)).toBe("");
    expect(staleSentence(1)).toBe("1 printed sheet is out of date — reprint it");
    expect(staleSentence(3)).toBe("3 printed sheets are out of date — reprint these");
  });
});

describe("a player's strokes, as a list per nine", () => {
  it("names the holes, and says two strokes on a hole as ×2", () => {
    const shots = [1, 0, 0, 2, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    expect(strokesByNine(shots, 1)).toEqual([
      { label: "Holes 1–9", holes: "1, 4×2, 9" },
      { label: "Holes 10–18", holes: "11" },
    ]);
  });
  it("numbers a back nine from 10, and says none where there are none", () => {
    expect(strokesByNine([0, 0, 1, 0, 0, 0, 0, 0, 0], 10)).toEqual([{ label: "Holes 10–18", holes: "12" }]);
    expect(strokesByNine(new Array(9).fill(0), 1)).toEqual([{ label: "Holes 1–9", holes: "none" }]);
  });
  it("says a plus handicap's stroke given back", () => {
    expect(strokesByNine([0, -1, 0, 0, 0, 0, 0, 0, 0], 1)).toEqual([{ label: "Holes 1–9", holes: "2 (gives 1)" }]);
  });
});

describe("what paper never carries", () => {
  it("passes the words a sheet is made of", () => {
    expect(
      paperRefusals([
        "Wilhelmina Fotheringay-Pemberton-Ashcombe of Lower Hadleigh",
        "Holes 1–9: 1, 4×2, 9",
        "8:00 AM",
        "Course hcp 20 · Playing hcp 19",
        "380",
        "Printed 8:12 AM, 23 Oct 2026 · version 2",
        "Scored live with TourneyHQ · tourneyhq.club/play",
        "Hole 12A",
      ]),
    ).toEqual([]);
  });
  it("CONTROL: catches an email, a phone number, money and the words of a sale", () => {
    const caught = (t: string) => paperRefusals([t]).length;
    expect(caught("ann@example.invalid")).toBe(1);
    expect(caught("Call 0161 496 0000")).toBe(1);
    expect(caught("(513) 555-0142")).toBe(1);
    expect(caught("Entry $20")).toBe(1);
    expect(caught("£5 a head")).toBe(1);
    expect(caught("20 USD")).toBe(1);
    expect(caught("Free to enter")).toBe(1);
    expect(caught("Sign up today")).toBe(1);
    expect(caught("Betting closes at noon")).toBe(1);
  });
  it("reads each piece of text on its own, so yardages side by side are not a phone number", () => {
    expect(paperRefusals(["380", "510", "165", "420"])).toEqual([]);
    // CONTROL: the same figures run together are.
    expect(paperRefusals(["380 510 165 420"]).length).toBe(1);
  });
});
