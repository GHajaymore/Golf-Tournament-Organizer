import { describe, it, expect } from "vitest";
import { safeNextPath, signInUrlFor } from "@/lib/domain/safe-next";

/**
 * The open-redirect boundary.
 *
 * `?next=` exists so a logged-out deep link returns to where it was going. Get
 * it wrong and the same parameter becomes a phishing primitive: a link on the
 * real domain that lands on somebody else's login page after a genuine
 * sign-in. Every refusal below is a documented bypass of a naive
 * `startsWith("/")` check rather than a hypothetical.
 */
describe("safeNextPath", () => {
  describe("refuses anything that could leave this origin", () => {
    it.each([
      ["absolute http", "http://evil.example/x"],
      ["absolute https", "https://evil.example/x"],
      ["protocol-relative", "//evil.example/x"],
      ["protocol-relative with path", "//evil.example"],
      ["backslash, normalised to a slash by some browsers", "/\\evil.example/x"],
      ["double backslash", "\\\\evil.example/x"],
      ["a scheme with no slashes", "javascript:alert(1)"],
      ["data URL", "data:text/html,<script>alert(1)</script>"],
      ["scheme-ish with a leading slash", "/javascript:alert(1)\\"],
    ])("refuses %s", (_label, raw) => {
      expect(safeNextPath(raw)).toBeNull();
    });

    it("refuses control characters that one parser strips and another does not", () => {
      // The bypass is that the check and the browser disagree about what the
      // string is. Refusing beats sanitising, because sanitising is the
      // disagreement.
      expect(safeNextPath("/\t/evil.example")).toBeNull();
      expect(safeNextPath("/\n/evil.example")).toBeNull();
      expect(safeNextPath("/ /evil.example")).toBeNull();
      expect(safeNextPath("/\r\n/evil.example")).toBeNull();
    });

    it("refuses anything that is not a string, or is empty", () => {
      expect(safeNextPath(null)).toBeNull();
      expect(safeNextPath(undefined)).toBeNull();
      expect(safeNextPath("")).toBeNull();
      expect(safeNextPath("   ")).toBeNull();
      // Not a path at all.
      expect(safeNextPath("dashboard")).toBeNull();
    });
  });

  describe("allows real destinations", () => {
    it.each([
      ["a console screen", "/dashboard"],
      ["a player screen", "/me"],
      ["a nested screen", "/me/card"],
      ["a public board", "/live/SEEDDEMOCUPSHARETOKEN"],
      ["a screen with a query", "/leaderboard?stage=2"],
      ["a screen with a hash", "/rules#local"],
      ["query and hash together", "/prizes?flight=1#payouts"],
    ])("allows %s", (_label, raw) => {
      expect(safeNextPath(raw)).toBe(raw);
    });

    it("allows a path that merely CONTAINS a host-like string", () => {
      /**
       * The guard-against-the-guard. A share token or a course name could
       * contain almost anything, and refusing a legitimate path because it
       * looks vaguely like a URL would break the exact links this feature
       * exists to preserve.
       */
      expect(safeNextPath("/live/https-not-a-host")).toBe("/live/https-not-a-host");
      expect(safeNextPath("/course/st-andrews.example")).toBe("/course/st-andrews.example");
    });
  });

  describe("refuses destinations that are not destinations", () => {
    it("refuses the page they are already on", () => {
      // Signing in and being sent back to the sign-in screen reads as a failure
      // even when it worked.
      expect(safeNextPath("/")).toBeNull();
    });

    it("refuses /choose, which is where they go anyway", () => {
      expect(safeNextPath("/choose")).toBeNull();
    });
  });

  it("does not decide whether they are ALLOWED there", () => {
    /**
     * `next` is a preference, not an authorisation. A player following one to
     * /dashboard still meets requireScreen and gets bounced to /me, exactly as
     * if they had typed the URL. Enforcing it here as well would put one rule
     * in two places, and the other one is the one that counts.
     */
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });
});

describe("signInUrlFor", () => {
  it("remembers a real destination", () => {
    expect(signInUrlFor("/prizes")).toBe(`/?next=${encodeURIComponent("/prizes")}`);
  });

  it("carries the query string with it", () => {
    const url = signInUrlFor("/leaderboard", "?stage=2");
    expect(url).toBe(`/?next=${encodeURIComponent("/leaderboard?stage=2")}`);
  });

  it("encodes, so the parameter cannot break out of itself", () => {
    // A raw & in the remembered path would look like the start of another
    // parameter to whatever reads the sign-in URL next.
    expect(signInUrlFor("/leaderboard", "?a=1&b=2")).toContain("%3Fa%3D1%26b%3D2");
  });

  it("falls back to the plain sign-in page when there is nothing worth keeping", () => {
    expect(signInUrlFor("/")).toBe("/");
    expect(signInUrlFor("/choose")).toBe("/");
  });

  it("round-trips: what it encodes is what the validator later accepts", () => {
    /**
     * The two halves have to agree or the feature silently does nothing —
     * links would be built, encoded, and then rejected on the way back.
     */
    for (const path of ["/me/card", "/leaderboard?stage=2", "/prizes#payouts"]) {
      const url = signInUrlFor(path);
      const encoded = url.slice("/?next=".length);
      expect(safeNextPath(decodeURIComponent(encoded))).toBe(path);
    }
  });
});
