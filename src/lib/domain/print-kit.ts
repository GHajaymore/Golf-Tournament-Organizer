import { countryCode } from "./country";
import { holeNumber } from "./hole-number";

/**
 * THE PRINT KIT (2026-10-23): every document the app can make for a round, on
 * one screen, printed by one renderer.
 *
 * Ajay, after his club's team cup: "your cart sign was perfect so as the
 * scorecard" — both made OUTSIDE the app, from its data — and then "we need to
 * produce similar or suggested documents by the app". The review panel's
 * decision is `docs/print-kit-panel-2026-10-23.md`. This file holds the parts
 * of it that are rules rather than drawing: which paper a club prints on, what
 * each document is, what was printed and whether it is still true, how a
 * player's strokes are said on a sign, and what may never be on paper.
 *
 * Pure: nothing here reads a database or a clock of its own.
 */

/* ── Paper ─────────────────────────────────────────────────────────────── */

export type PaperSize = "a4" | "letter";

/**
 * The countries that print on US Letter. Everybody else's printer holds A4.
 * A blank country follows the app's own default, which is the United States
 * (Ajay's, and `golfRegister`'s), so it is Letter too.
 */
const LETTER_COUNTRIES = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "PR", "GT", "SV", "HN", "NI", "CR", "PA", "DO", "BZ"]);

export function defaultPaper(country: string | null | undefined): PaperSize {
  const code = countryCode(country ?? "");
  if (!code) return "letter";
  return LETTER_COUNTRIES.has(code) ? "letter" : "a4";
}

/** What was asked for in the address, or the club's own paper. */
export function paperFrom(asked: string | null | undefined, fallback: PaperSize): PaperSize {
  return asked === "a4" || asked === "letter" ? asked : fallback;
}

/** The sheet, upright, in millimetres. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

export const PAPER_NAME: Record<PaperSize, string> = { a4: "A4", letter: "US Letter" };

/* ── The documents ─────────────────────────────────────────────────────── */

/**
 * THE DOCUMENTS (panel ruling of 30 Oct 2026, `docs/print-kit-panel-2026-10-30.md`).
 * The separate "Group cards" document is gone: Scorecards print one per player
 * or one per group, by choice (`CardsBy`), for an individual format.
 */
export type DocKind = "cards" | "slips" | "cup" | "signs" | "spare" | "start";

/** In the order the hub lists them, which is the order a secretary prints them on the morning. */
export const DOC_ORDER: readonly DocKind[] = ["cards", "cup", "slips", "signs", "spare", "start"];

/**
 * A document's name, in the club's own golf words: a {cart} is a buggy in
 * Britain. `words` is REQUIRED, so the compiler lists every caller the day a
 * name grows a word of its own.
 */
export function docTitle(kind: DocKind, words: { cart: string }): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  switch (kind) {
    case "cards":
      return "Scorecards";
    case "slips":
      return "Match result slips";
    case "cup":
      return "Cup match cards";
    case "signs":
      return `${cap(words.cart)} signs`;
    case "spare":
      return "Spare sign";
    case "start":
      return "Starting sheet";
  }
}

/** Scorecards: one per player (Rule 3.3b), or one per group — an outing's group card. */
export type CardsBy = "player" | "group";
/** Signs: one per {cart}, its two riders in tee-sheet order — or one per group, for a walking field. */
export type SignsBy = "cart" | "group";

export function cardsByFrom(asked: string | null | undefined): CardsBy {
  return asked === "group" ? "group" : "player";
}
export function signsByFrom(asked: string | null | undefined): SignsBy {
  return asked === "group" ? "group" : "cart";
}

/**
 * EVERY CARD IS THE NORMAL SCORECARD (Ajay, 30 Oct: "any card is the card size").
 * 9.5 × 3.75 in, landscape, two to a sheet on Letter and on A4 alike, so a club's
 * card is the same in every country. Nothing is drawn within `safe` of the trim.
 */
export const CARD_MM = { w: 241.3, h: 95.25, safe: 4 } as const;
/** The only exception's shape: a card twice as tall that folds once to the normal card. Never smaller type. */
export const FOLDOUT_MM = { w: 241.3, h: 190.5 } as const;

/** A sheet of paper laid on its side, and where its card slots sit (from the top-left, in mm). */
export interface SheetSlots {
  w: number;
  h: number;
  x: number;
  /** The two normal cards' tops. */
  cards: [number, number];
  /** A fold-out's top: one to a sheet. */
  foldout: number;
}

export const SHEET_SLOTS: Record<PaperSize, SheetSlots> = {
  letter: { w: 279.4, h: 215.9, x: 19.05, cards: [9.5, 111.1], foldout: 12.7 },
  a4: { w: 297, h: 210, x: 27.85, cards: [6.5, 108.25], foldout: 9.75 },
};

export type CardFormat = "card" | "fold-out";

/** What a card has to hold, for `cardFormat`. */
export type CardContent =
  /** A scorecard: player rows (a side's own row counts as one), the tees in play, and its longest name line. */
  | { kind: "scorecard"; rows: number; tees: number; sharedBallNames?: number }
  /** A cup match card: how many formats (sections) are on the one card. */
  | { kind: "cup"; sections: number; rows: number }
  /** A sign, a spare sign, a result slip: always a normal card. */
  | { kind: "fixed" };

/** Player rows a normal scorecard holds: 4 at 8.5 mm (the ruling's budget, 80.5 of 87.25 mm). */
export const CARD_PLAYER_ROWS = 4;
/** A cup card's rows at 7 mm with one format on it: 4 players and 2 better-ball rows. */
export const CUP_ROWS = 6;
/**
 * Characters a shared-ball side's member line holds on two lines at 7.5 pt in the
 * 40 mm name column, measured in the face that prints (about 30 to a line).
 */
export const SIDE_NAMES_CHARS = 56;

/** A shared ball's players as its card names them under the side: initials and surnames, " & " between. */
export function sideMembersLine(names: readonly string[]): string {
  return names.map((n) => cardName(n, 20)).join(" & ");
}

/**
 * WHERE THE NORMAL CARD GENUINELY CANNOT BE MET — and only there (the ruling's
 * X1–X3). Everything else is a normal card, held to it by the browser test; a
 * fold-out anywhere else would be a quiet shrink-around. The reason is said on
 * the hub, in these words.
 */
export function cardFormat(c: CardContent): { format: CardFormat; reason: string } {
  if (c.kind === "cup" && c.sections > 1) {
    return { format: "fold-out", reason: "both formats of the day are on one card" };
  }
  if (c.kind === "cup" && c.rows > CUP_ROWS) {
    return { format: "fold-out", reason: `${c.rows} rows are more than one card holds` };
  }
  if (c.kind === "scorecard" && c.rows > CARD_PLAYER_ROWS) {
    return { format: "fold-out", reason: `${c.rows} players are more than one card holds` };
  }
  // X3: a shared ball's players are on two lines at 7.5 pt under the side's name;
  // where even their initials and surnames (`sideMembersLine`) cannot fit two, they
  // go on the lower panel. Three sets of tees add the tees to the line.
  if (c.kind === "scorecard" && (c.sharedBallNames ?? 0) > SIDE_NAMES_CHARS) {
    return { format: "fold-out", reason: c.tees >= 3 ? "four names and three sets of tees are more than one card holds" : "four long names are more than one card holds" };
  }
  return { format: "card", reason: "" };
}

/**
 * A NAME AS A CARD CAN HOLD IT, never cut off silently. The whole name when it
 * fits; otherwise the first name's initial and the rest ("W. Fotheringay-…"), and
 * if THAT is still too long, the initial and the surname — the last word, or a
 * hyphenated one. The full name stays on the starting sheet.
 */
export function cardName(name: string, maxChars: number): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const words = clean.split(" ");
  if (words.length < 2) return clean;
  const initial = `${words[0].charAt(0)}.`;
  const rest = `${initial} ${words.slice(1).join(" ")}`;
  if (rest.length <= maxChars) return rest;
  const hyphened = words.slice(1).find((w) => w.includes("-"));
  const surname = hyphened ?? words[words.length - 1];
  return `${initial} ${surname}`;
}

/** One card or page the kit will put on paper, for the count on the Print button. */
export interface PaperUnit {
  doc: DocKind;
  format: CardFormat | "page";
}

/**
 * HOW MANY SHEETS OF PAPER, said on the Print button before anyone presses it
 * (the Budget Keeper). Normal cards two to a sheet, within each document; a
 * fold-out one to a sheet; a starting-sheet page one.
 */
export function sheetsFor(units: readonly PaperUnit[]): number {
  let n = 0;
  for (const doc of DOC_ORDER) {
    const mine = units.filter((u) => u.doc === doc);
    n += Math.ceil(mine.filter((u) => u.format === "card").length / 2);
    n += mine.filter((u) => u.format !== "card").length;
  }
  return n;
}

/**
 * THE CUT-AND-STACK ORDER: which cards share a sheet so that, cut and the
 * bottom pile put under the top, the cards come out in group order. Sheet i
 * holds card i on top and card i + ceil(n/2) beneath.
 */
export function twoUp<T>(cards: readonly T[]): Array<[T, T | null]> {
  const half = Math.ceil(cards.length / 2);
  return Array.from({ length: half }, (_, i) => [cards[i], cards[i + half] ?? null] as [T, T | null]);
}

/** What the address may name: `?docs=cards,signs`. Anything else is dropped. */
export function docsFrom(asked: string | null | undefined): DocKind[] {
  const wanted = new Set((asked ?? "").split(",").map((s) => s.trim()));
  return DOC_ORDER.filter((d) => wanted.has(d));
}

/* ── What was printed, and whether it is still true ───────────────────── */

/**
 * A FINGERPRINT OF WHAT IS ON A SHEET: the same data gives the same string,
 * any change gives another. It is taken of the very object the page is drawn
 * from, so nothing can be printed that the fingerprint does not cover.
 *
 * Keys are sorted first, so two objects built in a different order are the
 * same sheet. Not a security hash — nobody gains by forging one; it only has
 * to notice a change, and 53 bits of cyrb53 notice every one a club will make.
 */
export function fingerprintOf(value: unknown): string {
  return cyrb53(stableJson(value)).toString(36);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** One sheet the kit can print: which document, its name on the hub, and what is on it. */
export interface KitSheet {
  key: string;
  doc: DocKind;
  label: string;
  fp: string;
}

/** One sheet as the printer last had it. */
export interface PrintedSheet {
  fp: string;
  version: number;
  /** ISO instant it went to the printer. */
  at: string;
  /** Its name then — so a sheet whose group has since gone can still be named. */
  label: string;
}

export interface PrintLog {
  v: 1;
  sheets: Record<string, PrintedSheet>;
}

export const EMPTY_PRINT_LOG: PrintLog = { v: 1, sheets: {} };

/** A round with 120 players prints about 500 sheets; this keeps a stored log well inside a row. */
const MAX_LOGGED = 2000;

/** The stored log, or an empty one for anything that is not — never throws. */
export function parsePrintLog(json: string | null | undefined): PrintLog {
  if (!json || !json.trim()) return { v: 1, sheets: {} };
  try {
    const raw = JSON.parse(json) as { sheets?: unknown };
    const sheets: Record<string, PrintedSheet> = {};
    if (raw && typeof raw.sheets === "object" && raw.sheets) {
      for (const [key, v] of Object.entries(raw.sheets as Record<string, unknown>)) {
        const e = v as Partial<PrintedSheet> | null;
        if (!e || typeof e.fp !== "string" || typeof e.at !== "string") continue;
        const version = Number.isInteger(e.version) && (e.version as number) > 0 ? (e.version as number) : 1;
        sheets[key.slice(0, 200)] = { fp: e.fp, version, at: e.at, label: typeof e.label === "string" ? e.label.slice(0, 200) : "" };
      }
    }
    return { v: 1, sheets };
  } catch {
    return { v: 1, sheets: {} };
  }
}

/**
 * THE LOG WITH THESE SHEETS PRINTED NOW.
 *
 * The VERSION is how many different things this sheet has said: a second copy
 * of an unchanged card is the same version, and a card reprinted because its
 * group changed is the next one. So a starter holding "version 3" knows it is
 * newer than the "version 2" in the cart.
 */
export function withPrinted(log: PrintLog, printed: readonly KitSheet[], at: Date): PrintLog {
  const sheets = { ...log.sheets };
  for (const s of printed) {
    const before = sheets[s.key];
    const version = !before ? 1 : before.fp === s.fp ? before.version : before.version + 1;
    sheets[s.key] = { fp: s.fp, version, at: at.toISOString(), label: s.label };
  }
  const keys = Object.keys(sheets);
  if (keys.length > MAX_LOGGED) {
    // The oldest go first; they are the least likely to still be in a cart.
    keys.sort((a, b) => sheets[a].at.localeCompare(sheets[b].at));
    for (const k of keys.slice(0, keys.length - MAX_LOGGED)) delete sheets[k];
  }
  return { v: 1, sheets };
}

export type SheetState = "unprinted" | "current" | "stale";

export interface SheetStatus extends KitSheet {
  state: SheetState;
  /** The version on the printed sheet; 0 when it has never been printed. */
  printedVersion: number;
  /** The version printing it now would carry. */
  nextVersion: number;
  printedAt: string;
}

/** Each sheet the kit can print, measured against what was printed. */
export function sheetStatuses(log: PrintLog, sheets: readonly KitSheet[]): SheetStatus[] {
  return sheets.map((s) => {
    const before = log.sheets[s.key];
    if (!before) return { ...s, state: "unprinted", printedVersion: 0, nextVersion: 1, printedAt: "" };
    const same = before.fp === s.fp;
    return {
      ...s,
      state: same ? "current" : "stale",
      printedVersion: before.version,
      nextVersion: same ? before.version : before.version + 1,
      printedAt: before.at,
    };
  });
}

/**
 * Printed sheets that no longer exist at all — a group drawn out of the sheet,
 * a player who has withdrawn. Not reprintable: the thing to do is collect them.
 * Only within the documents the kit can print for this round now, so a
 * document that has stopped applying altogether is not reported sheet by sheet.
 */
export function goneSheets(log: PrintLog, sheets: readonly KitSheet[], docs: readonly DocKind[]): Array<{ key: string; label: string }> {
  const live = new Set(sheets.map((s) => s.key));
  const offered = new Set(docs);
  return Object.entries(log.sheets)
    .filter(([key]) => !live.has(key) && offered.has(key.split(":")[0] as DocKind))
    .map(([key, e]) => ({ key, label: e.label || key }));
}

/** "3 printed sheets are out of date — reprint these". */
export function staleSentence(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "1 printed sheet is out of date — reprint it" : `${n} printed sheets are out of date — reprint these`;
}

/* ── A player's strokes, said on a sign ───────────────────────────────── */

export interface NineStrokes {
  /** "Holes 1–9" or "Holes 10–18". */
  label: string;
  /** "3, 7, 12×2" — or "none". */
  holes: string;
}

/**
 * WHERE A PLAYER GETS A STROKE, AS A LIST PER NINE — the way the cart sign the
 * owner liked said it. Taken from the same per-hole figures the scorecard
 * draws its dots from, so the sign and the card cannot disagree. Two strokes
 * on a hole read "5×2"; a plus handicap's stroke given back reads "5 (gives 1)".
 */
export function strokesByNine(shots: readonly number[], firstHole: number): NineStrokes[] {
  const nines = new Map<number, string[]>();
  shots.forEach((n, i) => {
    const hole = holeNumber(i, firstHole);
    const nine = hole <= 9 ? 0 : 1;
    if (!nines.has(nine)) nines.set(nine, []);
    if (n === 0) return;
    nines.get(nine)!.push(n > 1 ? `${hole}×${n}` : n === 1 ? `${hole}` : `${hole} (gives ${-n})`);
  });
  return [...nines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([nine, holes]) => ({ label: nine === 0 ? "Holes 1–9" : "Holes 10–18", holes: holes.length ? holes.join(", ") : "none" }));
}

/** "receives 4" / "receives none" — the count beside a list. */
export function strokeCount(shots: readonly number[]): number {
  return shots.reduce((s, n) => s + n, 0);
}

/* ── Never on paper ───────────────────────────────────────────────────── */

/**
 * WHAT MAY NEVER BE ON A PRINTED SHEET (decision F). A sheet is photographed,
 * left in a cart and pinned to a noticeboard the public walks past, so: no
 * email, no phone number, no price, fee, stake or side-game money, nothing
 * that sells ("free", "sign up", a launch), and never the word "bet".
 *
 * Read over each piece of text ON ITS OWN — a text node, a cell — because a
 * page's text run together turns a row of yardages into a phone number. A
 * round code is marked `data-code` and left out by the caller: it is letters
 * and figures by design.
 *
 * Returns what it found, quoted, so a failure says where.
 */
export function paperRefusals(texts: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of texts) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.includes("@")) out.push(`an email address: "${t}"`);
    const phone = t.match(/\+?\d[\d ().-]{6,}\d/);
    if (phone && (phone[0].match(/\d/g) ?? []).length >= 7) out.push(`a phone number: "${t}"`);
    if (/[$£€¥₹₩₦]\s?\d|\d\s?(USD|GBP|EUR|AUD|CAD|NZD|ZAR|INR|CHF)\b/i.test(t)) out.push(`an amount of money: "${t}"`);
    if (/\b(free|sign[ -]?up|bets?|betting|wager|launch(es|ed|ing)?|entry fee|stake)\b/i.test(t)) out.push(`a word paper never carries: "${t}"`);
  }
  return out;
}
