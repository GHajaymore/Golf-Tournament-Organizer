import { describe, it, expect } from "vitest";
import { cookiesAreSecure } from "../secure-cookies";
import { readSource } from "./source";

/**
 * A SESSION COOKIE IS `Secure` IN PRODUCTION, AND ONE SWITCH CANNOT CHANGE THAT
 * WHERE IT MATTERS (2026-10-11).
 *
 * `E2E_PLAIN_HTTP=1` exists so the suite can sign somebody in on WebKit, which
 * will not send a Secure cookie to the plain-http test server. A switch that
 * weakens a cookie is exactly the kind that ends up set somewhere it should
 * not be — so it is refused on Vercel, and this holds it.
 */
describe("whether cookies are marked Secure", () => {
  it("always, in production", () => {
    expect(cookiesAreSecure({ NODE_ENV: "production" })).toBe(true);
    expect(cookiesAreSecure({ NODE_ENV: "production", VERCEL: "1" })).toBe(true);
  });

  it("on Vercel, whatever the test switch says", () => {
    expect(cookiesAreSecure({ NODE_ENV: "production", VERCEL: "1", E2E_PLAIN_HTTP: "1" })).toBe(true);
  });

  it("not on the test server over plain http, when the run asks", () => {
    expect(cookiesAreSecure({ NODE_ENV: "production", E2E_PLAIN_HTTP: "1" })).toBe(false);
  });

  it("only for exactly that value — a stray or empty variable changes nothing", () => {
    for (const value of ["", "0", "true", "yes", " 1"]) {
      expect(cookiesAreSecure({ NODE_ENV: "production", E2E_PLAIN_HTTP: value }), JSON.stringify(value)).toBe(true);
    }
  });

  it("never in development, where the server is http://localhost", () => {
    expect(cookiesAreSecure({ NODE_ENV: "development" })).toBe(false);
    expect(cookiesAreSecure({})).toBe(false);
  });

  it("is the ONE place the flag is decided — both cookie modules take it from here", () => {
    for (const file of ["auth.ts", "play-auth.ts"]) {
      const src = readSource("src", "lib", file);
      expect(src, file).toContain('import { SECURE_COOKIES } from "./secure-cookies"');
      expect(src, `${file} decides the flag for itself`).not.toContain("const SECURE_COOKIES");
      expect(src, file).toContain("secure: SECURE_COOKIES");
      // And no cookie in either is set with the flag written out by hand.
      expect(src, file).not.toContain("secure: false");
      expect(src, file).not.toContain("secure: true");
    }
  });
});
