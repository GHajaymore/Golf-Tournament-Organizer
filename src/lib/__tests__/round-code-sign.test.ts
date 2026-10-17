import { describe, it, expect } from "vitest";
import qrcode from "qrcode-generator";
import { codeFromLink, roundCodeLink } from "../code-format";
import { qrModules, qrPath, type QrEncoder } from "../qr";
import { readSource } from "./source";

/**
 * A ROUND'S PRINTED SIGN (2026-10-17): the address it carries, and the square
 * that carries it. The browser half — the organizer's sign, a fresh phone
 * landing on the names, a scoring phone asked before it moves — is
 * `e2e/round-code-sign.spec.ts`.
 */

const encode = qrcode as unknown as QrEncoder;

describe("the address on a sign", () => {
  it("carries the code after a # so the server never sees it", () => {
    expect(roundCodeLink("https://tourneyhq.club", "ABCDEFGH")).toBe("https://tourneyhq.club/play#ABCD-EFGH");
  });

  it("reads a code back off the address, however it was written", () => {
    for (const hash of ["#ABCD-EFGH", "#abcd-efgh", "ABCDEFGH", "#ABCD EFGH"]) expect(codeFromLink(hash), hash).toBe("ABCDEFGH");
  });

  it("reads nothing that is not exactly a code", () => {
    // O and 1 are outside the alphabet; a longer fragment is some other page's anchor.
    for (const hash of ["", "#", "#scores", "#ABCD-EFG", "#ABCD-EFGHJ", "#ABCD-EFGO", "#ABCD-EFG1"]) {
      expect(codeFromLink(hash), hash).toBe("");
    }
  });
});

describe("the square on a sign", () => {
  const link = roundCodeLink("https://tourneyhq.club", "ABCDEFGH");
  const modules = qrModules(encode, link);

  it("is drawn module for module from the encoder", () => {
    // Read the drawing back: every `M{x} {y}` in the path is one dark module.
    const { d, size } = qrPath(modules);
    const n = modules.length;
    expect(size).toBe(n + 8);
    const drawn = new Set([...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${Number(m[2]) - 4},${Number(m[1]) - 4}`));
    const dark = new Set<string>();
    modules.forEach((row, r) => row.forEach((on, c) => on && dark.add(`${r},${c}`)));
    expect(drawn.size).toBe(dark.size);
    for (const key of dark) expect(drawn.has(key), `module ${key} is dark and not drawn`).toBe(true);
  });

  it("has the three finder squares a phone looks for", () => {
    // A 7x7 ring with a 3x3 centre, at three corners — the shape every reader
    // locks on to first. A drawing that put the modules in the wrong place,
    // or transposed them, fails here.
    const n = modules.length;
    const finderAt = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const ring = r === 0 || r === 6 || c === 0 || c === 6;
          const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (modules[r0 + r][c0 + c] !== (ring || centre)) return false;
        }
      return true;
    };
    expect(finderAt(0, 0)).toBe(true);
    expect(finderAt(0, n - 7)).toBe(true);
    expect(finderAt(n - 7, 0)).toBe(true);
    // CONTROL: the fourth corner has none.
    expect(finderAt(n - 7, n - 7)).toBe(false);
  });

  it("is a different square for a different code", () => {
    const other = qrModules(encode, roundCodeLink("https://tourneyhq.club", "ABCDEFGJ"));
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(modules));
  });
});

describe("the encoder is in no screen's first download", () => {
  it("is loaded only when the signs are opened", () => {
    // A static import would put it in the Tournament details bundle for every
    // organizer, every visit; `e2e/weight-budget.json` holds that weight.
    for (const file of ["src/components/RoundSigns.tsx", "src/components/PlaySettings.tsx", "src/lib/qr.ts"]) {
      const src = readSource(...file.split("/"));
      expect(src, file).not.toMatch(/from\s+["']qrcode-generator["']/);
    }
    expect(readSource("src", "components", "RoundSigns.tsx")).toMatch(/import\(\s*["']qrcode-generator["']\s*\)/);
  });
});
