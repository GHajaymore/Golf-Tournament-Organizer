import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";

/**
 * NO SESSION FOR AN ADDRESS NOBODY HAS PROVED (2026-10-21).
 *
 * The fault this closes: `claimPassword` set the first password on any invited
 * address and signed the caller in, and `signUp` signed anybody in under any
 * address — and access follows the address. Whoever typed an invited address
 * first WAS that person.
 *
 * The rule lives at the SINK, `createSession`, so a door added later is shut
 * without knowing it — the same shape as the sign-in hold. What this sweep
 * holds is that the sink cannot be walked round:
 *
 *   1. `createSession` refuses an unproved user before it sets the cookie;
 *   2. nothing else in the app writes the session cookie or makes its value;
 *   3. every caller of `createSession` is on a list that says why, and the
 *      doors that sign somebody in read its answer;
 *   4. sign-up and claim, the two doors a stranger reaches with only an
 *      address, make no session and write no password themselves.
 *
 * The real-row half — no session, no access, wrong and expired codes refused,
 * the takeover attempt getting nothing — is
 * `an-address-is-proved-before-it-signs-in.audit.test.ts`.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC).map((full) => ({
  rel: relative(process.cwd(), full).split(sep).join("/"),
  src: readSource(relative(process.cwd(), full)),
}));

/** Writes the session cookie, or makes the value that goes in it. */
function mintsASession(src: string): boolean {
  return src.includes("ng_session") || src.includes("sessionValue(");
}

function body(src: string, start: string): string {
  const at = src.indexOf(start);
  if (at < 0) return "";
  const next = src.indexOf("\nexport ", at + start.length);
  return src.slice(at, next < 0 ? undefined : next);
}

describe("a session is made only for a proved address", () => {
  it("found the source at all", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === "src/lib/auth.ts")).toBe(true);
  });

  it("createSession refuses an unproved user BEFORE it sets the cookie", () => {
    const auth = readSource("src/lib/auth.ts");
    const create = body(auth, "export async function createSession(");
    const refusal = create.indexOf("if (!who?.emailVerifiedAt) return false;");
    expect(refusal, "createSession no longer asks whether the address is proved").toBeGreaterThan(-1);
    expect(create).toMatch(/select: \{ email: true, emailVerifiedAt: true \}/);
    expect(refusal).toBeLessThan(create.indexOf("jar.set(COOKIE"));
    expect(create).toMatch(/Promise<boolean>/);
  });

  it("nothing but lib/auth.ts writes the session cookie or makes its value", () => {
    const allowed = new Set(["src/lib/auth.ts", "src/lib/domain/session-token.ts"]);
    const minting = files.filter((f) => !allowed.has(f.rel) && mintsASession(f.src)).map((f) => f.rel);
    expect(minting).toEqual([]);
  });

  it("CONTROL: the detector sees a door that mints its own session", () => {
    expect(mintsASession(`jar.set("ng_session", sign(userId))`)).toBe(true);
    expect(mintsASession(`jar.set(C, sign(sessionValue(id)))`)).toBe(true);
    expect(mintsASession(`await createSession(user.id)`)).toBe(false);
  });

  /** Every place a session is asked for, and why it may be. */
  const CALLERS: Record<string, string> = {
    "src/app/actions/auth.ts": "startSessionFor, which every sign-in door goes through, and which reads the answer",
    "src/app/actions/club-deletion.ts": "re-issues the session of somebody already signed in, after their club is deleted",
  };

  it("every caller of createSession is listed, and a new one fails here until it is", () => {
    const callers = files.filter((f) => f.rel !== "src/lib/auth.ts" && f.src.includes("createSession(")).map((f) => f.rel);
    expect(callers.length, "found no callers — the sweep would pass on nothing").toBeGreaterThan(0);
    expect(callers.sort()).toEqual(Object.keys(CALLERS).sort());
  });

  it("the sign-in doors read createSession's answer rather than assume it", () => {
    const actions = readSource("src/app/actions/auth.ts");
    const calls = actions.split("createSession(").length - 1;
    expect(calls).toBe(1);
    expect(actions).toMatch(/if \(!\(await createSession\(user\.id\)\)\) return false;/);
  });

  it("sign-up and claim make no session and set no password — the code does", () => {
    const actions = readSource("src/app/actions/auth.ts");
    for (const door of ["export async function signUp(", "export async function claimPassword("]) {
      const b = body(actions, door);
      expect(b.length, door).toBeGreaterThan(200);
      expect(b, door).not.toMatch(/startSessionFor\(|createSession\(|redirect\(/);
      // The password is hashed into what WAITS on the code, never onto the User.
      expect(b, door).not.toMatch(/(update|create): \{[^}]*password:/);
      expect(b, door).toMatch(/pending: \{ passwordHash: hashPassword\(password\)/);
    }
    // Applied in one place: when the code is right.
    const prove = body(readSource("src/lib/services/email-code.ts"), "export async function proveAddress(");
    expect(prove).toMatch(/emailVerifiedAt: now/);
    expect(prove).toMatch(/password: pending\.passwordHash/);
  });

  it("CONTROL: the door check sees a door that signs in or sets a password", () => {
    const bad = `export async function signUp() { await prisma.user.upsert({ update: { password: hashPassword(p) } }); redirect("/"); }`;
    expect(bad).toMatch(/startSessionFor\(|createSession\(|redirect\(/);
    expect(bad).toMatch(/(update|create): \{[^}]*password:/);
  });

  it("a finished reset proves the address too — the link only ever reached the inbox", () => {
    const reset = body(readSource("src/app/actions/auth.ts"), "export async function resetPassword(");
    expect(reset).toMatch(/emailVerifiedAt: owner\?\.emailVerifiedAt \?\? now/);
  });
});
