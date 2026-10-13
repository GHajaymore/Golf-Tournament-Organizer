/**
 * THE PIN SHEET — where the hole is cut on each green, for one round.
 *
 * A committee moves the holes every day, and the card handed out on the first
 * tee says where they are, in the notation every golfer reads: paces ON from
 * the front edge of the green, then paces from the nearer side — "22 / 6R" is
 * twenty-two on and six from the right edge. "C" is cut across the middle.
 *
 * Per ROUND, because that is what a pin sheet is: a two-day championship has
 * two, and a league week has its own. Stored as one JSON array on the stage,
 * index = hole on the round's card (so a back-nine round's hole 1 is the 10th,
 * exactly as `cardForStage` numbers it). A hole with no position is null, and
 * a sheet that is all null is no sheet — nothing prints and nothing shows.
 *
 * The limits are those of a real green rather than of arithmetic: the deepest
 * greens in club golf run to about fifty paces and nobody cuts a hole on the
 * fringe, so a value outside them is a typing slip, not a position.
 */

export type PinSide = "L" | "C" | "R";

export interface PinPosition {
  /** Paces on from the front edge. */
  on: number;
  side: PinSide;
  /** Paces in from that side's edge. Zero, and ignored, for "C". */
  off: number;
}

export type PinSheet = (PinPosition | null)[];

export const MAX_PACES_ON = 60;
export const MAX_PACES_OFF = 30;

const isSide = (v: unknown): v is PinSide => v === "L" || v === "C" || v === "R";
const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null;

/**
 * One position from caller-supplied data, or the reason it is not one.
 * `"use server"` actions are public endpoints — the shape is checked here, at
 * the boundary, whatever the TypeScript said.
 */
export function readPin(raw: unknown): { pin: PinPosition | null; error?: string } {
  if (raw === null || raw === undefined || raw === "") return { pin: null };
  if (typeof raw !== "object") return { pin: null, error: "Not a hole position." };
  const r = raw as Record<string, unknown>;
  // Blank only when NOTHING was typed. A value that is not a whole number is a
  // slip to be named, never quietly read as "this hole isn't set".
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  // And nothing CHOSEN either: a side with no paces is an unfinished position,
  // which falls through to be named — it was read as "this hole isn't set",
  // and the form answered "Pin sheet cleared" to somebody who had picked L.
  const sided = r.side === "L" || r.side === "R";
  if (blank(r.on) && blank(r.off) && !sided) return { pin: null };
  const on = whole(r.on);
  if (on === null || on < 1 || on > MAX_PACES_ON) {
    return { pin: null, error: `Paces on must be a whole number from 1 to ${MAX_PACES_ON}.` };
  }
  if (!isSide(r.side)) return { pin: null, error: "Say left, centre or right." };
  if (r.side === "C") return { pin: { on, side: "C", off: 0 } };
  const off = whole(r.off);
  if (off === null || off < 1 || off > MAX_PACES_OFF) {
    return { pin: null, error: `Paces from the ${r.side === "L" ? "left" : "right"} must be 1 to ${MAX_PACES_OFF}.` };
  }
  return { pin: { on, side: r.side, off } };
}

/** One row of the pin-sheet form, as typed. */
export interface PinRow {
  on: string;
  side: PinSide;
  off: string;
}

/**
 * What the form sends for its rows: null for a row nobody touched, and
 * everything else AS IT IS, finished or not.
 *
 * A row used to be sent only when a number had been typed, so a side chosen
 * on its own was dropped here and never reached `readPin` to be named. The
 * form must not decide what counts as a position — that is `readPin`'s job,
 * and it can only refuse what it is shown.
 *
 * WHAT IS SHOWN, though, and not what the form happens to remember
 * (2026-10-13). With the side on centre the "paces from the edge" box is
 * greyed and drawn empty, but the row went on holding whatever had been typed
 * there. So a pin at 22 / 6R, moved to centre and its paces deleted — which is
 * how anybody clears one — was a row that LOOKED blank and was sent as
 * unfinished: the committee was told "Paces on must be a whole number from 1
 * to 60" about a hole with nothing in it, and could not clear the sheet.
 * Found by the first browser test to type a pin and then take it away. A row
 * on centre with no paces on is a row nobody has set, whatever is left behind
 * in a box they cannot see.
 */
export function pinRowsPayload(rows: readonly PinRow[]): ({ on: string; side: PinSide; off: string | number } | null)[] {
  return rows.map((r) =>
    r.on.trim() === "" && r.side === "C"
      ? null
      : { on: r.on.trim(), side: r.side, off: r.side === "C" ? 0 : r.off.trim() },
  );
}

/**
 * A whole sheet from caller-supplied data, sized to the round's holes.
 * The first bad hole is named, so the committee is told which one to fix.
 */
export function readPinSheet(
  raw: unknown,
  holes: number,
  /** The course's number for the round's first hole — 10 on a back nine — so a refusal names the hole on the form. */
  firstHole = 1,
): { sheet: PinSheet; error?: string } {
  if (!Array.isArray(raw)) return { sheet: [], error: "Not a pin sheet." };
  if (raw.length > holes) return { sheet: [], error: `This round has ${holes} holes.` };
  const sheet: PinSheet = [];
  for (let i = 0; i < holes; i++) {
    const { pin, error } = readPin(raw[i]);
    if (error) return { sheet: [], error: `Hole ${i + firstHole}: ${error}` };
    sheet.push(pin);
  }
  return { sheet };
}

/** Stored JSON back to a sheet. Never throws; anything unreadable is no sheet. */
export function parsePinSheet(json: string, holes: number): PinSheet {
  if (!json.trim()) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return Array.from({ length: holes }, (_, i) => readPin(raw[i]).pin ?? null);
  } catch {
    return [];
  }
}

/** Whether a sheet places at least one hole — an empty sheet is not published. */
export function hasPins(sheet: PinSheet): boolean {
  return sheet.some((p) => p !== null);
}

/** "22 / 6R", "18 / C" — the notation on a printed card. */
export function pinShort(p: PinPosition | null): string {
  if (!p) return "";
  return p.side === "C" ? `${p.on} / C` : `${p.on} / ${p.off}${p.side}`;
}

/** "22 on, 6 from the right" — the same fact said aloud, for a screen. */
export function pinLong(p: PinPosition | null): string {
  if (!p) return "";
  if (p.side === "C") return `${p.on} paces on, centre`;
  return `${p.on} paces on, ${p.off} from the ${p.side === "L" ? "left" : "right"}`;
}
