import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config.mjs";

/**
 * THE ADDRESSES PEOPLE TYPE TO SIGN IN LAND ON THE SIGN-IN PANEL.
 *
 * Sign-in lives on the front page, so /login answered 404 — the first thing a
 * returning secretary types (walked 2026-09-28). And the one thing these rules
 * must never do is catch a tournament's public entry form at /register/<token>.
 */
type Rule = { source: string; destination: string; permanent: boolean };

const rules = async (): Promise<Rule[]> => (await (nextConfig as { redirects: () => Promise<Rule[]> }).redirects());

describe("sign-in addresses", () => {
  it("send /login and /signup to the right tab of the sign-in panel", async () => {
    const r = await rules();
    const to = (s: string) => r.find((x) => x.source === s)?.destination;
    expect(to("/login")).toBe("/#signin");
    expect(to("/signin")).toBe("/#signin");
    expect(to("/signup")).toBe("/#signup");
    // Temporary, so a real sign-in page later is not fighting a cached 308.
    expect(r.every((x) => x.permanent === false)).toBe(true);
  });

  it("never catch a tournament's entry form at /register/<token>", async () => {
    // Exact sources only: no parameter, wildcard or regex that could reach a
    // deeper path. `/register/:token` is the public form a club sends members.
    for (const x of await rules()) {
      expect(x.source, `${x.source} is not an exact path`).toMatch(/^\/[a-z-]+$/);
    }
  });
});
