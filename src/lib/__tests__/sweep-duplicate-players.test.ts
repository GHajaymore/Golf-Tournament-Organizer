import { describe, it, expect } from "vitest";
import {
  sameKey, planCluster, mergeFill, duplicateClusters, databaseIsLocal, parseArgs, LINKS, NOT_TIES,
  type SweepPlayer, type RowTies,
} from "../../../scripts/sweep-duplicate-players";
import { readSource, readVerbatim } from "./source";

/**
 * J41, the parts that need no database: the rule, the choice of which row to
 * keep, the host guard, and two sweeps that keep the script honest about the
 * importer and the schema. The rows themselves are in
 * `sweep-duplicate-players.audit.test.ts`.
 */

const row = (o: Partial<SweepPlayer> & { id: string }): SweepPlayer => ({
  name: "", email: "", status: "confirmed", seed: 1, memberId: null, teeId: null, groupId: null, playWith: [],
  phone: "", ghin: "", homeClub: "", preferredTee: "", handicap: 0, handicapSource: "manual", handicapType: "18",
  publicNameWithheld: false, ...o,
});
const none: RowTies = { scores: 0, cards: 0, stakes: 0, team: 0, placed: false };

describe("the importer's key", () => {
  it("is the email where there is one, the name only where there is not, and nothing for neither", () => {
    expect(sameKey({ name: "Ann", email: " A@Example.Invalid " })).toBe("email:a@example.invalid");
    expect(sameKey({ name: " Ann  Lee ", email: "" })).toBe("name:ann  lee");
    expect(sameKey({ name: "  ", email: " " })).toBeNull();
  });

  it("does not match a name-only row to an email row of the same name", () => {
    const rows = [
      row({ id: "a", name: "Same Name", email: "x@example.invalid" }),
      row({ id: "b", name: "Same Name", email: "y@example.invalid" }),
      row({ id: "c", name: "Same Name", email: "" }),
    ];
    expect(duplicateClusters(rows).size).toBe(0);
  });

  it("is the key the importer uses (the importer's source, read through readSource)", () => {
    // importCsvSignups is "use server" and exports only async functions, so
    // its rule cannot be imported. Pin the spelling instead: if the importer's
    // key moves, this goes red and the sweep must follow it.
    const src = readSource("src", "app", "actions", "tournament.ts");
    expect(src).toContain("new Set(existing.map((p) => p.email.trim().toLowerCase()).filter(Boolean))");
    expect(src).toContain("existing.filter((p) => !p.email.trim()).map((p) => p.name.trim().toLowerCase())");
    expect(src).toContain("emailKey ? seenEmails.has(emailKey) : seenNames.has(nameKey)");
    // CONTROL: the pin can see a difference.
    expect(src.replace("p.name.trim().toLowerCase()", "p.name")).not.toContain(
      "existing.filter((p) => !p.email.trim()).map((p) => p.name.trim().toLowerCase())",
    );
  });
});

describe("which row is kept", () => {
  const pair = [row({ id: "old", seed: 1 }), row({ id: "new", seed: 2 })];

  it("keeps the row with ties, whichever is older", () => {
    const c = planCluster("k", pair, new Map([["new", { ...none, stakes: 1 }], ["old", none]]));
    expect(c).toMatchObject({ keep: "new", drop: ["old"], refused: null });
  });

  it("treats a tee or a flight as a tie", () => {
    const c = planCluster("k", pair, new Map([["new", { ...none, placed: true }]]));
    expect(c).toMatchObject({ keep: "new", drop: ["old"] });
  });

  it("refuses when both rows have ties, and says nothing is kept or dropped", () => {
    const c = planCluster("k", pair, new Map([["new", { ...none, team: 1 }], ["old", { ...none, scores: 2 }]]));
    expect(c.refused).toMatch(/2 of 2 rows carry ties/);
    expect(c.keep).toBeNull();
    expect(c.drop).toEqual([]);
  });

  it("refuses two different roster members", () => {
    const c = planCluster("k", [row({ id: "a", memberId: "m1" }), row({ id: "b", memberId: "m2", seed: 2 })], new Map());
    expect(c.refused).toMatch(/different roster members/);
  });

  it("with no ties keeps the one in the field, then the lowest seed", () => {
    expect(planCluster("k", [row({ id: "a", status: "withdrawn" }), row({ id: "b", seed: 2 })], new Map())).toMatchObject({ keep: "b", drop: ["a"] });
    expect(planCluster("k", [row({ id: "a", seed: 9 }), row({ id: "b", seed: 2 })], new Map())).toMatchObject({ keep: "b", drop: ["a"] });
  });

  it("lets a kept row with no roster member adopt the dropped row's", () => {
    const c = planCluster("k", [row({ id: "a" }), row({ id: "b", seed: 2, memberId: "m1" })], new Map());
    expect(c).toMatchObject({ keep: "a", drop: ["b"], adoptMemberId: "m1" });
  });

  it("handles three of a kind", () => {
    const c = planCluster("k", [row({ id: "a" }), row({ id: "b", seed: 2 }), row({ id: "c", seed: 3 })], new Map([["c", { ...none, cards: 1 }]]));
    expect(c).toMatchObject({ keep: "c", drop: ["a", "b"] });
  });
});

describe("what the kept row takes from the dropped one", () => {
  const keep = row({ id: "k" });
  it("fills empty fields, handicap with its source, and a privacy choice", () => {
    const m = mergeFill(keep, [row({ id: "d", phone: "123", ghin: "9", homeClub: "H", preferredTee: "Blue", handicap: 12.4, handicapSource: "ghin", handicapType: "9", publicNameWithheld: true })]);
    expect(m).toEqual({ fill: { phone: "123", ghin: "9", homeClub: "H", preferredTee: "Blue", handicap: 12.4, handicapSource: "ghin", handicapType: "9", publicNameWithheld: true } });
  });
  it("never overwrites what the kept row holds, and takes nothing when the values agree", () => {
    expect(mergeFill(row({ id: "k", phone: "1", handicap: 5 }), [row({ id: "d", phone: " 1 ", handicap: 5 })])).toEqual({ fill: {} });
  });
  it("refuses the cluster when the two hold different non-empty values", () => {
    expect(mergeFill(keep, [row({ id: "a", ghin: "1" }), row({ id: "b", ghin: "2" })])).toEqual({ conflict: "rows hold different values for ghin" });
    const c = planCluster("k", [row({ id: "a", handicap: 4 }), row({ id: "b", seed: 2, handicap: 9 })], new Map());
    expect(c.refused).toMatch(/different handicaps/);
    expect(c.drop).toEqual([]);
  });
});

describe("the host guard", () => {
  it("refuses a host= parameter that points the driver elsewhere", () => {
    expect(databaseIsLocal({ DATABASE_URL: "postgresql://u:p@localhost:5432/db?host=db.example.invalid" }).local).toBe(false);
    expect(databaseIsLocal({ DATABASE_URL: "postgresql://u:p@localhost:5432/db?host=" }).local).toBe(true);
  });
  const url = (h: string) => `postgresql://u:p@${h}:5432/db`;
  it("passes localhost and 127.0.0.1 only", () => {
    expect(databaseIsLocal({ DATABASE_URL: url("localhost"), PRISMA_DATABASE_URL: url("127.0.0.1") }).local).toBe(true);
    expect(databaseIsLocal({ DATABASE_URL: url("db.example.invalid") }).local).toBe(false);
  });
  it("refuses when EITHER url is remote, when one is unreadable, and when none is set", () => {
    expect(databaseIsLocal({ DATABASE_URL: url("localhost"), PRISMA_DATABASE_URL: url("pooler.example.invalid") }).local).toBe(false);
    expect(databaseIsLocal({ DATABASE_URL: "not a url" }).local).toBe(false);
    expect(databaseIsLocal({}).local).toBe(false);
  });
  it("is not fooled by a local-looking prefix", () => {
    expect(databaseIsLocal({ DATABASE_URL: url("localhost.example.invalid") }).local).toBe(false);
  });
});

describe("the command line", () => {
  it("defaults to the read-only report", () => {
    expect(parseArgs([])).toMatchObject({ mode: "report" });
    expect(parseArgs(["--report"])).toMatchObject({ mode: "report" });
  });
  it("needs an event to apply, and refuses both modes", () => {
    expect(parseArgs(["--apply"]).error).toMatch(/--event/);
    expect(parseArgs(["--apply", "--event"]).error).toMatch(/--event/);
    expect(parseArgs(["--apply", "--report", "--event", "e1"]).error).toBeTruthy();
    expect(parseArgs(["--apply", "--event", "e1", "--i-am-ops"])).toMatchObject({ mode: "apply", eventId: "e1", ops: true });
  });
});

describe("every column that holds a player id is either a tie or said not to be", () => {
  const schema = readVerbatim("prisma", "schema.prisma");

  /** `Model.field` for each plain scalar String column named like a player reference. */
  function playerishColumns(text: string): string[] {
    const out: string[] = [];
    let model = "";
    for (const line of text.split(/\r?\n/)) {
      const m = /^model (\w+) \{/.exec(line);
      if (m) model = m[1];
      const f = /^ {2}(\w+)\s+String\??(\[\])?(\s|$)/.exec(line);
      if (model && f && /(player\w*Id|winnerId|captainId|viceCaptainId|memberNumber|(entered|confirmed|reported)ById|\w+By)$/i.test(f[1])) out.push(`${model}.${f[1]}`);
    }
    return out;
  }

  const listed = new Set([...LINKS.flatMap((l) => [...l.fields, ...(l.containing ?? [])].map((f) => `${l.model}.${f}`)), ...Object.keys(NOT_TIES)]);

  it("has no column LINKS does not know", () => {
    const unknown = playerishColumns(schema).filter((c) => !listed.has(c));
    expect(unknown).toEqual([]);
  });

  it("lists only columns that exist", () => {
    const real = new Set(playerishColumns(schema));
    for (const l of LINKS) for (const f of l.fields) expect(real.has(`${l.model}.${f}`), `${l.model}.${f}`).toBe(true);
  });

  it("CONTROL: the sweep sees a column that is not listed", () => {
    const fake = schema.replace("model Scorecard {", "model Scorecard {\n  zzPlayerId String");
    const unknown = playerishColumns(fake).filter((c) => !listed.has(c));
    expect(unknown).toEqual(["Scorecard.zzPlayerId"]);
  });

  it("CONTROL: and sees an entered-by / reported-by column, and lists the ones the review found", () => {
    const fake = schema.replace("model Scorecard {", "model Scorecard {\n  zzEnteredById String\n  zzSignedBy String");
    expect(playerishColumns(fake).filter((c) => !listed.has(c))).toEqual(["Scorecard.zzEnteredById", "Scorecard.zzSignedBy"]);
    for (const c of ["Match.enteredById", "Match.confirmedById", "Match.attestedBy", "Match.forfeitedBy", "BracketReport.reportedById", "Expense.paidBy"]) {
      expect(listed.has(c), c).toBe(true);
      expect(NOT_TIES[c], c).toBeUndefined();
    }
  });
});
