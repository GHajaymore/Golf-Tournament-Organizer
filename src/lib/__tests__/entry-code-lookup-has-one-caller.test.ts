import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * THE ENTRY CODE'S LOOKUP HAS ONE CALLER (J39/J40 PR 3B; Security Lead C1.1).
 *
 * The 8-character code is looked up in one place, the one door for a typed code (`lookupEight`, called only by
 * `openAnyCode`'s eight branch and by the round's second step, which refuses an entry code). `registerAsGuest` and
 * `registerForEvent` take the 114-bit token and never reach it: a second place to guess codes would not be guarded
 * by the failed-lookup budget. And no other reader of `Event.registrationCode` exists but the door and the code's own
 * minting and clash checks.
 *
 * Break-it (seen red): make `registerAsGuest` look the event up by `registrationCode`.
 */

const body = (src: string, name: string) => {
  const at = src.indexOf(`export async function ${name}(`);
  if (at < 0) return "";
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next < 0 ? undefined : next);
};

/** A call that reaches the entry code's lookup, however it is spelled. */
export const looksUpTheCode = (text: string) => /\blookupEight\(|\bopenAnyCode\(|\bregistrationCode\b/.test(text);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}

describe("the entry code's lookup has one caller", () => {
  it("CONTROL: the sweep sees a lookup", () => {
    expect(looksUpTheCode("await prisma.event.findFirst({ where: { registrationCode: token } })")).toBe(true);
    expect(looksUpTheCode("const found = await lookupEight(code);")).toBe(true);
    expect(looksUpTheCode("await prisma.event.findFirst({ where: { registrationToken: t } })")).toBe(false);
  });

  it("registerAsGuest and registerForEvent never reach it", () => {
    const guest = body(readSource("src/app/actions/guest-entry.ts"), "registerAsGuest");
    const member = readSource("src/app/actions/register.ts");
    expect(guest.length, "registerAsGuest is where the sweep reads it").toBeGreaterThan(500);
    expect(looksUpTheCode(guest)).toBe(false);
    expect(looksUpTheCode(member)).toBe(false);
    // It looks the event up by the TOKEN, and refuses anything of a code's length.
    expect(guest).toContain("registrationToken: t");
    expect(guest).toMatch(/t\.length < 16/);
  });

  it("only the door, the code's own service and the page's staff reader name registrationCode", () => {
    const named = walk("src")
      .filter((f) => /\bregistrationCode\b/.test(readSource(f)))
      .sort();
    expect(named).toEqual([
      "src/app/actions/match-setup.ts",
      "src/app/actions/settings.ts",
      "src/app/actions/tournament.ts",
      "src/lib/services/clone.ts",
      "src/lib/services/code-door.ts",
      "src/lib/services/guest-entry.ts",
      "src/lib/services/round-codes.ts",
    ]);
  });
});
