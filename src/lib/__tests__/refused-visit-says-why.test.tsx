import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  redirect: () => {
    throw new Error("redirect");
  },
}));

import { DeniedNotice } from "@/components/DeniedNotice";
import { landingScreenFor } from "@/lib/roles";

/**
 * A REFUSED VISIT SAYS WHY, instead of landing on the dashboard in silence.
 *
 * Walked as an ASSISTANT on 2026-09-26: Registration, Rounds & formats,
 * Flights and Score entry link to Tournament details, and Prizes to Club
 * settings — two screens that role cannot open. Every click landed on the
 * dashboard with nothing said. The redirect now carries the screen it
 * refused, and the landing screen names it.
 */

const html = (query: string) => {
  params = new URLSearchParams(query);
  return renderToStaticMarkup(createElement(DeniedNotice));
};

describe("the landing screen after a refused visit", () => {
  it("names the screen that did not open, and who holds it", () => {
    const out = html("denied=event");
    expect(out).toContain("Tournament details");
    expect(out).toContain("organizer");
  });

  it("says nothing on an ordinary visit (the control)", () => {
    expect(html("")).toBe("");
  });

  it("prints only a screen it knows — never the parameter", () => {
    // A crafted link must not be able to put its own words on the page.
    expect(html("denied=%3Cb%3Eclick%20here%3C%2Fb%3E")).toBe("");
    expect(html("denied=not-a-screen")).toBe("");
  });
});

describe("the guards send a refusal there", () => {
  it("never redirects a refused visit to a bare landing screen", () => {
    /**
     * `deniedLanding` is the ONE way out of a refusal. A bare
     * `redirect(landingScreenFor(...))` is the silent version this replaced,
     * and a guard added later would reintroduce it without anybody noticing.
     */
    const src = readSource("src", "lib", "page-helpers.ts");
    expect(src).not.toMatch(/redirect\(\s*landingScreenFor\(/);
    expect(src).toMatch(/redirect\(\s*deniedLanding\(/);
  });

  it("carries the key to each role's own landing screen", () => {
    // Pinned against `landingScreenFor` so the two cannot drift apart.
    const src = readSource("src", "lib", "page-helpers.ts");
    expect(src).toMatch(/\$\{landingScreenFor\(role\)\}\?denied=\$\{encodeURIComponent\(key\)\}/);
    expect(landingScreenFor("assistant")).toBe("/dashboard");
    expect(landingScreenFor("player")).toBe("/me");
  });
});
