import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * ONE DOOR FOR A TYPED CODE (plan row 4c, simplicity cut 1; design "One code
 * box" §6, Security items 1-6). The sweep that refuses a SECOND way in.
 *
 * Every box a player types a code into goes through `openAnyCode`
 * (services/code-door.ts). What made two doors before was two copies: two
 * readers of `Stage.accessCode`, a budget chosen by the box, a truncation that
 * decided a shape from a prefix, and a sentence per kind. Each is banned here
 * by its SHAPE, not its spelling, each with a CONTROL that shows the check can
 * see what it refuses.
 */

const DOOR_FILE = "src/lib/services/code-door.ts";
const SHAPE_FILE = "src/lib/domain/code-shape.ts";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}
const SRC = files("src").map((f) => ({ f, text: readSource(f) }));
const E2E = files("e2e").map((f) => ({ f, text: readSource(f) }));
const where = (pattern: RegExp, among = SRC) => among.filter(({ text }) => pattern.test(text)).map(({ f }) => f).sort();

/** A redemption lookup: a `find…` by `accessCode` that is not the empty "no code" value. */
const READS_ACCESS_CODE = /\.find\w*\(\s*\{\s*where:\s*\{[^}]*\baccessCode:(?!\s*"")/;
/** A minting check: is this fresh code already taken (a count, never a redemption). */
const COUNTS_ACCESS_CODE = /\.count\(\s*\{\s*where:\s*\{[^}]*\baccessCode:(?!\s*"")/;

describe("one reader of a round code", () => {
  it("only the door reads Stage.accessCode to redeem it", () => {
    expect(where(READS_ACCESS_CODE)).toEqual([DOOR_FILE]);
  });
  it("the minting checks count, and are where codes are made", () => {
    expect(where(COUNTS_ACCESS_CODE)).toEqual(["src/app/actions/match-setup.ts", "src/app/actions/settings.ts", "src/lib/services/round-codes.ts"]);
  });
  it("CONTROL: a second reader is seen; a no-code filter and a count are not readers", () => {
    expect(READS_ACCESS_CODE.test("await prisma.stage.findFirst({ where: { accessCode: code }, include: { event: true } })")).toBe(true);
    expect(READS_ACCESS_CODE.test("prisma.stage.findMany({\n  where: { eventId, accessCode: typed },\n})")).toBe(true);
    expect(READS_ACCESS_CODE.test('prisma.stage.findMany({ where: { eventId, accessCode: "" } })')).toBe(false);
    expect(READS_ACCESS_CODE.test("prisma.stage.count({ where: { accessCode: code } })")).toBe(false);
  });
});

describe("one reader of a personal code", () => {
  it("only the door looks a typed personal code up (passForCode is defined in the link's service)", () => {
    expect(where(/\bpassForCode\(/)).toEqual([DOOR_FILE, "src/lib/services/player-link.ts"]);
    const service = readSource("src/lib/services/player-link.ts");
    expect(service.match(/\bpassForCode\(/g)?.length, "the service defines it and does not call it").toBe(1);
  });
  it("only the link's own service hashes a code into a lookup", () => {
    expect(where(/\blookupOf\(/)).toEqual(["src/lib/services/player-link.ts"]);
  });
});

describe("the per-code budget is the round code's, and only in its branch (Security items 1 and 3)", () => {
  const PER_CODE = /\b(check|clear)RateLimit\("round-code"/;
  it("only the door and the round's second step name it", () => {
    expect(where(PER_CODE)).toEqual(["src/app/actions/play.ts", DOOR_FILE]);
  });
  it("in the door, only inside the eight's branch; in play.ts, only inside claimPlayerSlot", () => {
    const door = readSource(DOOR_FILE);
    const eight = door.slice(door.indexOf("async function openEight("), door.indexOf("async function openTwelve("));
    expect(eight.length).toBeGreaterThan(100);
    expect(door.match(/\b(check|clear)RateLimit\(/g)?.length).toBe(eight.match(/\b(check|clear)RateLimit\(/g)?.length);
    const play = readSource("src/app/actions/play.ts");
    const claim = play.slice(play.indexOf("export async function claimPlayerSlot("), play.indexOf("export async function claimPlayerSlotForm("));
    expect(claim.length).toBeGreaterThan(100);
    expect(play.match(/\b(check|clear)RateLimit\(/g)?.length).toBe(claim.match(/\b(check|clear)RateLimit\(/g)?.length);
  });
  it("the round's second step takes nothing but an eight to its per-code key", () => {
    const play = readSource("src/app/actions/play.ts");
    const claim = play.slice(play.indexOf("export async function claimPlayerSlot("), play.indexOf("export async function claimPlayerSlotForm("));
    expect(claim).toMatch(/if \(shape\.shape !== "eight"\) return \{ ok: false, error: CODE_WORDS\.opensNothing \};/);
    expect(claim.indexOf('shape.shape !== "eight"')).toBeLessThan(claim.indexOf('checkRateLimit("round-code"'));
  });
});

describe("the door is entered only from its press and the round's second step", () => {
  it("no other server action imports it", () => {
    const actions = SRC.filter(({ text }) => /^\s*["']use server["']/.test(text));
    const importers = actions.filter(({ text }) => /from "@\/lib\/services\/code-door"/.test(text)).map(({ f }) => f).sort();
    expect(actions.length, "the sweep sees the actions").toBeGreaterThan(20);
    expect(importers).toEqual(["src/app/actions/code-box.ts", "src/app/actions/play.ts"]);
  });
  it("nothing exported by the door takes a box: the answer cannot depend on which page asked (item 2)", () => {
    const door = readSource(DOOR_FILE);
    const signatures = [...door.matchAll(/export (?:async )?function (\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]] as const);
    expect(signatures.map(([n]) => n).sort()).toEqual(["guessGate", "lookupEight", "openAnyCode"]);
    for (const [name, params] of signatures) expect(params, name).not.toMatch(/\bbox\b|CodeBox/);
    expect(door).not.toMatch(/\bCodeBox\b|boxStepFor/);
  });
  it("it never makes an account's session, and asks no sign-in hold (item 6)", () => {
    const door = readSource(DOOR_FILE) + readSource("src/app/actions/code-box.ts");
    expect(door).not.toMatch(/\bcreateSession\(|\bmaySignInNow\(|\bsignInsHeld\(/);
  });
  it("CONTROL: a box parameter would be seen", () => {
    const m = [..."export async function openAnyCode(input: unknown, box: CodeBox)".matchAll(/export (?:async )?function (\w+)\(([^)]*)\)/g)][0];
    expect(m[2]).toMatch(/\bbox\b/);
  });
});

describe("no shape is decided from a prefix (item 1)", () => {
  it("normalizeAccessCode keeps the whole input", () => {
    const format = readSource("src/lib/code-format.ts");
    const body = format.slice(format.indexOf("export function normalizeAccessCode("), format.indexOf("export function looksLikeAccessCode("));
    expect(body.length).toBeGreaterThan(40);
    expect(body).not.toMatch(/\.slice\(|\.substring\(|\.substr\(/);
  });
  it("the shape module cuts nothing to a length either", () => {
    expect(readSource(SHAPE_FILE)).not.toMatch(/\.(slice|substring|substr)\(\s*0\s*,\s*(CODE_LENGTH|LINK_CODE_LENGTH|8|12)\s*\)/);
  });
});

describe("one failure sentence and one throttle sentence (item 4)", () => {
  // The shape of a per-kind sentence, whatever its spelling.
  const PER_KIND = /doesn't look like a [^"`]* code|code isn't valid|Too many (link|code) attempts/i;
  it("only the shape module words them; every other file says CODE_WORDS", () => {
    expect(where(PER_KIND)).toEqual([SHAPE_FILE]);
    expect(where(PER_KIND, E2E), "a spec compares with CODE_WORDS, never a copy").toEqual([]);
  });
  it("CONTROL: the old sentences are seen", () => {
    expect(PER_KIND.test("That doesn't look like a round code. It's 8 characters, like ABCD-EFGH.")).toBe(true);
    expect(PER_KIND.test("That doesn't look like a player link code.")).toBe(true);
    expect(PER_KIND.test("That code isn't valid. Check it with your organizer.")).toBe(true);
    expect(PER_KIND.test("Too many link attempts. Wait 5 minutes")).toBe(true);
    expect(PER_KIND.test("That doesn't look like a photo. Use a JPEG, PNG or WebP.")).toBe(false);
  });
});

/**
 * ONE BUILDER OF A SIGN'S ADDRESS, AND ONE HOME FOR A LINK CODE'S SHAPE (one
 * code box PR B; the Principal Engineer's C1 and N1 on #1176).
 *
 * A second `/play#${…}` builder skips the escaping `roundCodeLink` does (a /p box
 * builds this address from what somebody TYPED), and two screens had one: the
 * opener's dead branch and the demo's door. And a client box needs the SHAPE of a
 * link code, not the pass's lifetime rules and the feature's words, so the
 * alphabet, the length, the reader and the one input cap live in one small
 * browser-safe module and nowhere else.
 */
describe("one builder of a sign's address (C1)", () => {
  // The shape, not the spelling: any template that puts something after `/play#`.
  const BUILDS_A_SIGN_ADDRESS = /`[^`]*\/play#\$\{/;
  it("only code-format.ts builds one", () => {
    expect(where(BUILDS_A_SIGN_ADDRESS)).toEqual(["src/lib/code-format.ts"]);
  });
  it("CONTROL: a second builder is seen, a fixed address and a prose mention are not", () => {
    expect(BUILDS_A_SIGN_ADDRESS.test("window.location.assign(`/play#${r.code}`)")).toBe(true);
    expect(BUILDS_A_SIGN_ADDRESS.test("to(code ? `/play#${formatAccessCode(code)}` : \"/demo\")")).toBe(true);
    expect(BUILDS_A_SIGN_ADDRESS.test("`${origin}/play#${encodeURIComponent(code)}`")).toBe(true);
    expect(BUILDS_A_SIGN_ADDRESS.test("href: \"/play\"")).toBe(false);
    expect(BUILDS_A_SIGN_ADDRESS.test("`/play?sw=1`")).toBe(false);
  });
  it("the two screens that had a copy ask roundCodeLink", () => {
    expect(readSource("src/components/PlayerLinkOpener.tsx")).toMatch(/roundCodeLink\(/);
    expect(readSource("src/app/demo/[door]/route.ts")).toMatch(/roundCodeLink\(/);
  });
});

describe("a link code's shape has one browser-safe home (N1)", () => {
  const HOME = "src/lib/link-code-format.ts";
  it("the alphabet, the length, the reader and the input cap are defined only there", () => {
    expect(where(/export const LINK_ALPHABET\b/)).toEqual([HOME]);
    expect(where(/export const LINK_CODE_LENGTH\b/)).toEqual([HOME]);
    expect(where(/export const MAX_CODE_INPUT\b/)).toEqual([HOME]);
    expect(where(/export function normaliseLinkCode\b/)).toEqual([HOME]);
  });
  it("domain/player-link.ts re-exports them, so every other importer is unchanged", () => {
    expect(readSource("src/lib/domain/player-link.ts")).toMatch(/export \{[^}]*LINK_ALPHABET[^}]*normaliseLinkCode[^}]*\} from "\.\.\/link-code-format"/);
  });
  it("the shape reader and both code boxes take the small module, never the pass's rules", () => {
    // code-shape.ts runs in /play's and /p's bundles; PlayerLinkOpener reads the fragment with the reader.
    expect(readSource("src/lib/domain/code-shape.ts")).not.toMatch(/from "\.\/player-link"|from "@\/lib\/domain\/player-link"/);
    expect(readSource("src/lib/domain/code-shape.ts")).toMatch(/from "\.\.\/link-code-format"/);
    expect(readSource("src/components/PlayerLinkOpener.tsx")).toMatch(/normaliseLinkCode\b[^;]*from "@\/lib\/link-code-format"/);
    expect(readSource("src/components/PlayClient.tsx")).not.toMatch(/normaliseLinkCode/);
  });
  it("CONTROL: a second definition of the input cap would be seen", () => {
    expect(/export const MAX_CODE_INPUT\b/.test("export const MAX_CODE_INPUT = 128;")).toBe(true);
  });
});
