import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/auth", () => ({ requestPasswordReset: vi.fn() }));
const { SendResetLink } = await import("@/components/SendResetLink");

/**
 * The account page sends the reset link itself (2026-10-03), rather than telling
 * somebody to sign out and find "Forgot?" on another screen.
 */
describe("changing a password from Your account", () => {
  it("offers the link by button, to the signed-in address", () => {
    const html = renderToStaticMarkup(<SendResetLink email="zz-me@example.invalid" />);
    expect(html).toContain("Email me a reset link");
    expect(html).toContain("zz-me@example.invalid");
    expect(html).not.toMatch(/sign out and choose/i);
  });

  it("goes through the same rate-limited reset as the sign-in form's Forgot", () => {
    expect(readSource("src", "components", "SendResetLink.tsx")).toMatch(/requestPasswordReset\(email\)/);
    expect(readSource("src", "app", "account", "page.tsx")).toMatch(/<SendResetLink email=\{session\.email\}/);
  });
});
