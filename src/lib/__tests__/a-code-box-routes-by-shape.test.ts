import { describe, it, expect } from "vitest";
import { codeShapeOf } from "@/lib/domain/code-shape";
import { readSource } from "./source";

/**
 * A CODE BOX ROUTES BY THE SHAPE OF THE WHOLE INPUT (J39/J40 PR 3B; Security Lead C1.5).
 *
 * The sign-up page's code box takes the same codes /play and /p take, so the shape is read from the FULL input, never
 * from a prefix: a 12-character personal code typed at /register or /play is a `twelve` and never reaches the
 * 8-character lookup (its first eight characters are 40 bits of a 60-bit secret), and any other length is refused
 * uncounted. The press at /register is the same one door (`openAnyCode`), not a second reader.
 *
 * Break-it (seen red): truncate the input to eight characters before routing.
 */
describe("a code box routes by shape", () => {
  const PERSONAL = "K7QM-2XRA-9DTP";
  const ENTRY = "ABCD-EFGH";

  it("a personal code, however it is typed, is a twelve and never an eight", () => {
    for (const typed of [PERSONAL, PERSONAL.toLowerCase(), PERSONAL.replace(/-/g, " "), PERSONAL.replace(/-/g, ""), `https://tourneyhq.club/p#${PERSONAL}`]) {
      expect(codeShapeOf(typed).shape, typed).toBe("twelve");
    }
  });

  it("an entry code is an eight, and a string of any other length is none (uncounted)", () => {
    expect(codeShapeOf(ENTRY)).toMatchObject({ shape: "eight", code: "ABCDEFGH" });
    for (const typed of ["ABCD-EFG", "ABCD-EFGH-J", "123456", "", "x".repeat(200), 123, null, {}]) {
      expect(codeShapeOf(typed).shape, String(typed)).toBe("none");
    }
  });

  it("the first eight characters of a personal code are not looked up as an entry code", () => {
    const first8 = PERSONAL.replace(/-/g, "").slice(0, 8);
    // On their own they are a shape of their own; inside the twelve they are never read.
    expect(codeShapeOf(first8).shape).toBe("eight");
    expect(codeShapeOf(PERSONAL)).toEqual({ shape: "twelve", code: PERSONAL.replace(/-/g, "") });
  });

  it("the /register press hands the whole input to the one door, and decides no shape of its own", () => {
    const door = readSource("src/app/actions/guest-entry.ts");
    expect(door).toMatch(/openAnyCode\(typed, /);
    expect(door).not.toMatch(/\.slice\(0,\s*8\)|\.substring\(0,\s*8\)|normalizeAccessCode\(/);
  });
});
