import { describe, it, expect } from "vitest";
import qrcode from "qrcode-generator";
import { linkFromHash, roundCodeLink } from "../code-format";
import { qrModules, qrPath, type QrEncoder } from "../qr";
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
    for (const hash of ["#ABCD-EFGH", "#abcd-efgh", "ABCDEFGH", "#ABCD EFGH"]) {
      expect(linkFromHash(hash), hash).toEqual({ code: "ABCDEFGH", group: null });
    }
  });

  it("reads nothing that is not exactly a code", () => {
    // O and 1 are outside the alphabet; a longer fragment is some other page's anchor.
    for (const hash of ["", "#", "#scores", "#ABCD-EFG", "#ABCD-EFGHJ", "#ABCD-EFGO", "#ABCD-EFG1"]) {
      expect(linkFromHash(hash), hash).toEqual({ code: "", group: null });
    }
  });
});

describe("the address on a sign that names a group (2026-11-05)", () => {
  const origin = "https://tourneyhq.club";
  const matchKey = "match:cmhk3x9a20001abcdefghijklm";

  it("carries a tee-sheet group as `.t<n>` and a match as `.m<id>`", () => {
    expect(roundCodeLink(origin, "ABCDEFGH", "tee:3")).toBe("https://tourneyhq.club/play#ABCD-EFGH.t3");
    expect(roundCodeLink(origin, "ABCDEFGH", matchKey)).toBe("https://tourneyhq.club/play#ABCD-EFGH.mcmhk3x9a20001abcdefghijklm");
  });

  it("is read back to the same group key, the id's case kept", () => {
    expect(linkFromHash("#ABCD-EFGH.t3")).toEqual({ code: "ABCDEFGH", group: "tee:3" });
    expect(linkFromHash("#abcd-efgh.t0")).toEqual({ code: "ABCDEFGH", group: "tee:0" });
    expect(linkFromHash("#ABCD-EFGH.mcmhk3x9a20001abcdefghijklm")).toEqual({ code: "ABCDEFGH", group: matchKey });
    for (const key of ["tee:0", "tee:17", matchKey]) {
      expect(linkFromHash(new URL(roundCodeLink(origin, "ABCDEFGH", key)).hash), key).toEqual({ code: "ABCDEFGH", group: key });
    }
  });

  it("is a link to the whole round when the key is not a group's", () => {
    for (const key of ["", "tee:", "tee:-1", "tee:01", "tee:1234", "match:", "match:a b", "bracket:7", "player:x"]) {
      expect(roundCodeLink(origin, "ABCDEFGH", key), key).toBe("https://tourneyhq.club/play#ABCD-EFGH");
    }
  });

  it("refuses a malformed fragment whole: the code is not honoured beside a group part it cannot read", () => {
    // CONTROL pair: the same code with a good group part reads; every one of these must not.
    expect(linkFromHash("#ABCD-EFGH.t3").code).toBe("ABCDEFGH");
    for (const hash of [
      "#ABCD-EFGH.",
      "#ABCD-EFGH.x3",
      "#ABCD-EFGH.t",
      "#ABCD-EFGH.t-1",
      "#ABCD-EFGH.t03",
      "#ABCD-EFGH.t1234",
      "#ABCD-EFGH.m",
      "#ABCD-EFGH.mab",
      "#ABCD-EFGH.m<script>",
      "#ABCD-EFGH.t3.t4",
      "#ABCD-EFGH.mcmhk3x9a20001abcdefghijklmnopqrstuvwxyz0123456789",
      "#ABCD-EFGO.t3",
    ]) {
      expect(linkFromHash(hash), hash).toEqual({ code: "", group: null });
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
    // Every file under src, not a list: the round signs and the sign-up poster
    // are two users of it already, and the third should not need remembering.
    const files = (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"))
      .map((f) => join("src", f));
    expect(files.length, "CONTROL: the sweep found no source").toBeGreaterThan(300);
    const lazy: string[] = [];
    for (const file of files) {
      const src = readSource(file);
      expect(src, file).not.toMatch(/from\s+["']qrcode-generator["']/);
      if (/import\(\s*["']qrcode-generator["']\s*\)/.test(src)) lazy.push(file.replace(/\\/g, "/"));
    }
    // CONTROL: the sweep sees the ones that load it lazily. The Print kit's (2026-10-23) is on the
    // SERVER — `server-only`, in no browser's download at all — and draws every printed QR; so is
    // the front door's demo QR.
    expect(lazy.sort()).toEqual(["src/components/SignUpPoster.tsx", "src/lib/landing/demo-qr.ts", "src/lib/services/print-kit.ts"]);
  });
});
