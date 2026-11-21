import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /REGISTER IS OUTSIDE THE SIGN-IN HOLD (J39/J40 PR 3B; Security Lead condition 4, 20 Nov).
 *
 * With production holding (an owner on OWNER_EMAILS, no SIGNINS=open) /register still answers its code box: the page
 * renders (a held page would redirect, which throws), says what it says, and shows neither the held front door's words
 * nor a sign-up form nor a sign-up control. A guest's code opens the sign-up page for that event and no account is
 * made, so the hold has nothing to refuse. Rendered here under a held environment; the held SERVER is the same
 * `process.env`.
 *
 * Break-it (seen red): `if (signInsClosed()) redirect("/login")` at the top of the page.
 */

vi.mock("@/app/actions/guest-entry", () => ({ guestEntryFor: async () => ({ code: "" }) }));

import { signInsClosed, HELD_FRONT_DOOR } from "@/lib/sign-in-gate";
import RegisterCodePage from "@/app/register/page";

afterEach(() => vi.unstubAllEnvs());

function hold() {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("OWNER_EMAILS", "boss@example.invalid");
  vi.stubEnv("SIGNINS", "");
  vi.stubEnv("SIGNIN_ALLOW_EMAILS", "");
}

describe("/register while sign-ins are held", () => {
  it("control: the environment under test really is held", () => {
    hold();
    expect(signInsClosed()).toBe(true);
  });

  it("answers its code box and nothing of the held front door or a sign-up", () => {
    hold();
    const html = renderToStaticMarkup(<RegisterCodePage />);
    expect(html).toContain("Sign up with a code");
    expect(html).toContain('id="register-code"');
    expect(html).toContain("Code from the poster");
    for (const words of [HELD_FRONT_DOOR.heading, HELD_FRONT_DOOR.lead, HELD_FRONT_DOOR.staffLink, HELD_FRONT_DOOR.cta]) {
      expect(html, words).not.toContain(words);
    }
    expect(html).not.toMatch(/type="password"|name="password"|type="email"|name="email"/);
    expect(html).not.toMatch(/href="\/(signup|sign-up|login|interest)/);
    expect(html).not.toMatch(/Sign up<|Create account|Start free/);
  });
});
