import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A GUEST WHO PRESSES "FORGET" LANDS ON /p, ON EVERY ENGINE (QA finding G638-1 #2).
 *
 * `forgetThisPhone` clears the guest cookie, and clearing a cookie in a server
 * action makes Next re-render the page it was pressed on. That page is `/me`,
 * which with no viewer left sends the router to the sign-in front door. The
 * button used to navigate itself afterwards (`location.assign("/p")`); Chromium
 * won that race and WebKit did not, so a guest on an iPhone was left at the
 * front door (`e2e/a-guest-in-messages.spec.ts`, iphone-phone part).
 *
 * The rule: the ACTION ends in `redirect("/p")`, so `/p` is rendered in the
 * action's own answer and there is one navigation; and the press does not
 * navigate on its own as well. The browser proof is the spec's
 * `waitForURL(/\/p/)` on WebKit; this pins the shape between rounds.
 */

const action = readSource("src/app/actions/player-link.ts");
const forget = action.slice(action.indexOf("export async function forgetThisPhone("), action.indexOf("export async function choosePlayerView("));
const controls = readSource("src/components/GuestLinkControls.tsx");
const press = controls.slice(controls.indexOf("export function GuestForget("), controls.indexOf("export function PlayerViewSwitchLine("));

/** A client-side navigation of any spelling. */
const NAVIGATES = /location\.(assign|replace|href)|router\.(push|replace|refresh)|window\.location\s*=/;

describe("Forget me on this phone: one navigation, to /p", () => {
  it("the sources were found (control)", () => {
    expect(forget).toContain("clearGuestCookie()");
    expect(press).toContain("forgetThisPhone(");
    // The sweep can see a navigation where there is one: the other control's press still makes its own.
    expect(controls.slice(controls.indexOf("export function PlayerViewSwitchLine("))).toMatch(NAVIGATES);
  });

  it("the action clears the cookie and then redirects to /p as its last word", () => {
    const cleared = forget.indexOf("clearGuestCookie()");
    const sent = forget.indexOf('redirect("/p")');
    expect(sent, 'forgetThisPhone must end in redirect("/p")').toBeGreaterThan(cleared);
    expect(forget, "a returned result would leave the client to navigate, and race the /me re-render").not.toMatch(/return\s*\{/);
  });

  it("the press does not navigate on its own as well", () => {
    expect(press, "GuestForget navigates itself; the action's redirect already does").not.toMatch(NAVIGATES);
  });
});
