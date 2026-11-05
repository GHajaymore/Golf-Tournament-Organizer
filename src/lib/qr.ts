/**
 * A QR CODE AS AN SVG PATH (2026-10-17), for a round's printed sign.
 *
 * The encoder (`qrcode-generator`, no dependencies of its own) is handed in
 * rather than imported here, so the screen that draws a sign can load it only
 * when somebody opens the signs: it is in no page's first download. The
 * drawing is ours — one path of square modules, black on white — so no markup
 * from a library is ever put into the page.
 */

/** The part of the encoder this file uses. */
export interface QrEncoder {
  (typeNumber: 0, level: "L" | "M" | "Q" | "H"): {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  };
}

/**
 * The share of a code's area the mark in its centre may take (2026-11-05).
 * Level H repairs up to 30% of the codewords; 15% is half of that, so the
 * other half is left for the scuffs, rain and folds a printed card gets.
 */
export const LOGO_AREA = 0.15;

/**
 * The name under a printed code (Ajay, 2026-11-05: "add the TourneyHQ right below the logo").
 * It goes UNDER the code, never inside it: a word in the centre box would have to grow the box
 * past `LOGO_AREA` and would still be too small to read. Below this width it is left off — on a
 * scorecard's small corner code it would print as a smudge, not a name.
 */
export const QR_WORDMARK_MIN_MM = 30;

/** Whether a code printed `mm` wide carries the name under it. */
export function showsWordmark(mm: number): boolean {
  return mm >= QR_WORDMARK_MIN_MM;
}

/** The modules of `text` as rows of dark (true) and light (false). */
export function qrModules(encode: QrEncoder, text: string, opts: { logo?: boolean } = {}): boolean[][] {
  // M: a sign in a cart gets scuffed and rained on, and M survives about 15%
  // of it while keeping a short address down at a size a phone reads from a
  // seat. The type number is the encoder's choice (0): the smallest that fits.
  //
  // H ONLY WHEN THE MARK IS DRAWN (2026-11-05): the mark covers up to 15% of
  // the area, and only H (30%) leaves room for that AND the scuffs. H is a
  // denser code, so a code with no mark keeps M and stays as coarse as it was.
  const qr = encode(0, opts.logo ? "H" : "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** A square in module units, from the code's own top-left (before the quiet zone). */
export interface LogoBox {
  /** The white square, border included. */
  x: number;
  y: number;
  size: number;
  /** The mark inside it, one module of white all round. */
  inner: { x: number; y: number; size: number };
}

/**
 * THE CENTRE BOX THE TOURNEYHQ MARK SITS IN (2026-11-05) — the one rule for its
 * size, for every code that draws it. `size` is the code's module count. The
 * box is the largest odd number of modules (odd, because a code's side is odd
 * and the box must sit on the middle module) whose area is at most
 * `LOGO_AREA` of the code's, whole modules so that no module is half covered.
 * One module of white all round (`border`) keeps the mark off the code's dark
 * modules, which a reader needs to see as separate.
 */
export function logoBox(size: number): LogoBox {
  const border = 1;
  // Never nearer a corner than the finder pattern and its separator (8 modules) plus one: on a code too
  // small to give 15% that clearance (a version 1 or 2, which no address of ours fits) the box shrinks.
  let side = Math.min(Math.floor(Math.sqrt(LOGO_AREA) * size), size - 18);
  if (side % 2 === 0) side -= 1;
  side = Math.max(side, 3);
  const at = (size - side) / 2;
  return { x: at, y: at, size: side, inner: { x: at + border, y: at + border, size: side - 2 * border } };
}

/** What a drawn code is: its dark modules as one path, its size, and the centre box when the mark is drawn. */
export interface QrDrawing {
  d: string;
  size: number;
  logo?: LogoBox;
}

/**
 * One SVG path for the dark modules, in module units, offset by the quiet
 * zone. A reader needs four light modules round the edge (ISO/IEC 18004), so
 * the drawing's size is the module count plus eight. `logo` adds the centre
 * box, in the same units as the drawing (the quiet zone already added).
 */
export function qrPath(modules: boolean[][], quiet = 4, opts: { logo?: boolean } = {}): QrDrawing {
  const parts: string[] = [];
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }),
  );
  const out: QrDrawing = { d: parts.join(""), size: modules.length + quiet * 2 };
  if (opts.logo) {
    const b = logoBox(modules.length);
    out.logo = { x: b.x + quiet, y: b.y + quiet, size: b.size, inner: { x: b.inner.x + quiet, y: b.inner.y + quiet, size: b.inner.size } };
  }
  return out;
}
