import { cardRefusal } from "./scorecard-parse";

/**
 * LOADING THE COURSE CATALOGUE INTO PRODUCTION, WITHOUT ANYBODY HOLDING ITS DATABASE (Ajay, J29).
 *
 * The development catalogue holds the clean OpenGolfAPI cards (ODbL: open data, credit required).
 * `scripts/export-catalogue.ts` writes them to a file outside the repo; the owner uploads that file
 * on /owner and the APP writes the rows. This is the pure half: what a row must be to be stored,
 * and why one is not. No database, no clock.
 *
 * TWO REFUSALS, NEVER MIXED:
 *   - a `gca:` id is GolfCourseAPI's, whose terms forbid compiling its dataset. It is refused by id,
 *     before anything else is read, and counted apart from the rest.
 *   - anything else not fit to store (no card, a card `cardRefusal` refuses, a malformed row) is
 *     SKIPPED and counted. A row is never stored blank: the catalogue's rule is that an empty card is
 *     a card the importer refused, and this load only ever brings in cards that pass.
 */

export const CATALOGUE_FORMAT = "tourneyhq-catalogue";
export const CATALOGUE_VERSION = 1;

/** The id prefix of GolfCourseAPI's rows. Never exported, never loaded. */
export const GCA_PREFIX = "gca:";

/** Rows per request. Each row is a few KB; a server action's body is held to 1 MB by default. */
export const CHUNK_ROWS = 100;
/** And no request over this many characters, whatever the row count. */
export const CHUNK_CHARS = 600_000;

export interface CatalogueRow {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  website: string;
  address: string;
  par: number;
  pars: string;
  yards: string;
  strokeIndex: string;
  tees: string;
  cardProblem: string;
}

export interface CatalogueFile {
  format: typeof CATALOGUE_FORMAT;
  version: number;
  count: number;
  exportedFrom: string;
  courses: unknown[];
}

export type RowVerdict =
  | { ok: true; row: CatalogueRow }
  | { ok: false; kind: "gca" | "skipped"; id: string; reason: string };

const TEXT = ["name", "city", "state", "country", "website", "address"] as const;
const MAX_TEXT = 500;

function numbers(json: unknown): number[] | null {
  if (typeof json !== "string" || json === "") return null;
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v) || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return v as number[];
  } catch {
    return null;
  }
}

/** Is this id GolfCourseAPI's? The one test, used by the export, the load and the sweep. */
export function isGcaId(id: unknown): boolean {
  return typeof id === "string" && id.trim().toLowerCase().startsWith(GCA_PREFIX);
}

/** Judge one incoming row. The id is read first, so a `gca:` row is refused whatever else it holds. */
export function judgeRow(raw: unknown): RowVerdict {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (isGcaId(id)) return { ok: false, kind: "gca", id, reason: "GolfCourseAPI's terms forbid compiling its dataset." };
  if (!id.trim() || id.length > 200) return { ok: false, kind: "skipped", id, reason: "No usable id." };
  for (const k of TEXT) {
    if (r[k] !== undefined && (typeof r[k] !== "string" || (r[k] as string).length > MAX_TEXT)) {
      return { ok: false, kind: "skipped", id, reason: `${k} is not text.` };
    }
  }
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return { ok: false, kind: "skipped", id, reason: "No name." };
  if (typeof r.cardProblem === "string" && r.cardProblem !== "") {
    return { ok: false, kind: "skipped", id, reason: "The source refused this card." };
  }
  const pars = numbers(r.pars);
  const strokeIndex = numbers(r.strokeIndex);
  if (!pars || !strokeIndex) return { ok: false, kind: "skipped", id, reason: "No card." };
  // Judged exactly as the catalogue importers judge it: pars and stroke index only, yardage never
  // a reason (docs/claude/course-cards.md).
  const refusal = cardRefusal(pars, [], strokeIndex, pars.length);
  if (refusal) return { ok: false, kind: "skipped", id, reason: refusal };
  const yards = r.yards === "" || r.yards === undefined ? [] : numbers(r.yards);
  if (!yards || (yards.length !== 0 && yards.length !== pars.length)) {
    return { ok: false, kind: "skipped", id, reason: "The yardage does not match the holes." };
  }
  let tees = "[]";
  if (r.tees !== undefined && r.tees !== "") {
    try {
      if (typeof r.tees !== "string" || !Array.isArray(JSON.parse(r.tees))) throw new Error("not a list");
      tees = r.tees;
    } catch {
      return { ok: false, kind: "skipped", id, reason: "The tees are not a list." };
    }
  }
  const par = typeof r.par === "number" && Number.isInteger(r.par) && r.par >= 0 && r.par <= 200 ? r.par : 0;
  const s = (k: (typeof TEXT)[number]) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return {
    ok: true,
    row: {
      id,
      name,
      city: s("city"),
      state: s("state"),
      country: s("country"),
      website: s("website"),
      address: s("address"),
      par,
      pars: JSON.stringify(pars),
      yards: yards.length ? JSON.stringify(yards) : "",
      strokeIndex: JSON.stringify(strokeIndex),
      tees,
      cardProblem: "",
    },
  };
}

/** Read the uploaded file's text: the right kind of file, a version this app knows, and a list. */
export function parseCatalogueFile(
  text: string,
): { ok: true; file: CatalogueFile } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not a catalogue file (it is not JSON)." };
  }
  const f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (f.format !== CATALOGUE_FORMAT) return { ok: false, error: "That is not a catalogue file made by the export script." };
  if (f.version !== CATALOGUE_VERSION) {
    return { ok: false, error: `This file is version ${String(f.version)}; this app reads version ${CATALOGUE_VERSION}.` };
  }
  if (!Array.isArray(f.courses)) return { ok: false, error: "The file holds no list of courses." };
  if (f.count !== f.courses.length) {
    return { ok: false, error: `The file says ${String(f.count)} courses but holds ${f.courses.length}; it may be cut short.` };
  }
  return { ok: true, file: f as unknown as CatalogueFile };
}

/** Split into requests by row count AND size, so each fits the body limit and the function's time. */
export function chunkRows(rows: unknown[], maxRows = CHUNK_ROWS, maxChars = CHUNK_CHARS): unknown[][] {
  const out: unknown[][] = [];
  let cur: unknown[] = [];
  let size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r)?.length ?? 0;
    if (cur.length > 0 && (cur.length >= maxRows || size + n > maxChars)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export interface LoadCounts {
  loaded: number;
  updated: number;
  unchanged: number;
  skipped: number;
  refusedGca: number;
}

export const NO_COUNTS: LoadCounts = { loaded: 0, updated: 0, unchanged: 0, skipped: 0, refusedGca: 0 };

export function addCounts(a: LoadCounts, b: LoadCounts): LoadCounts {
  return {
    loaded: a.loaded + b.loaded,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    skipped: a.skipped + b.skipped,
    refusedGca: a.refusedGca + b.refusedGca,
  };
}

export function countsInWords(c: LoadCounts): string {
  return `${c.loaded} loaded, ${c.updated} updated, ${c.unchanged} unchanged, ${c.skipped} skipped (card refused), ${c.refusedGca} refused (GolfCourseAPI).`;
}
