import { describe, it, expect } from "vitest";
import { signupMissing } from "../signup-missing";
import { MIN_PASSWORD_LENGTH } from "../password";

const full = { name: "Zz Walker", email: "zz-walk@example.invalid", password: "x".repeat(MIN_PASSWORD_LENGTH), kind: "society" };

describe("what a sign-up still needs", () => {
  it("nothing, when every question is answered", () => {
    expect(signupMissing(full)).toBeNull();
  });

  it("names the one thing missing", () => {
    expect(signupMissing({ ...full, kind: null })).toBe("To create your account, add what you're organizing golf for.");
    expect(signupMissing({ ...full, name: "  " })).toBe("To create your account, add your name.");
  });

  it("counts down a short password rather than restating the rule", () => {
    expect(signupMissing({ ...full, password: "x".repeat(MIN_PASSWORD_LENGTH - 1) })).toBe(
      "To create your account, add 1 more character in your password.",
    );
  });

  it("lists everything, in the order the form asks", () => {
    expect(signupMissing({ name: "", email: "", password: "", kind: undefined })).toBe(
      `To create your account, add your name, your email, a password of at least ${MIN_PASSWORD_LENGTH} characters and what you're organizing golf for.`,
    );
  });
});
