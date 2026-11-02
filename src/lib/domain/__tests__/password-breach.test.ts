import { describe, it, expect } from "vitest";
import { breachRangeParts, seenInRange } from "../password-breach";

/**
 * The leak check's arithmetic, against values known from outside the code: the
 * SHA-1 of "password" is published everywhere as
 * 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8, and Have I Been Pwned's own
 * documentation uses it as the worked example of a range query (prefix 5BAA6).
 */
const SHA1_OF_PASSWORD = "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8";

describe("what is sent and what is looked for", () => {
  it("sends five characters, upper-case, and keeps the other thirty-five", () => {
    const { prefix, suffix } = breachRangeParts(SHA1_OF_PASSWORD);
    expect(prefix).toBe("5BAA6");
    expect(suffix).toBe("1E4C9B93F3F0682250B6CF8331B7EE68FD8");
    expect(prefix.length + suffix.length).toBe(40);
  });
});

describe("reading the range's answer", () => {
  const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
  const body = [
    "1E4BFD7FD2A0BC0D8A33F4E8B9D1C2A3F44:3",
    `${SUFFIX}:10434004`,
    "1E4CA0C2E1D4F3B8A9C7D6E5F4A3B2C1D0E:0",
    "",
  ].join("\r\n");

  it("finds a leaked hash, whatever the line endings", () => {
    expect(seenInRange(body, SUFFIX)).toBe(true);
    expect(seenInRange(body.split("\r\n").join("\n"), SUFFIX.toLowerCase())).toBe(true);
  });

  it("a padding line, count nought, is not a leak", () => {
    expect(seenInRange(body, "1E4CA0C2E1D4F3B8A9C7D6E5F4A3B2C1D0E")).toBe(false);
  });

  it("CONTROL: a suffix that is not in the answer is not a leak, and nor is an empty answer", () => {
    expect(seenInRange(body, "0000000000000000000000000000000000A")).toBe(false);
    expect(seenInRange("", SUFFIX)).toBe(false);
  });

  it("a suffix that only STARTS another line is not that line", () => {
    expect(seenInRange(body, SUFFIX.slice(0, 20))).toBe(false);
  });
});
