import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";
import { startDestination, HOME_SCREEN_START } from "@/lib/domain/home-screen-start";
import { readSource } from "./source";

/**
 * THE HOME-SCREEN APP OPENS WHERE A GUEST CAN GET IN (J39/J40 PR 2, G3).
 *
 * An iPhone home-screen app has its own empty cookie jar. With `start_url: "/"`
 * it opened on the held front door: sign-in only, no code box, so a guest who
 * added their link to the Home Screen could not get back in. The manifest the
 * app is built from now starts at /start, which sends each kind of person
 * where they belong. The browser walk is `e2e/guest-link-home-screen.spec.ts`
 * (WebKit, the test plan's independent spec).
 */

describe("the installed app starts at /start", () => {
  it("the manifest the app is served (not its source text) starts there", () => {
    expect(manifest().start_url).toBe(HOME_SCREEN_START);
    expect(HOME_SCREEN_START).toBe("/start");
  });

  it("CONTROL: the held front door is not a start a guest can use", () => {
    expect(manifest().start_url).not.toBe("/");
  });
});

describe("where /start sends each kind of person", () => {
  it("an account: its own home, as the front door sends it", () => {
    expect(startDestination({ kind: "account", eventId: "ev1", viewRole: "player" })).toBe("/me");
    expect(startDestination({ kind: "account", eventId: "ev1", viewRole: "admin" })).toBe("/dashboard");
    expect(startDestination({ kind: "account", eventId: "", viewRole: "admin" }), "signed up, no event yet").toBe("/choose");
  });
  it("a guest's live link: Today", () => {
    expect(startDestination({ kind: "guest" })).toBe("/me");
  });
  it("a link that has ended: /p, which says so — never a broken /me", () => {
    expect(startDestination({ kind: "nobody", holdsEndedLink: true })).toBe("/p?ended=1");
  });
  it("nobody: /p, the code box one press away", () => {
    expect(startDestination({ kind: "nobody", holdsEndedLink: false })).toBe("/p");
  });
  it("the route asks the player viewer and draws nothing of its own; the landing page is untouched", () => {
    const page = readSource("src", "app", "start", "page.tsx");
    expect(page).toContain("await getPlayerViewer()");
    expect(page).toContain("await holdsGuestCookie()");
    expect(readSource("src", "app", "page.tsx")).not.toContain("home-screen-start");
  });
  it("/p offers the way back for somebody with an account", () => {
    expect(readSource("src", "app", "p", "page.tsx")).toContain("Have an account? Sign in");
  });
});
