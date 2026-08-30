import { describe, it, expect } from "vitest";
import { privacyContact, isReachableAddress } from "@/lib/domain/privacy-contact";

/**
 * The privacy policy never publishes an address that cannot receive mail.
 *
 * The page shipped with `privacy@tourneyhq.example` in a constant, under a
 * comment reading "set this before launch". Nothing enforced the comment, and
 * `.example` is reserved by RFC 2606 — so the policy described how to exercise
 * a data-protection right and pointed it at a domain that can never exist.
 *
 * Moving the value to an environment variable does not fix that on its own; it
 * relocates where the same mistake gets typed. So the rule is asserted here
 * against the CONTENT of the address, and the page has no literal left to go
 * stale.
 */
describe("privacyContact", () => {
  describe("refuses what cannot receive mail", () => {
    it("refuses the address the policy actually shipped with", () => {
      // The regression this whole module exists for.
      expect(privacyContact("privacy@tourneyhq.example")).toEqual({ kind: "none" });
    });

    it.each(["example", "test", "invalid", "localhost"])(
      "refuses the reserved .%s TLD",
      (tld) => {
        expect(privacyContact(`privacy@tourneyhq.${tld}`)).toEqual({ kind: "none" });
      },
    );

    it.each(["example.com", "example.net", "example.org"])("refuses %s", (domain) => {
      expect(privacyContact(`privacy@${domain}`)).toEqual({ kind: "none" });
    });

    it("refuses a reserved TLD reached through a subdomain", () => {
      // `mail.example` is as unregistrable as `example` itself — the TLD is
      // what decides it, not the label in front.
      expect(privacyContact("privacy@mail.example")).toEqual({ kind: "none" });
    });

    it.each([undefined, null, "", "   ", "\t\n"])("refuses %p as unset", (raw) => {
      expect(privacyContact(raw)).toEqual({ kind: "none" });
    });

    it.each([
      "not-an-address",
      "@tourneyhq.club",
      "privacy@",
      "privacy@tourneyhq",
      "two@at@signs.club",
      "has space@tourneyhq.club",
      "privacy@tourneyhq club",
    ])("refuses the malformed %p", (raw) => {
      expect(privacyContact(raw)).toEqual({ kind: "none" });
    });
  });

  describe("accepts a real address", () => {
    it("accepts the domain this app is actually launching on", () => {
      expect(privacyContact("privacy@tourneyhq.club")).toEqual({
        kind: "address",
        email: "privacy@tourneyhq.club",
      });
    });

    it("normalises case and surrounding whitespace", () => {
      // A value pasted out of a dashboard arrives with both.
      expect(privacyContact("  Privacy@TourneyHQ.Club \n")).toEqual({
        kind: "address",
        email: "privacy@tourneyhq.club",
      });
    });

    it("accepts a real domain that merely contains the word example", () => {
      /**
       * The lesson the course-card rules were written from, applied here: a
       * guard that refuses a real address is worse than no guard. `example-golf.com`
       * and `myexample.org` are registrable domains that receive mail, and a
       * substring match on "example" would throw both away — silently, and in
       * exactly the branch nobody looks at.
       */
      expect(privacyContact("privacy@example-golf.com")).toEqual({
        kind: "address",
        email: "privacy@example-golf.com",
      });
      expect(privacyContact("privacy@myexample.org")).toEqual({
        kind: "address",
        email: "privacy@myexample.org",
      });
    });

    it("accepts a multi-label domain and a plus address", () => {
      expect(privacyContact("privacy+gdpr@mail.tourneyhq.co.uk")).toEqual({
        kind: "address",
        email: "privacy+gdpr@mail.tourneyhq.co.uk",
      });
    });
  });

  it("exposes the reachability rule on its own", () => {
    // Used by the guard test, and worth being able to ask directly.
    expect(isReachableAddress("privacy@tourneyhq.club")).toBe(true);
    expect(isReachableAddress("privacy@tourneyhq.example")).toBe(false);
  });
});
