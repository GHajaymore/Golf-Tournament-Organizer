import { describe, expect, it } from "vitest";
import { isOwner, parseOwnerEmails } from "@/lib/owner";

/**
 * The owner gate opens the whole business to whoever it lets through, so it
 * fails CLOSED everywhere and the CONTROL is the one case that must OPEN —
 * without it, a gate hard-wired to `return false` passes every other assertion.
 */

describe("the owner gate", () => {
  it("CONTROL: an address on the allow-list is an owner", () => {
    expect(isOwner("aj@example.com", "aj@example.com")).toBe(true);
    expect(isOwner("aj@example.com", "other@x.com,aj@example.com,third@y.com")).toBe(true);
  });

  it("is case-insensitive and ignores stray spaces in the list", () => {
    expect(isOwner("AJ@Example.com", "aj@example.com")).toBe(true);
    expect(isOwner("aj@example.com", "  aj@example.com , b@y.com ")).toBe(true);
  });

  it("fails closed when the list is empty or unset", () => {
    expect(isOwner("aj@example.com", "")).toBe(false);
    expect(isOwner("aj@example.com", "   ")).toBe(false);
    expect(isOwner("aj@example.com", undefined as unknown as string)).toBe(false);
  });

  it("refuses an address that is not on the list", () => {
    expect(isOwner("stranger@example.com", "aj@example.com")).toBe(false);
  });

  it("refuses an empty or missing address even against a real list", () => {
    expect(isOwner("", "aj@example.com")).toBe(false);
    expect(isOwner(null, "aj@example.com")).toBe(false);
    expect(isOwner(undefined, "aj@example.com")).toBe(false);
    expect(isOwner("   ", "aj@example.com")).toBe(false);
  });

  it("parses a list into lower-cased, trimmed, non-empty addresses", () => {
    expect(parseOwnerEmails(" A@x.com, b@Y.com ,, c@z.com,")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
    expect(parseOwnerEmails("")).toEqual([]);
    expect(parseOwnerEmails(null)).toEqual([]);
  });

  it("reads the allow-list from the environment when none is passed", () => {
    const prev = process.env.OWNER_EMAILS;
    try {
      process.env.OWNER_EMAILS = "owner@tourneyhq.club";
      expect(isOwner("owner@tourneyhq.club")).toBe(true);
      expect(isOwner("someone@else.com")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.OWNER_EMAILS;
      else process.env.OWNER_EMAILS = prev;
    }
    // With the env cleared, nobody is an owner — fail closed.
    expect(isOwner("owner@tourneyhq.club", "")).toBe(false);
  });
});
