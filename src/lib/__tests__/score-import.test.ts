import { describe, it, expect } from "vitest";
import {
  parseScoreCsv,
  normalizeDelimiters,
  resolvePlayer,
  readHoleResult,
  importShapesFor,
  isNetShape,
  isStrokeShape,
  templateCsv,
  IMPORT_SHAPES,
  type ScoreImportShape,
} from "../domain/score-import";

/**
 * Bulk score import.
 *
 * The rule the whole module turns on: a name that cannot be resolved to
 * exactly one player is reported, never guessed. A score silently attached to
 * the wrong player is worse than no import at all, because nobody goes looking
 * for it.
 */

const FIELD = [
  { id: "p1", name: "Alex Vaughn" },
  { id: "p2", name: "Sam Okafor" },
  { id: "p3", name: "Raj Patel" },
  { id: "p4", name: "Kim Novak" },
];

const HOLES = Array.from({ length: 18 }, (_, i) => i + 1).join(",");

describe("finding the player a row belongs to", () => {
  it("matches a full name however it is capitalised or punctuated", () => {
    for (const raw of ["Alex Vaughn", "alex vaughn", "  ALEX   VAUGHN ", "Alex O'Vaughn".replace("O'", "")]) {
      const r = resolvePlayer(raw, FIELD);
      expect("player" in r && r.player.id, raw).toBe("p1");
    }
  });

  it("matches on surname alone, which is how people type a list", () => {
    const r = resolvePlayer("Okafor", FIELD);
    expect("player" in r && r.player.id).toBe("p2");
  });

  it("refuses an ambiguous name rather than picking one", () => {
    // Two members with the same surname is completely ordinary at a club.
    const twoSmiths = [
      { id: "a", name: "John Smith" },
      { id: "b", name: "Jane Smith" },
    ];
    const r = resolvePlayer("Smith", twoSmiths);
    expect("error" in r).toBe(true);
    expect("error" in r && r.error).toContain("matches 2 players");
  });

  it("refuses a duplicate full name", () => {
    const dupes = [
      { id: "a", name: "John Smith" },
      { id: "b", name: "John Smith" },
    ];
    expect("error" in resolvePlayer("John Smith", dupes)).toBe(true);
  });

  it("says plainly when nobody matches", () => {
    const r = resolvePlayer("Nobody Here", FIELD);
    expect("error" in r && r.error).toContain("Nobody in this tournament");
  });

  it("accepts a player id, for a file exported from the app", () => {
    const r = resolvePlayer("p3", FIELD);
    expect("player" in r && r.player.name).toBe("Raj Patel");
  });
});

describe("strokes per hole", () => {
  it("reads a full card", () => {
    const csv = `Player,${HOLES}\nAlex Vaughn,${new Array(18).fill(4).join(",")}`;
    const r = parseScoreCsv(csv, "strokes", FIELD);
    expect(r.problems).toEqual([]);
    expect(r.ready).toBe(1);
    expect(r.strokeRows[0].playerId).toBe("p1");
    expect(r.strokeRows[0].strokes).toEqual(new Array(18).fill(4));
  });

  it("ignores Out, In and Total columns", () => {
    // A card copied out of a spreadsheet carries them, and treating them as
    // holes would shift the whole row.
    const front = new Array(9).fill(4);
    const back = new Array(9).fill(5);
    const csv =
      `Player,1,2,3,4,5,6,7,8,9,Out,10,11,12,13,14,15,16,17,18,In,Total\n` +
      `Alex Vaughn,${front.join(",")},36,${back.join(",")},45,81`;
    const r = parseScoreCsv(csv, "strokes", FIELD);
    expect(r.problems).toEqual([]);
    expect(r.strokeRows[0].strokes).toEqual([...front, ...back]);
  });

  it("leaves an unplayed hole blank rather than zero", () => {
    const csv = `Player,${HOLES}\nAlex Vaughn,4,4,,-,${new Array(14).fill(4).join(",")}`;
    const r = parseScoreCsv(csv, "strokes", FIELD);
    expect(r.strokeRows[0].strokes[2]).toBeNull();
    expect(r.strokeRows[0].strokes[3]).toBeNull();
  });

  it("rejects a value that cannot be a stroke count, naming the hole", () => {
    const csv = `Player,${HOLES}\nAlex Vaughn,4,99,${new Array(16).fill(4).join(",")}`;
    const r = parseScoreCsv(csv, "strokes", FIELD);
    expect(r.ready).toBe(0);
    expect(r.problems[0].message).toContain("Hole 2");
    expect(r.problems[0].row).toBe(2);
  });

  it("imports the good rows and reports the bad ones", () => {
    // Half an import is worse than none only if nobody is told — so the count
    // and the reasons both come back.
    const good = new Array(18).fill(4).join(",");
    const csv = `Player,${HOLES}\nAlex Vaughn,${good}\nWho Dis,${good}\nSam Okafor,${good}`;
    const r = parseScoreCsv(csv, "strokes", FIELD);
    expect(r.seen).toBe(3);
    expect(r.ready).toBe(2);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].row).toBe(3);
  });

  it("says so when there are no hole columns at all", () => {
    const r = parseScoreCsv("Player,Gross\nAlex Vaughn,81", "strokes", FIELD);
    expect(r.ready).toBe(0);
    expect(r.problems[0].message).toContain("No hole columns");
  });

  it("refuses an empty file rather than reporting success", () => {
    expect(parseScoreCsv("", "strokes", FIELD).problems[0].message).toContain("no rows");
  });
});

describe("who won each hole", () => {
  it("reads letters, names and fractions alike", () => {
    expect(readHoleResult("A", "Alex Vaughn", "Sam Okafor")).toBe("A");
    expect(readHoleResult("b", "Alex Vaughn", "Sam Okafor")).toBe("B");
    expect(readHoleResult("½", "Alex Vaughn", "Sam Okafor")).toBe("H");
    expect(readHoleResult("halved", "Alex Vaughn", "Sam Okafor")).toBe("H");
    expect(readHoleResult("Alex", "Alex Vaughn", "Sam Okafor")).toBe("A");
    expect(readHoleResult("Sam Okafor", "Alex Vaughn", "Sam Okafor")).toBe("B");
    expect(readHoleResult("", "Alex Vaughn", "Sam Okafor")).toBeNull();
    expect(readHoleResult("maybe", "Alex Vaughn", "Sam Okafor")).toBe("bad");
  });

  it("reads a match row", () => {
    const results = ["A", "B", "H", ...new Array(15).fill("H")].join(",");
    const csv = `Player A,Player B,${HOLES}\nAlex Vaughn,Sam Okafor,${results}`;
    const r = parseScoreCsv(csv, "hole-results", FIELD);
    expect(r.problems).toEqual([]);
    expect(r.matchRows[0]).toMatchObject({ aId: "p1", bId: "p2" });
    expect(r.matchRows[0].holes?.slice(0, 3)).toEqual(["A", "B", "H"]);
  });

  it("refuses a player playing themselves", () => {
    const csv = `Player A,Player B,${HOLES}\nAlex Vaughn,Alex Vaughn,${new Array(18).fill("H").join(",")}`;
    const r = parseScoreCsv(csv, "hole-results", FIELD);
    expect(r.ready).toBe(0);
    expect(r.problems[0].message).toContain("cannot play themselves");
  });

  it("names the hole it could not read", () => {
    const results = ["A", "wat", ...new Array(16).fill("H")].join(",");
    const csv = `Player A,Player B,${HOLES}\nAlex Vaughn,Sam Okafor,${results}`;
    const r = parseScoreCsv(csv, "hole-results", FIELD);
    expect(r.problems[0].message).toContain("Hole 2");
    expect(r.problems[0].message).toContain("expected A, B or half");
  });
});

describe("final results only", () => {
  it("reads a winner and a margin", () => {
    const csv = "Player A,Player B,Winner,Margin\nAlex Vaughn,Sam Okafor,Alex Vaughn,3&2";
    const r = parseScoreCsv(csv, "match-results", FIELD);
    expect(r.problems).toEqual([]);
    expect(r.matchRows[0]).toMatchObject({ aId: "p1", bId: "p2", winner: "A", margin: "3&2" });
  });

  it("reads a halved match", () => {
    const csv = "Player A,Player B,Winner,Margin\nAlex Vaughn,Sam Okafor,halved,AS";
    const r = parseScoreCsv(csv, "match-results", FIELD);
    expect(r.matchRows[0].winner).toBe("H");
  });

  it("refuses a winner it cannot place", () => {
    const csv = "Player A,Player B,Winner,Margin\nAlex Vaughn,Sam Okafor,Raj Patel,2up";
    const r = parseScoreCsv(csv, "match-results", FIELD);
    expect(r.ready).toBe(0);
    expect(r.problems[0].message).toContain("Winner reads");
  });
});

describe("which shapes a format accepts", () => {
  it("gives match play every shape, gross and net", () => {
    expect(importShapesFor("Match Play")).toEqual([
      "hole-results",
      "match-results",
      "strokes",
      "net-strokes",
    ]);
  });

  it("gives a stroke-based round strokes only — gross or net, no hole winners", () => {
    // Same rule the entry screen follows: a Stableford round has no hole
    // winner to import and no match margin to record. Net is a different way
    // of writing the same strokes, so it belongs to every format.
    for (const f of ["Stroke Play", "Stableford", "Skins", "Four-Ball"]) {
      expect(importShapesFor(f), f).toEqual(["strokes", "net-strokes"]);
    }
  });

  it("hands out a header row that its own parser accepts", () => {
    // The template has to be a file that actually works, or it is worse than
    // no template.
    for (const shape of IMPORT_SHAPES) {
      const header = templateCsv(shape.key);
      const body =
        shape.key === "strokes" || shape.key === "net-strokes"
          ? `Alex Vaughn,${new Array(18).fill(4).join(",")}`
          : shape.key === "hole-results"
            ? `Alex Vaughn,Sam Okafor,${new Array(18).fill("H").join(",")}`
            : "Alex Vaughn,Sam Okafor,Alex Vaughn,3&2";
      const r = parseScoreCsv(`${header}\n${body}`, shape.key, FIELD);
      expect(r.problems, shape.key).toEqual([]);
      expect(r.ready, shape.key).toBe(1);
    }
  });

  it("describes every shape it offers", () => {
    expect(IMPORT_SHAPES).toHaveLength(4);
    for (const s of IMPORT_SHAPES) {
      expect(s.blurb.length, s.key).toBeGreaterThan(30);
      expect(s.example, s.key).toContain(",");
    }
  });
});

describe("nine-hole rounds", () => {
  it("only accepts the holes that exist", () => {
    const csv = "Player,1,2,3,4,5,6,7,8,9\nAlex Vaughn,4,4,4,4,4,4,4,4,4";
    const r = parseScoreCsv(csv, "strokes", FIELD, 9);
    expect(r.problems).toEqual([]);
    expect(r.strokeRows[0].strokes).toHaveLength(9);
  });

  it("ignores columns past the hole count instead of misfiling them", () => {
    const csv = `Player,${HOLES}\nAlex Vaughn,${new Array(18).fill(4).join(",")}`;
    const r = parseScoreCsv(csv, "strokes", FIELD, 9);
    expect(r.strokeRows[0].strokes).toHaveLength(9);
  });
});

describe("a margin has to describe a possible result", () => {
  it("refuses 2&3 and suggests the transposition", () => {
    // Up by two with three to play is not a closed-out match. Imported as
    // typed, the standings read it as still in progress forever.
    const csv = "Player A,Player B,Winner,Margin\nAlex Vaughn,Sam Okafor,Alex Vaughn,2&3";
    const r = parseScoreCsv(csv, "match-results", FIELD);
    expect(r.ready).toBe(0);
    expect(r.problems[0].message).toContain("3&2");
  });

  it("refuses a margin bigger than the round", () => {
    const csv = "Player A,Player B,Winner,Margin\nAlex Vaughn,Sam Okafor,Alex Vaughn,19&1";
    const r = parseScoreCsv(csv, "match-results", FIELD);
    expect(r.ready).toBe(0);
    expect(r.problems[0].message).toContain("18 holes");
  });

  it("accepts the record 10&8, which looks wrong and isn't", () => {
    const csv = "Player A,Player B,Winner,Margin\nAlex Vaughn,Sam Okafor,Alex Vaughn,10&8";
    const r = parseScoreCsv(csv, "match-results", FIELD);
    expect(r.ready).toBe(1);
  });
});

describe("files arrive in whatever Excel produced", () => {
  it("reads a tab-separated paste straight from a spreadsheet", () => {
    const tsv = ["Player\t1\t2\t3\t4\t5\t6\t7\t8\t9", "Alex Vaughn\t4\t5\t3\t4\t4\t4\t3\t4\t5"].join("\n");
    const r = parseScoreCsv(tsv, "strokes", FIELD, 9);
    expect(r.problems).toEqual([]);
    expect(r.strokeRows[0].strokes).toEqual([4, 5, 3, 4, 4, 4, 3, 4, 5]);
  });

  it("reads a semicolon-delimited European export", () => {
    const csv = ["Player;1;2;3;4;5;6;7;8;9", "Sam Okafor;4;4;4;4;4;4;4;4;4"].join("\n");
    const r = parseScoreCsv(csv, "strokes", FIELD, 9);
    expect(r.problems).toEqual([]);
    expect(r.ready).toBe(1);
  });

  it("leaves a comma file exactly alone", () => {
    expect(normalizeDelimiters("Player,1,2\nA,4,5")).toBe("Player,1,2\nA,4,5");
  });
});

describe("net cards", () => {
  it("parses net rows exactly like gross ones — the meaning is the server's business", () => {
    const csv = `Player,${HOLES}\nAlex Vaughn,${new Array(18).fill(4).join(",")}`;
    const r = parseScoreCsv(csv, "net-strokes", FIELD);
    expect(r.problems).toEqual([]);
    expect(r.strokeRows[0].strokes).toEqual(new Array(18).fill(4));
  });

  it("is offered for every format, alongside gross", () => {
    // A club that keeps net-only sheets should be able to import them
    // whatever the round is scored as.
    expect(importShapesFor("Match Play")).toContain("net-strokes");
    expect(importShapesFor("Stableford")).toContain("net-strokes");
  });

  it("marks itself as needing conversion", () => {
    expect(isNetShape("net-strokes")).toBe(true);
    expect(isNetShape("strokes")).toBe(false);
  });

  it("hands out a header its own parser accepts", () => {
    const r = parseScoreCsv(`${templateCsv("net-strokes")}\nAlex Vaughn,${new Array(18).fill(4).join(",")}`, "net-strokes", FIELD);
    expect(r.ready).toBe(1);
  });

  it("is a stroke shape, so it takes the per-player branch", () => {
    // The bug this pins: both the importer and the server action branched on
    // `shape === "strokes"`, so a net file parsed cleanly, said "1 of 1 row
    // ready", sent zero rows, and answered "Nothing to import." Every row a
    // net file produces lands in strokeRows — never matchRows — so anything
    // deciding which list to read has to say yes to both stroke shapes.
    expect(isStrokeShape("net-strokes")).toBe(true);
    expect(isStrokeShape("strokes")).toBe(true);
    expect(isStrokeShape("hole-results")).toBe(false);
    expect(isStrokeShape("match-results")).toBe(false);

    const r = parseScoreCsv(
      `${templateCsv("net-strokes")}\nAlex Vaughn,${new Array(18).fill(4).join(",")}`,
      "net-strokes",
      FIELD,
    );
    expect(r.matchRows).toEqual([]);
    expect(r.strokeRows).toHaveLength(1);
  });

  it("routes every offered shape to a list the parser actually fills", () => {
    // Guards the pairing itself rather than one shape: a fifth shape added
    // tomorrow fails here unless whoever adds it says which list it fills.
    const row = (s: ScoreImportShape) =>
      s === "match-results"
        ? "Alex Vaughn,Sam Okafor,Alex Vaughn,3&2"
        : s === "hole-results"
          ? `Alex Vaughn,Sam Okafor,${new Array(18).fill("A").join(",")}`
          : `Alex Vaughn,${new Array(18).fill(4).join(",")}`;
    for (const shape of ["strokes", "net-strokes", "hole-results", "match-results"] as ScoreImportShape[]) {
      const r = parseScoreCsv(`${templateCsv(shape)}\n${row(shape)}`, shape, FIELD);
      expect(r.ready, shape).toBe(1);
      const filled = isStrokeShape(shape) ? r.strokeRows : r.matchRows;
      expect(filled, shape).toHaveLength(1);
    }
  });
});
