import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * ONE LIST OF KINDS, ONE SET OF WORDS (2026-11-09). The kinds a club is offered
 * come from `playKindsFor(register)` and the words a screen prints for an
 * event's kind from `eventWords(kind, register)`. A screen that builds its own
 * list, or names a kind in a string, is one country's golf shown to every club.
 */
const SRC = join(__dirname, "..", "..");
const REPO = join(SRC, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => relative(REPO, p).split("\\").join("/"));
const OWNERS = [
  "src/lib/domain/play-kind.ts",
  "src/lib/domain/event-words.ts",
  // CSS attribute selectors of the landing page's feature tabs (input[value=\"competition\"]): not a list of kinds.
  "src/lib/landing/styles.ts",
];
/** Words only a kind of play uses: banned as a whole string or as JSX text, wherever it stands. */
const OWN_WORDS = "Society day|Roll-up|Rollup|Charity day|Charity outing|Charity golf day|Golf day|Outing";
const WORD_LITERAL = new RegExp("[\"'`](" + OWN_WORDS + ")[\"'`]|>\\s*(" + OWN_WORDS + ")\\s*<");
/**
 * Words a format also uses ("Medal" for a stroke round, "Stroke play" for a radio): banned where they
 * stand as a KIND: the text of an <option>, or a `label:` of an option list.
 */
const SHARED_WORDS = "Medal|Stroke play|Stroke";
const WORD_AS_OPTION = new RegExp(
  "<option[^>]*>\\s*(" + SHARED_WORDS + "|" + OWN_WORDS + ")\\s*</option>|label:\\s*[\"'`](" + SHARED_WORDS + ")[\"'`]",
);
/** A list built from the kinds' keys: as an option's value or a key, or the one key only this list uses. */
const KEY_NAMES = "rollup|society|charity|outing|medal|championship|competition";
const KEY_LITERAL = new RegExp(
  "\\bvalue\\s*[=:]\\s*\\{?\\s*[\"'`](?:" + KEY_NAMES + ")[\"'`]|[\"'`]rollup[\"'`]|\\bkey:\\s*[\"'`]rollup[\"'`]" +
    "|\\[\\s*[\"'`](?:" + KEY_NAMES + ")[\"'`]\\s*,\\s*[\"'`](?:" + KEY_NAMES + ")[\"'`]",
);
/** A call to `playKindsFor` whose first argument is anything but the identifier `register`. */
const CALL_WITH_LITERAL = /\bplayKindsFor\(\s*(?!register\b)/;

/** The shapes: the list read outside its owners, a kind's word or key typed into code, a list asked for without the register. */
function offences(file: string, code: string): string[] {
  if (OWNERS.includes(file)) return [];
  const found: string[] = [];
  if (/\bPLAY_KIND_KEYS\b|\bplayKindWord\b/.test(code)) found.push("reads the kinds directly");
  if (WORD_LITERAL.test(code)) found.push("types a kind's word");
  if (WORD_AS_OPTION.test(code)) found.push("lists a kind's word as an option");
  if (KEY_LITERAL.test(code)) found.push("builds a list from the kinds' keys");
  if (CALL_WITH_LITERAL.test(code)) found.push("asks for a list without passing the register");
  return found;
}

describe("the kinds of play follow the club's country, from one place", () => {
  it("no screen builds its own list of kinds or types a kind's word", () => {
    expect(FILES.length).toBeGreaterThan(100);
    const bad = FILES.flatMap((f) => offences(f, readSource(f)).map((o) => `${f}: ${o}`));
    expect(bad).toEqual([]);
  });

  it("CONTROL: the guard sees each shape", () => {
    const seen = (code: string) => offences("src/x.tsx", code).length > 0;
    // Each bad shape the review found, one control apiece.
    expect(seen("const k = PLAY_KIND_KEYS;")).toBe(true);
    expect(seen('const k = playKindWord("outing", r);')).toBe(true);
    expect(seen('const k = "Roll-up";')).toBe(true);
    expect(seen("<option>Roll-up</option>")).toBe(true);
    expect(seen("<span>Society day</span>")).toBe(true);
    expect(seen('const a = ["Charity golf day"];')).toBe(true);
    expect(seen('const a = "Outing";')).toBe(true);
    expect(seen('<option value="medal">Medal</option>')).toBe(true);
    expect(seen("<option>Stroke play</option>")).toBe(true);
    expect(seen('const o = { label: "Medal" };')).toBe(true);
    expect(seen('<option value="rollup">x</option>')).toBe(true);
    expect(seen('<option value={"society"}>x</option>')).toBe(true);
    expect(seen('const o = [{ value: "charity", label: "x" }];')).toBe(true);
    expect(seen('const ks = ["outing", "charity", "league"];')).toBe(true);
    expect(seen('const o = "rollup";')).toBe(true);
    expect(seen('playKindsFor("us")')).toBe(true);
    expect(seen("playKindsFor(us)")).toBe(true);
    expect(seen("playKindsFor(golfRegister(c))")).toBe(true);
    // And what is allowed passes: a format called Medal in a sentence, the call with the identifier.
    expect(seen('const fmt = a.scoring === "stroke" ? "Medal" : "Tournament";')).toBe(false);
    expect(seen('<label><input />Stroke play</label>')).toBe(false);
    expect(seen("playKindsFor(register, f.playKind)")).toBe(false);
    expect(seen("playKindsFor(register)")).toBe(false);
  });

  it("the screens that print a kind ask eventWords", () => {
    for (const f of ["src/components/ResultLines.tsx", "src/components/ClubEventsList.tsx", "src/components/EventSetupClient.tsx"]) {
      expect(readSource(f), f).toMatch(/eventWords\(/);
    }
    expect(readSource("src/components/EventSetupClient.tsx")).toMatch(/playKindsFor\(register/);
    // The dates label is named after the event's kind (Ajay, 2026-11-09), not the word Tournament.
    expect(readSource("src/components/EventSetupClient.tsx")).toMatch(/\{words\.kind\} dates/);
  });
});
