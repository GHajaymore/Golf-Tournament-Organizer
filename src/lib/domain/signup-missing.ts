import { MIN_PASSWORD_LENGTH } from "./password";

/**
 * WHAT A SIGN-UP STILL NEEDS, said in words (Ajay, 2026-09-30).
 *
 * "Create account" used to sit grey and dead until every field was right, so a
 * person who had skipped one question was left pressing a button that did
 * nothing, with nothing on screen to say which question. The button now always
 * presses, and pressing it early says exactly what is missing — in the order
 * the form asks for it.
 *
 * Null when nothing is missing; the server still judges the password itself.
 */
export function signupMissing(f: { name: string; email: string; password: string; kind: string | null | undefined }): string | null {
  const missing: string[] = [];
  if (!f.name.trim()) missing.push("your name");
  if (!f.email.trim()) missing.push("your email");
  if (f.password.length < MIN_PASSWORD_LENGTH) {
    const left = MIN_PASSWORD_LENGTH - f.password.length;
    missing.push(
      f.password.length === 0
        ? `a password of at least ${MIN_PASSWORD_LENGTH} characters`
        : `${left} more ${left === 1 ? "character" : "characters"} in your password`,
    );
  }
  if (!f.kind) missing.push("what you're organizing golf for");
  if (missing.length === 0) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `To create your account, add ${list}.`;
}
