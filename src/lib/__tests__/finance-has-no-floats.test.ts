import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * NO FLOAT IN THE OWNER'S BOOKS (B44). Money is whole minor units; the arithmetic that must divide does
 * it in BigInt (`domain/finance.ts`). These are the spellings that make a float out of a figure — read
 * it, print it, or round a multiplied one — and none may appear in the finance files. Ban the shape.
 */
const FILES = [
  ["src", "lib", "domain", "finance.ts"],
  ["src", "lib", "domain", "finance-input.ts"],
  ["src", "lib", "services", "owner-finance.ts"],
  ["src", "app", "actions", "owner-finance.ts"],
  ["src", "components", "OwnerFinance.tsx"],
  ["src", "components", "OwnerFinanceForms.tsx"],
] as const;

export const FLOAT_SHAPES: { name: string; re: RegExp }[] = [
  { name: "parseFloat", re: /\bparseFloat\s*\(/ },
  { name: "toFixed", re: /\.toFixed\s*\(/ },
  { name: "Math.round", re: /\bMath\.(round|ceil|trunc)\s*\(/ },
  { name: "a decimal literal", re: /[=*\/+<>(,]\s*\d+\.\d+(?![\w"'])/ },
  { name: "Number() of a division", re: /Number\s*\([^)]*\/[^)]*\)/ },
  { name: "toLocaleString", re: /\.toLocaleString\s*\(/ },
];

describe("the finance files make no floats", () => {
  for (const file of FILES) {
    it(file.join("/"), () => {
      const src = readSource(...file);
      const found = FLOAT_SHAPES.filter((s) => s.re.test(src)).map((s) => s.name);
      expect(found).toEqual([]);
    });
  }

  it("CONTROL: each shape sees what it bans", () => {
    const seen = (re: RegExp, text: string) => re.test(text);
    expect(seen(FLOAT_SHAPES[0].re, "const n = parseFloat(x)")).toBe(true);
    expect(seen(FLOAT_SHAPES[1].re, "(n / 100).toFixed(2)")).toBe(true);
    expect(seen(FLOAT_SHAPES[2].re, "Math.round(x * 100)")).toBe(true);
    expect(seen(FLOAT_SHAPES[3].re, "const rate = 1.27;")).toBe(true);
    expect(seen(FLOAT_SHAPES[3].re, "n * 0.01")).toBe(true);
    expect(seen(FLOAT_SHAPES[4].re, "Number(a / b)")).toBe(true);
    expect(seen(FLOAT_SHAPES[5].re, "n.toLocaleString('en')")).toBe(true);
  });

  it("CONTROL: the files are found and are not empty", () => {
    for (const file of FILES) expect(readSource(...file).length).toBeGreaterThan(500);
  });
});
