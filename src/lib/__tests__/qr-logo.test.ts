import { describe, it, expect } from "vitest";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import { roundCodeLink } from "../code-format";
import { LOGO_AREA, logoBox, qrModules, qrPath, type QrEncoder } from "../qr";

/**
 * THE TOURNEYHQ MARK IN THE CENTRE OF A PRINTED QR (2026-11-05).
 *
 * Drawn on the print kit's signs and cards and the sign-up poster. The one rule
 * for its size is `logoBox`; the one rule for the correction level is
 * `qrModules` (H only when the mark is drawn). What a reader can do with it is
 * proved here the way the print-kit browser test proves it on a screen:
 * rasterise the drawing and decode it with jsQR. The mark itself is `<Logo>`
 * (drawn by `QrLogoMark`); here the box it sits in is painted both ways a mark
 * can fail a reader — erased, and solid black — and the code must still read.
 */

const encode = qrcode as unknown as QrEncoder;
const ORIGIN = "https://tourneyhq.club";
const MATCH = "match:cmhk3x9a20001abcdefghijklm";

/** The drawing as pixels, `px` per module, quiet zone included. */
function raster(modules: boolean[][], opts: { px?: number; cover?: "white" | "black" | null; damage?: boolean }) {
  const px = opts.px ?? 6;
  const quiet = 4;
  const n = modules.length;
  const side = (n + quiet * 2) * px;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  const paint = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.fill(v, (y * side + x) * 4, (y * side + x) * 4 + 3);
  };
  modules.forEach((row, r) => row.forEach((dark, c) => dark && paint((c + quiet) * px, (r + quiet) * px, (c + quiet + 1) * px, (r + quiet + 1) * px, 0)));
  if (opts.cover) {
    const b = logoBox(n);
    paint((b.x + quiet) * px, (b.y + quiet) * px, (b.x + b.size + quiet) * px, (b.y + b.size + quiet) * px, opts.cover === "black" ? 0 : 255);
  }
  // The control: the top-left finder pattern painted out.
  if (opts.damage) paint(0, 0, Math.floor(side * 0.35), Math.floor(side * 0.35), 255);
  return { data, side };
}

const read = (modules: boolean[][], opts: Parameters<typeof raster>[1]) => {
  const { data, side } = raster(modules, opts);
  return jsQR(data, side, side)?.data ?? null;
};

describe("the box the mark sits in", () => {
  it("is at most 15% of the code's area, on whole modules, for every size a code has", () => {
    // Versions 1 to 40: 21 to 177 modules.
    for (let n = 21; n <= 177; n += 4) {
      const b = logoBox(n);
      expect(b.size * b.size, `${n} modules`).toBeLessThanOrEqual(LOGO_AREA * n * n);
      expect(Number.isInteger(b.x) && Number.isInteger(b.size), `${n}: whole modules`).toBe(true);
      // On the middle module, so it is the same distance from every edge.
      expect(b.x * 2 + b.size, `${n}: centred`).toBe(n);
      expect(b.size % 2, `${n}: odd`).toBe(1);
    }
  });

  it("is the largest such box, not a timid one", () => {
    // Two modules more would pass 15%; it is a tenth of the code's side at least.
    for (const n of [37, 49, 57, 77]) {
      const b = logoBox(n);
      expect((b.size + 2) ** 2, `${n}`).toBeGreaterThan(LOGO_AREA * n * n);
    }
  });

  it("leaves a module of white all round the mark", () => {
    const b = logoBox(37);
    expect(b.inner.size).toBe(b.size - 2);
    expect(b.inner.x - b.x).toBe(1);
    expect(b.x + b.size - (b.inner.x + b.inner.size)).toBe(1);
  });

  it("never reaches a finder pattern", () => {
    for (const n of [21, 25, 29, 33, 37, 49, 57]) {
      const b = logoBox(n);
      // The finders and their separators fill the first and last eight modules of a corner.
      expect(b.x, `${n}`).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("the correction level", () => {
  const link = roundCodeLink(ORIGIN, "ABCDEFGH", "tee:3");
  const levels: string[] = [];
  const spy: QrEncoder = (type, level) => {
    levels.push(level);
    return encode(type, level);
  };

  it("is H when the mark is drawn, and M (as before) when it is not", () => {
    levels.length = 0;
    qrModules(spy, link, { logo: true });
    qrModules(spy, link);
    qrModules(spy, link, { logo: false });
    expect(levels).toEqual(["H", "M", "M"]);
  });

  it("makes a denser code, which is the price", () => {
    expect(qrModules(encode, link, { logo: true }).length).toBeGreaterThan(qrModules(encode, link).length);
  });

  it("puts the box in the drawing's own units, quiet zone included, only when asked", () => {
    const modules = qrModules(encode, link, { logo: true });
    const withMark = qrPath(modules, 4, { logo: true });
    const b = logoBox(modules.length);
    expect(withMark.logo).toEqual({ x: b.x + 4, y: b.y + 4, size: b.size, inner: { x: b.inner.x + 4, y: b.inner.y + 4, size: b.inner.size } });
    expect(qrPath(modules).logo).toBeUndefined();
    // The same path either way: the mark is drawn over it, not cut out of it.
    expect(withMark.d).toBe(qrPath(modules).d);
  });
});

describe("a code with the mark in it still reads", () => {
  const targets = [
    ["a whole round", roundCodeLink(ORIGIN, "ABCDEFGH")],
    ["a tee-sheet group", roundCodeLink(ORIGIN, "ABCDEFGH", "tee:3")],
    ["a match", roundCodeLink(ORIGIN, "ABCDEFGH", MATCH)],
    ["a long host", roundCodeLink("https://tourneyhq-git-claude-scoring-by-group-2a-example.vercel.app", "ABCDEFGH", MATCH)],
  ] as const;

  for (const [what, link] of targets) {
    const modules = qrModules(encode, link, { logo: true });

    it(`${what}: with the box erased`, () => {
      expect(read(modules, { cover: "white" })).toBe(link);
    });

    it(`${what}: with the box solid black, the worst a mark can be`, () => {
      expect(read(modules, { cover: "black" })).toBe(link);
    });

    it(`${what}: CONTROL, with a finder pattern painted out, it does not read`, () => {
      expect(read(modules, { cover: "white", damage: true })).not.toBe(link);
    });
  }

  it("still reads with a scuff on top of the box: the margin the correction level leaves", () => {
    // The box takes up to 15% of the modules and a cart sign gets scuffed on top of that. A block
    // of 7 x 7 modules is erased as well, in the data area left of centre (rows and columns 14 to 20).
    const link = roundCodeLink(ORIGIN, "ABCDEFGH", MATCH);
    const modules = qrModules(encode, link, { logo: true });
    const { data, side } = raster(modules, { cover: "white" });
    const px = 6;
    const from = (14 + 4) * px;
    const to = (14 + 7 + 4) * px;
    for (let y = from; y < to; y++) for (let x = from; x < to; x++) data.fill(255, (y * side + x) * 4, (y * side + x) * 4 + 3);
    expect(jsQR(data, side, side)?.data ?? null).toBe(link);
  });
});
