import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  cleanHoleResults,
  cleanStrokes,
  cleanWinner,
  cleanMargin,
  MAX_STROKES_PER_HOLE,
} from "../score-payload";

/**
 * These payloads arrive from a browser over a public endpoint. The TypeScript
 * signature on the action is erased at runtime and guarantees nothing, so the
 * cases that matter are the ones a normal client would never send.
 */

const nine = (v: unknown) => Array(9).fill(v);

describe("hole-by-hole results", () => {
  it("accepts a real card", () => {
    const card = ["A", "B", "H", "A", null, "B", "H", "A", "B"];
    expect(cleanHoleResults(card, 9)).toEqual(card);
  });

  it("caps an array longer than the round", () => {
    // The finding this module exists for: holes.length drives nassau
    // segmentation and tiebreak hole selection, so forty entries on an
    // eighteen-hole round produces a result the course cannot generate.
    expect(cleanHoleResults(Array(40).fill("A"), 18)).toHaveLength(18);
    expect(cleanHoleResults(Array(19).fill("A"), 18)).toHaveLength(18);
  });

  it("pads a short card rather than refusing it", () => {
    // A short card is legitimate and common: a round set to nine holes,
    // scored, then changed to eighteen. The editor loads it exactly as stored,
    // so refusing here would make a real card permanently unsaveable.
    const padded = cleanHoleResults(nine("A"), 18);
    expect(padded).toHaveLength(18);
    expect(padded?.slice(0, 9)).toEqual(nine("A"));
    expect(padded?.slice(9)).toEqual(Array(9).fill(null));
  });

  it("refuses values outside A, B and H", () => {
    expect(cleanHoleResults([...Array(8).fill("A"), "X"], 9)).toBeNull();
    expect(cleanHoleResults([...Array(8).fill("A"), 1], 9)).toBeNull();
    expect(cleanHoleResults([...Array(8).fill("A"), { a: 1 }], 9)).toBeNull();
  });

  it("refuses anything that is not an array", () => {
    expect(cleanHoleResults(null, 18)).toBeNull();
    expect(cleanHoleResults("AAAA", 18)).toBeNull();
    expect(cleanHoleResults({ length: 18 }, 18)).toBeNull();
    expect(cleanHoleResults(undefined, 18)).toBeNull();
  });

  it("treats undefined entries as an unplayed hole", () => {
    // A sparse array from a client is a gap, not an attack.
    expect(cleanHoleResults(nine(undefined), 9)).toEqual(nine(null));
  });
});

describe("stroke cards", () => {
  it("accepts a real card", () => {
    const card = [4, 5, 3, 4, null, 4, 3, 4, 5];
    expect(cleanStrokes(card, 9)).toEqual(card);
  });

  it("caps a long card and pads a short one", () => {
    expect(cleanStrokes(Array(30).fill(4), 18)).toHaveLength(18);
    const partial = cleanStrokes([4, 4], 9);
    expect(partial).toEqual([4, 4, null, null, null, null, null, null, null]);
  });

  it("keeps a nine-hole card saveable after the round becomes eighteen", () => {
    // The regression this rule exists to prevent. An exact-length check made
    // every card written before the change permanently unsaveable, with the
    // organizer told their real card "doesn't match this round".
    const card = [4, 5, 3, 4, 4, 4, 3, 4, 5];
    const after = cleanStrokes(card, 18);
    expect(after).not.toBeNull();
    expect(after?.slice(0, 9)).toEqual(card);
    expect(after).toHaveLength(18);
  });

  it("refuses a score nobody wrote on a card", () => {
    // Rejected rather than clamped: turning a 0 into a 1 puts a number on the
    // leaderboard that no player recorded.
    expect(cleanStrokes([...Array(8).fill(4), 0], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), -3], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), MAX_STROKES_PER_HOLE + 1], 9)).toBeNull();
  });

  it("refuses non-integers and non-numbers", () => {
    expect(cleanStrokes([...Array(8).fill(4), 4.5], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), "4"], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), NaN], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), Infinity], 9)).toBeNull();
  });

  it("accepts the boundaries", () => {
    expect(cleanStrokes(nine(1), 9)).toEqual(nine(1));
    expect(cleanStrokes(nine(MAX_STROKES_PER_HOLE), 9)).toEqual(nine(MAX_STROKES_PER_HOLE));
  });
});

describe("winner and margin", () => {
  it("narrows the winner to the three real outcomes", () => {
    expect(cleanWinner("A")).toBe("A");
    expect(cleanWinner("H")).toBe("H");
    expect(cleanWinner("a")).toBeNull();
    expect(cleanWinner("winner")).toBeNull();
    expect(cleanWinner(null)).toBeNull();
    expect(cleanWinner(1)).toBeNull();
  });

  it("bounds the margin without dictating its wording", () => {
    // A committee words this its own way — "3&2", "2 up", "won by default" —
    // so it is bounded rather than enumerated.
    expect(cleanMargin("3&2")).toBe("3&2");
    expect(cleanMargin("  2 up  ")).toBe("2 up");
    expect(cleanMargin("x".repeat(500))).toHaveLength(24);
    expect(cleanMargin(null)).toBe("");
    expect(cleanMargin({})).toBe("");
  });
});

/**
 * The pattern, not just the four instances.
 *
 * This gap appeared in four separate actions written months apart, each with
 * careful authorisation and no payload check — which makes it a habit rather
 * than an oversight. A fifth score-writing action would very likely repeat it,
 * so the rule is enforced instead of remembered: anything persisting a card
 * must persist a value that came out of a cleaner.
 */
describe("no action stores a card it did not validate", () => {
  const root = process.cwd();

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (e.name.endsWith(".ts")) out.push(rel);
    }
    return out;
  }

  /**
   * Named actions rather than a scan of every JSON.stringify.
   *
   * The broad version flagged eight lines and six were server-DERIVED locals
   * that merely share the name — play.ts stores `marginToHoles(...)` into a
   * variable called `holes`, which is exactly right. A guard with that
   * false-positive rate gets switched off, and then the real one is gone too.
   *
   * These four are the actions that take a card straight from the client.
   */
  const TAKES_A_CARD_FROM_THE_CLIENT = [
    ["src/app/actions/play.ts", "savePlayMatchHoles", "cleanHoleResults"],
    ["src/app/actions/tournament.ts", "saveScorecard", "cleanStrokes"],
    ["src/app/actions/tournament.ts", "saveMatchScorecard", "cleanStrokes"],
    ["src/app/actions/tournament.ts", "saveTeamScorecard", "cleanStrokes"],
  ] as const;

  it("cleans the payload in every action that accepts one", () => {
    const missing: string[] = [];
    for (const [file, fn, cleaner] of TAKES_A_CARD_FROM_THE_CLIENT) {
      const src = readFileSync(join(root, file), "utf8");
      const start = src.indexOf(`export async function ${fn}`);
      if (start === -1) {
        missing.push(`${fn} not found in ${file}`);
        continue;
      }
      // To the next top-level export, which is this function's whole body.
      const rest = src.slice(start + 1);
      const end = rest.indexOf("\nexport ");
      const body = end === -1 ? rest : rest.slice(0, end);
      if (!body.includes(cleaner)) missing.push(`${fn} never calls ${cleaner}`);
    }
    expect(missing, missing.join("; ")).toEqual([]);
  });

  it("still has a cleaner to call", () => {
    // Guards the guard: if score-payload.ts were deleted the test above would
    // keep passing on the import line alone.
    const src = readFileSync(join(root, "src/lib/domain/score-payload.ts"), "utf8");
    expect(src).toMatch(/export function cleanStrokes/);
    expect(src).toMatch(/export function cleanHoleResults/);
  });

  it("has a file walker that finds the action directory", () => {
    // Cheap sanity check: an empty walk would make any scan vacuously pass.
    expect(walk("src/app/actions").length).toBeGreaterThan(5);
  });
});
