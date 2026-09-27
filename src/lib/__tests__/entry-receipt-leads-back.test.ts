import { describe, it, expect, vi } from "vitest";
import { readSource } from "./source";

vi.mock("@/app/actions/register", () => ({ registerForEvent: async () => ({ ok: true }) }));

import { entryReceipt } from "@/components/RegisterClient";

/**
 * THE ENTRY FORM'S "YOU'RE IN!" LEADS A SIGNED-IN MEMBER BACK INTO THE APP.
 *
 * Walked 2026-09-27 as a member on a 393px phone: one-tap entry on Events
 * needed a mobile the club did not have, so it sent them to the public entry
 * form — which then confirmed them and stopped. No navigation on the page, and
 * inside the installed app no browser back button. It also told somebody who
 * was signed in to "use this email to sign in".
 *
 * A stranger on the public link is unchanged: no way into an app they have no
 * account for, and still told which address signs them in.
 */
describe("the confirmation after entering on the sign-up link", () => {
  it("leads a signed-in member back to their events, and does not tell them to sign in", () => {
    const r = entryReceipt({ status: "confirmed" }, "zz-Captain's Day", true);
    expect(r.heading).toBe("You're in!");
    expect(r.backToApp).toBe(true);
    expect(r.detail).toBe("You're confirmed in the field for zz-Captain's Day.");
  });

  it("leaves a stranger exactly as before (the control)", () => {
    const r = entryReceipt({ status: "confirmed" }, "zz-Captain's Day", false);
    expect(r.backToApp).toBe(false);
    expect(r.detail).toBe("You're confirmed in the field for zz-Captain's Day. Use this email to sign in.");
  });

  it("leads back from every outcome, not only a confirmed place", () => {
    for (const done of [{ status: "waitlisted" as const }, { status: "pending" as const }, { already: true }]) {
      expect(entryReceipt(done, "zz", true).backToApp).toBe(true);
    }
  });

  it("the page tells the form whether the visitor is signed in, and the link renders from it", () => {
    const page = readSource("src", "app", "register", "[token]", "page.tsx");
    expect(page).toMatch(/<RegisterClient[\s\S]*?signedIn=\{!!session\}/);
    const form = readSource("src", "components", "RegisterClient.tsx");
    expect(form).toMatch(/\{backToApp && \(\s*<a href="\/me\/events"/);
  });
});
