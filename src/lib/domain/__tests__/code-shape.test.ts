import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CODE_ALPHABET } from "../../code-format";
import { LINK_ALPHABET } from "../player-link";
import { MAX_CODE_INPUT as LINK_MAX_CODE_INPUT, normaliseLinkCode } from "../../link-code-format";
import { boxStepFor, codeShapeOf, CODE_WORDS, MAX_CODE_INPUT, type CodeBox, type CodeShape } from "../code-shape";

/**
 * ONE CODE BOX: THE SHAPE OF WHAT WAS TYPED (design §2, §6; Security items 1 and 5).
 *
 * The shape is read from the WHOLE input. The finding it closes (§2.3): /play
 * cut every input to 8 characters, so a personal code whose first 8 symbols
 * fall in the round alphabet — about (27/32)^8, a quarter of them — was looked
 * up as a round code, and its first 8 characters went into the counter table
 * under an unkeyed hash. The property below generates personal codes of
 * exactly that kind and holds every one to `twelve`.
 */

describe("each printed, spoken, typed and pasted form of each code", () => {
  const eights: Array<[string, string]> = [
    ["ABCDEFGH", "ABCDEFGH"],
    ["ABCD-EFGH", "ABCDEFGH"],
    ["abcd-efgh", "ABCDEFGH"],
    [" abcd efgh ", "ABCDEFGH"],
    ["ABCD.EFGH", "ABCDEFGH"],
    ["ABCD · EFGH", "ABCDEFGH"],
    ["https://tourneyhq.club/play#ABCD-EFGH", "ABCDEFGH"],
  ];
  for (const [typed, code] of eights) {
    it(`${JSON.stringify(typed)} is a round code`, () => {
      expect(codeShapeOf(typed)).toEqual({ shape: "eight", code, group: null });
    });
  }
  it("a pasted sign address keeps its group", () => {
    expect(codeShapeOf("https://tourneyhq.club/play#ABCD-EFGH.t3")).toEqual({ shape: "eight", code: "ABCDEFGH", group: "tee:3" });
    expect(codeShapeOf("ABCD-EFGH.t3")).toEqual({ shape: "eight", code: "ABCDEFGH", group: "tee:3" });
  });

  const twelves: Array<[string, string]> = [
    ["K7QM2XRA9DTP", "K7QM2XRA9DTP"],
    ["K7QM-2XRA-9DTP", "K7QM2XRA9DTP"],
    ["k7qm-2xra-9dtp", "K7QM2XRA9DTP"],
    ["K7QM · 2XRA · 9DTP", "K7QM2XRA9DTP"],
    ["https://tourneyhq.club/p#K7QM2XRA9DTP", "K7QM2XRA9DTP"],
    // Crockford's folding: O reads as 0, I and L as 1.
    ["K7QM-2XRA-9DTO", "K7QM2XRA9DT0"],
  ];
  for (const [typed, code] of twelves) {
    it(`${JSON.stringify(typed)} is a player link code`, () => {
      expect(codeShapeOf(typed)).toEqual({ shape: "twelve", code });
    });
  }

  it("the help's own example, whose first 8 are all round symbols, is a twelve (the §2.3 case)", () => {
    expect([..."K7QM2XRA"].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(codeShapeOf("K7QM-2XRA-9DTP").shape).toBe("twelve");
  });

  const nones: Array<[string, unknown]> = [
    ["6 digits from an email", "482913"],
    ["7 characters", "ABCDEFG"],
    ["9 characters", "ABCDEFGHJ"],
    ["11 characters", "K7QM2XRA9DT"],
    ["13 characters", "K7QM2XRA9DTPQ"],
    ["a 24-character sign-up token", "ABCDEFGHJKMNPQRTWXYZ2346"],
    ["64 hex", "a".repeat(64)],
    ["8 characters outside the round alphabet", "OOOOOOOO"],
    ["a 12 with a U", "K7QM2XRA9DTU"],
    ["empty", ""],
    ["a number", 12345678],
    ["an object", { code: "ABCDEFGH" }],
    ["null", null],
    ["65 characters", "ABCDEFGH" + " ".repeat(57)],
  ];
  for (const [what, input] of nones) {
    it(`${what} is no code`, () => {
      expect(codeShapeOf(input)).toEqual({ shape: "none" });
    });
  }
  it("CONTROL: the 65-character case is only too long (64 of the same is a code)", () => {
    expect(("ABCDEFGH" + " ".repeat(56)).length).toBe(MAX_CODE_INPUT);
    expect(codeShapeOf("ABCDEFGH" + " ".repeat(56)).shape).toBe("eight");
  });
});

/**
 * ONE FIGURE FOR HOW LONG A CODE BOX READS (one code box PR B; the Security
 * Lead's follow-up on #1176). `normaliseLinkCode` refused text over 64 while
 * `codeShapeOf` took 128, so `k7qm2xra.t123` with fifty-odd spaces typed INSIDE
 * it was a personal code to neither of them being asked the same question: the
 * twelve reader said no and the shape reader went on to read an eight. Both now
 * hold `MAX_CODE_INPUT` (64), on the WHOLE input.
 */
describe("the two readers agree about how long a code may be", () => {
  const agrees = (shape: CodeShape, link: string | null) => (shape.shape === "twelve") === (link !== null);
  const padded = (n: number) => "k7qm2xra".padEnd(n - 5, " ") + ".t123";
  it("MAX_CODE_INPUT is 64, the one figure both readers hold", () => {
    expect(MAX_CODE_INPUT).toBe(64);
    expect(MAX_CODE_INPUT).toBe(LINK_MAX_CODE_INPUT);
  });
  it("a personal code with spaces inside it is a twelve up to 64 characters and no code past it", () => {
    expect(padded(64)).toHaveLength(64);
    expect(codeShapeOf(padded(64))).toEqual({ shape: "twelve", code: "K7QM2XRAT123" });
    expect(normaliseLinkCode(padded(64))).toBe("K7QM2XRAT123");
    expect(padded(65)).toHaveLength(65);
    // Past the figure it is read by NEITHER: above all, never as the round code its first 8 characters spell.
    expect(codeShapeOf(padded(65))).toEqual({ shape: "none" });
    expect(normaliseLinkCode(padded(65))).toBeNull();
    // The 51-space case the review named (it was an eight at 128).
    expect(codeShapeOf("k7qm2xra" + " ".repeat(52) + ".t123")).toEqual({ shape: "none" });
  });
  it("for every string, codeShapeOf says twelve exactly when normaliseLinkCode finds a code, and then the same one", () => {
    const symbolsOf = (alphabet: string, n: number) => fc.array(fc.constantFrom(...alphabet), { minLength: n, maxLength: n }).map((a) => a.join(""));
    const wordy = fc.array(fc.constantFrom(..."K7QM2XRA9DTPabcdefgh .-#·_OIL"), { maxLength: 90 }).map((a) => a.join(""));
    fc.assert(
      fc.property(fc.oneof(wordy, symbolsOf(LINK_ALPHABET, 12), fc.string({ maxLength: 90 })), (typed) => {
        const link = normaliseLinkCode(typed);
        const shape = codeShapeOf(typed);
        expect(agrees(shape, link), JSON.stringify(typed)).toBe(true);
        if (shape.shape === "twelve") expect(shape.code).toBe(link);
      }),
      { numRuns: 4000 },
    );
  });
  it("CONTROL: the agreement check can see a disagreement", () => {
    expect(agrees({ shape: "twelve", code: "K7QM2XRAT123" }, null)).toBe(false);
    expect(agrees({ shape: "none" }, "K7QM2XRAT123")).toBe(false);
    expect(agrees({ shape: "eight", code: "ABCDEFGH", group: null }, null)).toBe(true);
  });
});

describe("properties", () => {
  const symbolsOf = (alphabet: string, n: number) => fc.array(fc.constantFrom(...alphabet), { minLength: n, maxLength: n }).map((a) => a.join(""));
  const ROUND_ONLY = [...LINK_ALPHABET].filter((c) => CODE_ALPHABET.includes(c)).join("");

  it("every personal code is a twelve, never an eight — also when its first 8 are round symbols", () => {
    // The §2.3 case on purpose: first 8 drawn from symbols both alphabets share, last 4 from all 32.
    const risky = fc.tuple(symbolsOf(ROUND_ONLY, 8), symbolsOf(LINK_ALPHABET, 4)).map(([a, b]) => a + b);
    const any = symbolsOf(LINK_ALPHABET, 12);
    fc.assert(
      fc.property(fc.oneof(risky, any), fc.boolean(), fc.boolean(), (code, dashed, lower) => {
        let typed = dashed ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}` : code;
        if (lower) typed = typed.toLowerCase();
        expect(codeShapeOf(typed)).toEqual({ shape: "twelve", code });
      }),
      { numRuns: 2000 },
    );
  });

  it("a personal code is a twelve under ANY separators in ANY case (a sign-looking tail included)", () => {
    const risky = fc.tuple(symbolsOf(ROUND_ONLY, 8), symbolsOf(LINK_ALPHABET, 4)).map(([a, b]) => a + b);
    // Every code gets a tail that looks like a sign's group: 8 round symbols, T, three digits.
    const signLike = fc.tuple(symbolsOf(ROUND_ONLY, 8), fc.integer({ min: 100, max: 999 })).map(([a, n]) => `${a}T${n}`);
    const seps = fc.constantFrom("", "-", ".", " ", "·");
    fc.assert(
      fc.property(fc.oneof(risky, signLike), fc.array(seps, { minLength: 11, maxLength: 11 }), fc.boolean(), (code, gaps, lower) => {
        const valid = [...code].every((c) => LINK_ALPHABET.includes(c));
        if (!valid) return; // a digit the personal alphabet lacks is not a personal code
        let typed = [...code].map((c, i) => c + (gaps[i] ?? "")).join("");
        if (lower) typed = typed.toLowerCase();
        expect(codeShapeOf(typed)).toEqual({ shape: "twelve", code });
      }),
      { numRuns: 3000 },
    );
    expect(codeShapeOf("k7qm2xra.t123")).toEqual({ shape: "twelve", code: "K7QM2XRAT123" });
    expect(codeShapeOf("k7qm-2xra.t123")).toEqual({ shape: "twelve", code: "K7QM2XRAT123" });
  });

  it("every round code is an eight", () => {
    fc.assert(
      fc.property(symbolsOf(CODE_ALPHABET, 8), (code) => {
        expect(codeShapeOf(`${code.slice(0, 4)}-${code.slice(4)}`)).toEqual({ shape: "eight", code, group: null });
      }),
      { numRuns: 1000 },
    );
  });

  it("no string is two shapes, and an eight's code is always 8 symbols of the round alphabet", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: fc.constantFrom(..."ABCDEFGHJKMNPQRTWXYZ0123456789-. #OIL") })), (s) => {
        const shape: CodeShape = codeShapeOf(s);
        if (shape.shape === "eight") {
          expect(shape.code).toHaveLength(8);
          expect([...shape.code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
        }
        if (shape.shape === "twelve") expect(shape.code).toHaveLength(12);
      }),
      { numRuns: 3000 },
    );
  });
});

describe("what a box does before any request (boxStepFor)", () => {
  const BOXES: CodeBox[] = ["play", "p", "register"];
  it("no shape is refused in the one sentence, in every box", () => {
    for (const box of BOXES) expect(boxStepFor({ shape: "none" }, box)).toEqual({ do: "refuse", words: CODE_WORDS.notACode });
  });
  it("a personal code is asked of the door in every box", () => {
    for (const box of BOXES) expect(boxStepFor({ shape: "twelve", code: "K7QM2XRA9DTP" }, box)).toEqual({ do: "ask" });
  });
  it("a round code is asked at /play, and goes on to /play#… from any other box (no extra press)", () => {
    const eight: CodeShape = { shape: "eight", code: "ABCDEFGH", group: null };
    expect(boxStepFor(eight, "play")).toEqual({ do: "ask" });
    expect(boxStepFor(eight, "p")).toEqual({ do: "go", href: "/play#ABCD-EFGH" });
    expect(boxStepFor(eight, "register")).toEqual({ do: "go", href: "/play#ABCD-EFGH" });
    expect(boxStepFor({ ...eight, group: "tee:3" }, "p")).toEqual({ do: "go", href: "/play#ABCD-EFGH.t3" });
  });
  it("the address a typed code goes to is escaped: what was typed can never become markup or a scheme", () => {
    // `codeShapeOf` never lets such a code through; this holds the builder to it on its own (CodeQL
    // js/xss-through-dom on /p's box, 2026-11-17), so a shape reader loosened later still cannot.
    const hostile: CodeShape = { shape: "eight", code: `"><img src=x onerror=alert(1)>`, group: null };
    const step = boxStepFor(hostile, "p");
    expect(step.do).toBe("go");
    const href = step.do === "go" ? step.href : "";
    expect(href.startsWith("/play#")).toBe(true);
    expect(href.slice("/play#".length)).not.toMatch(/[<>"'\s:]/);
    expect(decodeURIComponent(href.slice("/play#".length))).toBe(hostile.code);
  });
  it("a personal code never leaves in an address (S1): only a round code is ever put after /play#", () => {
    for (const box of BOXES) {
      const step = boxStepFor(codeShapeOf("K7QM-2XRA-9DTP"), box);
      expect(step.do).toBe("ask");
    }
  });
});

describe("the sentences", () => {
  it("name both public formats and send a 6-digit code back to its own screen", () => {
    expect(CODE_WORDS.notACode).toContain("ABCD-EFGH");
    expect(CODE_WORDS.notACode).toContain("K7QM-2XRA-9DTP");
    expect(CODE_WORDS.notACode).toMatch(/6-digit/);
  });
  it("the failure sentence names no kind and blames nobody", () => {
    expect(CODE_WORDS.opensNothing).not.toMatch(/round|link|valid|new one/i);
  });
  it("the throttle sentence says the wait and names no kind", () => {
    expect(CODE_WORDS.tooMany("5 minutes")).toMatch(/Wait 5 minutes/);
    expect(CODE_WORDS.tooMany("5 minutes")).not.toMatch(/round|link attempts/i);
  });
});
