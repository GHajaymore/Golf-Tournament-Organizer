/**
 * Bulk score import.
 *
 * A field of sixty is sixty trips through a card. Clubs already keep the
 * numbers somewhere — a spreadsheet the committee filled in, an export from
 * whatever they used last year — and retyping them is both the slowest part of
 * running an event and the part that introduces the errors.
 *
 * The shape of the file follows the format, exactly as the entry screen does,
 * because a stroke round and a match round do not record the same thing:
 *
 *   - `strokes`       Player, then a column per hole. Stroke, Stableford,
 *                     Skins, Four-Ball — anything scored on strokes.
 *   - `hole-results`  Two players, then a column per hole holding who won it.
 *   - `match-results` Two players, a winner and a margin. What a league
 *                     secretary already has in a spreadsheet.
 *
 * Nothing is imported that cannot be checked. Every row is resolved against
 * the actual field, and a name that matches nobody — or matches two people —
 * is reported rather than guessed at, because a score silently attached to the
 * wrong player is worse than no import at all.
 */

import { parseCsv, splitCsvLine } from "../csv";

export type ScoreImportShape = "strokes" | "hole-results" | "match-results";

/** One column an organizer has to put in their file. */
export interface ColumnSpec {
  /** The heading text, exactly as it should appear in row 1. */
  heading: string;
  required: boolean;
  /** What goes in the cells underneath it. */
  accepts: string;
}

export interface ImportShapeInfo {
  key: ScoreImportShape;
  label: string;
  /** The header row this shape expects, shown as the worked example. */
  example: string;
  blurb: string;
  /** Every column, named, so a file can be built without trial and error. */
  columns: ColumnSpec[];
  /** A filled-in row, so the format of the values is unambiguous. */
  sampleRow: string;
}

export const IMPORT_SHAPES: ImportShapeInfo[] = [
  {
    key: "strokes",
    label: "Strokes per hole",
    example: "Player,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18",
    blurb:
      "One row per player, one column per hole. Totals and Out/In columns are ignored, so a card copied straight out of a spreadsheet works.",
    columns: [
      {
        heading: "Player",
        required: true,
        accepts:
          "Full name as registered. A surname on its own works when only one player has it. A player id also works, for a file exported from here.",
      },
      {
        heading: "1 … 18",
        required: true,
        accepts:
          "One column per hole, headed with the hole number. Strokes taken, 1–20. Leave blank or put a dash for a hole not played.",
      },
      {
        heading: "Out, In, Total",
        required: false,
        accepts: "Ignored if present, so a card copied out of a spreadsheet needs no tidying first.",
      },
    ],
    sampleRow: "Alex Vaughn,4,5,3,4,4,4,3,4,5,4,4,3,4,5,4,3,4,4",
  },
  {
    key: "hole-results",
    label: "Who won each hole",
    example: "Player A,Player B,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18",
    blurb:
      "One row per match. Each hole holds A, B or half — the letters, a name, or 1/0/½ all read the same way.",
    columns: [
      { heading: "Player A", required: true, accepts: "One side of the match, by name." },
      {
        heading: "Player B",
        required: true,
        accepts: "The other side. Order does not matter — a row listing them the other way round is the same match.",
      },
      {
        heading: "1 … 18",
        required: true,
        accepts:
          "Who won the hole: A or B, either player's name or first name, or 1 / 0. Halved is any of H, ½, 1/2, 0.5, half, halved or AS. Blank for a hole not played.",
      },
    ],
    sampleRow: "Alex Vaughn,Sam Okafor,A,H,B,A,H,H,A,B,H,A,H,H,B,A,H,H,A,H",
  },
  {
    key: "match-results",
    label: "Final results only",
    example: "Player A,Player B,Winner,Margin",
    blurb:
      "One row per match, just the outcome. What a league secretary usually already has typed up.",
    columns: [
      { heading: "Player A", required: true, accepts: "One side of the match, by name." },
      { heading: "Player B", required: true, accepts: "The other side." },
      {
        heading: "Winner",
        required: true,
        accepts:
          "The winning player's name, or A or B. For a halved match use any of H, halved, AS or tie.",
      },
      {
        heading: "Margin",
        required: false,
        accepts:
          'How it finished — "3&2", "2 up", "1 up", "AS". Used to reconstruct the card, so the result reads the same as a typed one.',
      },
    ],
    sampleRow: "Alex Vaughn,Sam Okafor,Alex Vaughn,3&2",
  },
];

/** Which shapes a round's format can actually accept. Mirrors entryModesFor. */
export function importShapesFor(format: string): ScoreImportShape[] {
  return format === "Match Play"
    ? ["hole-results", "match-results", "strokes"]
    : ["strokes"];
}

export interface ImportProblem {
  /** 1-based row in the file as the person sees it, header included. */
  row: number;
  message: string;
}

export interface StrokeRow {
  playerId: string;
  playerName: string;
  strokes: (number | null)[];
}

export interface MatchRow {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** hole-results only. */
  holes?: ("A" | "B" | "H" | null)[];
  /** match-results only. */
  winner?: "A" | "B" | "H";
  margin?: string;
}

export interface ScoreImportResult {
  shape: ScoreImportShape;
  strokeRows: StrokeRow[];
  matchRows: MatchRow[];
  problems: ImportProblem[];
  /** Rows that resolved cleanly and can be written. */
  ready: number;
  /** Rows the file contained, header excluded. */
  seen: number;
}

export interface FieldPlayer {
  id: string;
  name: string;
}

/** Loose name matching: case, punctuation and extra spaces all ignored. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a name against the field.
 *
 * Returns the player, or a reason. An ambiguous name is a failure, never a
 * guess — two members called J. Smith is completely ordinary at a club, and
 * picking one of them silently is how a score lands on the wrong card.
 */
export function resolvePlayer(
  raw: string,
  field: FieldPlayer[],
): { player: FieldPlayer } | { error: string } {
  const wanted = normalize(raw);
  if (!wanted) return { error: "No player name in this row." };

  const exact = field.filter((p) => normalize(p.name) === wanted);
  if (exact.length === 1) return { player: exact[0] };
  if (exact.length > 1) {
    return { error: `More than one player is called "${raw.trim()}" — rename them, or use their id.` };
  }

  // Surname-or-first-name only, which is how people actually type a list.
  const partial = field.filter((p) => {
    const n = normalize(p.name);
    return n.split(" ").includes(wanted) || n.startsWith(wanted + " ");
  });
  if (partial.length === 1) return { player: partial[0] };
  if (partial.length > 1) {
    return { error: `"${raw.trim()}" matches ${partial.length} players — use their full name.` };
  }

  const byId = field.find((p) => p.id === raw.trim());
  if (byId) return { player: byId };

  return { error: `Nobody in this tournament is called "${raw.trim()}".` };
}

/** A hole's stroke count, or null for blank. Rejects anything absurd. */
function readStroke(v: string): number | null | "bad" {
  const t = v.trim();
  if (!t || t === "-" || t === "—") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "bad";
  // 1 is a hole in one; beyond 20 on a single hole is a typo or a different
  // column, and either way it should not be imported quietly.
  if (n < 1 || n > 20) return "bad";
  return n;
}

/** Who won a hole, in any of the ways people write it down. */
export function readHoleResult(
  v: string,
  aName: string,
  bName: string,
): "A" | "B" | "H" | null | "bad" {
  const t = v.trim().toLowerCase();
  if (!t || t === "-" || t === "—") return null;
  if (["a", "1", "w", "win", "won"].includes(t)) return "A";
  if (["b", "0", "l", "loss", "lost"].includes(t)) return "B";
  if (["h", "½", "1/2", "0.5", ".5", "half", "halved", "as", "tie", "t"].includes(t)) return "H";
  if (normalize(aName) && t === normalize(aName)) return "A";
  if (normalize(bName) && t === normalize(bName)) return "B";
  // A first name is what someone actually types into a hole column.
  if (normalize(aName).split(" ")[0] === t) return "A";
  if (normalize(bName).split(" ")[0] === t) return "B";
  return "bad";
}

/** Hole columns in header order, ignoring Out/In/Total. */
function holeColumns(headers: string[], holes: number): number[] {
  const cols: number[] = [];
  headers.forEach((h, i) => {
    const t = h.trim().toLowerCase();
    if (/^(out|in|tot|total|gross|net|front|back)$/.test(t)) return;
    const n = Number(t.replace(/^h(ole)?\s*/, ""));
    if (Number.isInteger(n) && n >= 1 && n <= holes) cols.push(i);
  });
  return cols;
}

/**
 * Read a file of scores.
 *
 * Never throws and never partially applies: it reports what it found and what
 * it could not, and the caller decides whether to write the rows that were
 * clean. Half an import is worse than none, because nobody can tell which half.
 */
export function parseScoreCsv(
  csv: string,
  shape: ScoreImportShape,
  field: FieldPlayer[],
  holes = 18,
): ScoreImportResult {
  const out: ScoreImportResult = {
    shape,
    strokeRows: [],
    matchRows: [],
    problems: [],
    ready: 0,
    seen: 0,
  };

  const table = parseCsv(csv);
  if (!table || table.rows.length === 0) {
    out.problems.push({ row: 1, message: "That file has no rows — check it saved as CSV." });
    return out;
  }
  out.seen = table.rows.length;

  const headers = firstLine(csv).map((h) => h.trim());
  const cols = holeColumns(headers, holes);
  const headerOf = (i: number) => headers[i] ?? "";

  if (shape !== "match-results" && cols.length === 0) {
    out.problems.push({
      row: 1,
      message: `No hole columns found. The header needs a column per hole, numbered 1 to ${holes}.`,
    });
    return out;
  }

  table.rows.forEach((row, i) => {
    const line = i + 2; // header is line 1

    if (shape === "strokes") {
      const r = resolvePlayer(row[0] ?? "", field);
      if ("error" in r) {
        out.problems.push({ row: line, message: r.error });
        return;
      }
      const strokes: (number | null)[] = new Array(holes).fill(null);
      let bad = false;
      cols.forEach((c) => {
        const hole = Number(headerOf(c).replace(/^h(ole)?\s*/i, "")) - 1;
        const v = readStroke(row[c] ?? "");
        if (v === "bad") {
          out.problems.push({
            row: line,
            message: `Hole ${hole + 1} reads "${(row[c] ?? "").trim()}" — that isn't a stroke count.`,
          });
          bad = true;
          return;
        }
        strokes[hole] = v;
      });
      if (bad) return;
      out.strokeRows.push({ playerId: r.player.id, playerName: r.player.name, strokes });
      out.ready += 1;
      return;
    }

    const ra = resolvePlayer(row[0] ?? "", field);
    const rb = resolvePlayer(row[1] ?? "", field);
    if ("error" in ra) {
      out.problems.push({ row: line, message: ra.error });
      return;
    }
    if ("error" in rb) {
      out.problems.push({ row: line, message: rb.error });
      return;
    }
    if (ra.player.id === rb.player.id) {
      out.problems.push({ row: line, message: `${ra.player.name} cannot play themselves.` });
      return;
    }

    if (shape === "hole-results") {
      const hs: ("A" | "B" | "H" | null)[] = new Array(holes).fill(null);
      let bad = false;
      cols.forEach((c) => {
        const hole = Number(headerOf(c).replace(/^h(ole)?\s*/i, "")) - 1;
        const v = readHoleResult(row[c] ?? "", ra.player.name, rb.player.name);
        if (v === "bad") {
          out.problems.push({
            row: line,
            message: `Hole ${hole + 1} reads "${(row[c] ?? "").trim()}" — expected A, B or half.`,
          });
          bad = true;
          return;
        }
        hs[hole] = v;
      });
      if (bad) return;
      out.matchRows.push({
        aId: ra.player.id,
        bId: rb.player.id,
        aName: ra.player.name,
        bName: rb.player.name,
        holes: hs,
      });
      out.ready += 1;
      return;
    }

    // match-results
    const winnerRaw = (row[2] ?? "").trim();
    const w = readHoleResult(winnerRaw, ra.player.name, rb.player.name);
    if (w === "bad" || w === null) {
      out.problems.push({
        row: line,
        message: `Winner reads "${winnerRaw}" — use a player's name, A, B, or "halved".`,
      });
      return;
    }
    // A margin has to describe a result that can happen. "2&3" — up by two
    // with three to play — is not a closed-out match; nine times in ten it is
    // "3&2" transposed, and importing it as typed writes a match the standings
    // read as still in progress, forever. Reported, never guessed at.
    const margin = (row[3] ?? "").trim();
    const amp = /^(\d+)\s*&\s*(\d+)$/.exec(margin.toUpperCase());
    if (amp) {
      const lead = parseInt(amp[1], 10);
      const toPlay = parseInt(amp[2], 10);
      if (lead <= toPlay) {
        out.problems.push({
          row: line,
          message: `"${margin}" isn't a possible result — ${lead} up with ${toPlay} to play isn't a closed-out match. Did you mean "${toPlay}&${lead}"?`,
        });
        return;
      }
      if (lead > holes) {
        out.problems.push({
          row: line,
          message: `"${margin}" can't happen over ${holes} holes.`,
        });
        return;
      }
    }
    out.matchRows.push({
      aId: ra.player.id,
      bId: rb.player.id,
      aName: ra.player.name,
      bName: rb.player.name,
      winner: w,
      margin,
    });
    out.ready += 1;
  });

  return out;
}

/** The header row for a shape, so an organizer can start from a real file. */
export function templateCsv(shape: ScoreImportShape, holes = 18): string {
  const nums = Array.from({ length: holes }, (_, i) => i + 1).join(",");
  if (shape === "strokes") return `Player,${nums}`;
  if (shape === "hole-results") return `Player A,Player B,${nums}`;
  return "Player A,Player B,Winner,Margin";
}

/** Exported for the importer's own preview, which shows the first line back. */
export function firstLine(csv: string): string[] {
  const line = csv.split(/\r?\n/).find((l) => l.trim());
  return line ? splitCsvLine(line) : [];
}
