import { describe, it, expect, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

vi.mock("server-only", () => ({}));

const { passwordRefusal, passwordSeenInBreach } = await import("@/lib/services/password-breach");
const { PASSWORD_SEEN_IN_BREACH } = await import("@/lib/domain/password-breach");

/**
 * A NEW PASSWORD IS CHECKED AGAINST KNOWN LEAKS (2026-10-21) — see
 * `services/password-breach.ts`. The decision with the service stood in for,
 * and the sweep that holds every action that sets a password to the one gate.
 */

// "correct-horse-battery-staple" passes every rule in password.ts, so whatever
// refuses it below is the leak check and nothing else. Its SHA-1 starts DD606.
const GOOD_SHAPE = "correct-horse-battery-staple";

function service(answer: (prefix: string) => string) {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      onVercel: true,
      fetchRange: async (prefix: string) => {
        asked.push(prefix);
        return answer(prefix);
      },
    },
  };
}

describe("asking the leak list", () => {
  it("refuses a password the list knows, in the words for it", async () => {
    // Answer as the service would for this prefix: every suffix we are asked about is present.
    const { createHash } = await import("node:crypto");
    const suffix = createHash("sha1").update(GOOD_SHAPE).digest("hex").toUpperCase().slice(5);
    const s = service(() => `00000000000000000000000000000000001:2\r\n${suffix}:57\r\n`);
    expect(await passwordRefusal(GOOD_SHAPE, undefined, s.deps)).toBe(PASSWORD_SEEN_IN_BREACH);
  });

  it("sends only five characters of the hash, never the password", async () => {
    const s = service(() => "");
    await passwordSeenInBreach(GOOD_SHAPE, s.deps);
    expect(s.asked).toEqual(["DD606"]);
    expect(s.asked.join("")).not.toContain("horse");
  });

  it("CONTROL: lets through a password the list does not know", async () => {
    const s = service(() => "00000000000000000000000000000000001:2\r\n");
    expect(await passwordRefusal(GOOD_SHAPE, undefined, s.deps)).toBeNull();
  });

  it("the rules come first: a short password is told it is short, and the list is not asked", async () => {
    const s = service(() => "");
    expect(await passwordRefusal("short", undefined, s.deps)).toContain("at least");
    expect(s.asked).toEqual([]);
  });

  it("asks nothing off Vercel — dev, CI and the e2e server never reach the internet", async () => {
    const s = service(() => "");
    expect(await passwordRefusal(GOOD_SHAPE, undefined, { ...s.deps, onVercel: false })).toBeNull();
    expect(s.asked).toEqual([]);
  });

  it("a list that cannot answer lets the password through, and says so in the log", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = { onVercel: true, fetchRange: async () => { throw new Error("timeout"); } };
    expect(await passwordRefusal(GOOD_SHAPE, undefined, deps)).toBeNull();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

/** Every file under src/app, comments out. */
function appSources(dir = join(process.cwd(), "src", "app")): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...appSources(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push({ file: path, src: readSource(relative(process.cwd(), path)) });
  }
  return out;
}
const count = (src: string, needle: string) => src.split(needle).length - 1;

describe("every door that sets a password goes through the one gate", () => {
  const files = appSources();
  const setting = files.filter((f) => f.src.includes("hashPassword("));

  it("CONTROL: the sweep sees the three doors it is about (sign-up, claim, reset)", () => {
    expect(setting.map((f) => f.file.split(/[\\/]/).pop())).toEqual(["auth.ts"]);
    expect(count(setting[0].src, "hashPassword(")).toBe(3);
  });

  it("each file that hashes a password asks passwordRefusal at least as often", () => {
    for (const f of setting) {
      expect(count(f.src, "await passwordRefusal("), f.file).toBeGreaterThanOrEqual(count(f.src, "hashPassword("));
    }
  });

  it("no action asks the rules alone, which would skip the leak check", () => {
    for (const f of files) expect(f.src.includes("passwordProblem("), f.file).toBe(false);
  });
});
