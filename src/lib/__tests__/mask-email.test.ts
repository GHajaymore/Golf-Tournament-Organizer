import { describe, it, expect } from "vitest";
import { maskEmail } from "@/lib/email";

/**
 * P2 of the 2026-08-12 audit — five log lines printed a member's address on
 * every send failure. Logs are read by more people than the database is, kept
 * longer, and shipped to whoever aggregates them.
 */
describe("logging an address without logging the address", () => {
  it("keeps the domain and drops the person", () => {
    // The domain is the half that debugs anything: a whole corporate mail
    // server bouncing looks nothing like one member's typo.
    expect(maskEmail("tom.halloran@example.com")).toBe("t***@example.com");
  });

  it("leaves one character, so a support email can be matched to a line", () => {
    expect(maskEmail("a@b.test")).toBe("a***@b.test");
  });

  it("does not leak a long local part through its length", () => {
    // Fixed-width stars: a mask that grew with the name would say how long it
    // is, which is a small leak but a free one to avoid.
    expect(maskEmail("a@x.test")).toBe("a***@x.test");
    expect(maskEmail("averylonglocalpart@x.test")).toBe("a***@x.test");
  });

  it("takes the last @ so a quoted local part cannot fake a domain", () => {
    expect(maskEmail("odd@name@real.test")).toBe("o***@real.test");
  });

  it("says nothing at all for something that is not an address", () => {
    // Better than echoing whatever arrived — the failure path is exactly where
    // a malformed value shows up.
    expect(maskEmail("")).toBe("an address");
    expect(maskEmail("not-an-address")).toBe("an address");
    expect(maskEmail("@nolocal.test")).toBe("an address");
  });
});
