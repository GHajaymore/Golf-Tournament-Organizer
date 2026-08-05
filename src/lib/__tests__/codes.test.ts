import { describe, it, expect } from "vitest";
import { generateAccessCode, generateShareToken } from "../codes";
import { formatAccessCode, normalizeAccessCode, looksLikeAccessCode } from "../code-format";

const AMBIGUOUS = ["O", "0", "I", "1", "L", "U", "S", "5"];

describe("access codes", () => {
  it("never contains characters people mistype off a printed card", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateAccessCode();
      for (const c of AMBIGUOUS) {
        expect(code.includes(c), `${code} contains ambiguous "${c}"`).toBe(false);
      }
    }
  });

  it("is 8 characters and validates as a code", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateAccessCode();
      expect(code).toHaveLength(8);
      expect(looksLikeAccessCode(code)).toBe(true);
    }
  });

  it("does not repeat across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(generateAccessCode());
    expect(seen.size).toBe(2000);
  });

  it("uses the whole alphabet rather than favouring early symbols", () => {
    // A modulo-biased generator would leave later symbols underrepresented.
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i += 1) {
      for (const c of generateAccessCode()) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBe(27);
    const values = [...counts.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Generous bound — this catches gross bias, not statistical noise.
    expect(max / min).toBeLessThan(1.6);
  });
});

describe("formatting and normalizing", () => {
  it("round-trips the display form back to the stored form", () => {
    const code = generateAccessCode();
    expect(normalizeAccessCode(formatAccessCode(code))).toBe(code);
  });

  it("groups into two blocks of four for reading off a card", () => {
    expect(formatAccessCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("accepts lowercase, spaces and dashes as typed", () => {
    expect(normalizeAccessCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeAccessCode("abcd efgh")).toBe("ABCDEFGH");
  });

  it("leaves characters alone rather than guessing at misreads", () => {
    // Mapping an excluded character onto a guess fails the same way as not
    // guessing, but corrupts input that was already right.
    expect(normalizeAccessCode("2346789A")).toBe("2346789A");
    expect(looksLikeAccessCode(normalizeAccessCode("OOOOOOOO"))).toBe(false);
  });

  it("rejects wrong lengths and stray characters", () => {
    expect(looksLikeAccessCode("ABCDEFG")).toBe(false);
    expect(looksLikeAccessCode("ABCDEFGHI")).toBe(false);
    expect(looksLikeAccessCode("ABCD-EFG")).toBe(false);
    expect(looksLikeAccessCode("")).toBe(false);
  });
});

describe("share tokens", () => {
  it("is long and opaque — it is tapped, never typed", () => {
    const token = generateShareToken();
    expect(token).toHaveLength(24);
  });

  it("does not repeat across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(generateShareToken());
    expect(seen.size).toBe(2000);
  });
});
