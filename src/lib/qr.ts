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

/** The modules of `text` as rows of dark (true) and light (false). */
export function qrModules(encode: QrEncoder, text: string): boolean[][] {
  // M: a sign in a cart gets scuffed and rained on, and M survives about 15%
  // of it while keeping a short address down at a size a phone reads from a
  // seat. The type number is the encoder's choice (0): the smallest that fits.
  const qr = encode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * One SVG path for the dark modules, in module units, offset by the quiet
 * zone. A reader needs four light modules round the edge (ISO/IEC 18004), so
 * the drawing's size is the module count plus eight.
 */
export function qrPath(modules: boolean[][], quiet = 4): { d: string; size: number } {
  const parts: string[] = [];
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }),
  );
  return { d: parts.join(""), size: modules.length + quiet * 2 };
}
