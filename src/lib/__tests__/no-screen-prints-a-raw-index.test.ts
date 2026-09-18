import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * NO SCREEN PRINTS A PLAYER'S INDEX WITHOUT ASKING WHETHER THERE IS ONE.
 *
 * Five components rendered `{p.handicap}` straight, so a member nobody has an
 * index for — `handicapSource: "none"`, written deliberately by `upsertMember`
 * for a club playing off association indexes — appeared as **0**. Which is a
 * scratch golfer. `handicap-policy.ts` opens by calling that outcome
 * catastrophic and exists to make it impossible.
 *
 * Fixing five files fixes five files. This is what stops the sixth: a sweep of
 * every component for the raw render, with `indexLabel` as the one way to turn
 * those fields into words.
 *
 * WHY A SOURCE SWEEP RATHER THAN A RENDER TEST. A render test proves one
 * screen behaves; it says nothing about a screen written next month. This repo
 * makes that argument about routes (`layout.spec` sweeps the filesystem rather
 * than a list) and it holds here for the same reason — the list is the thing
 * that goes stale.
 */

const COMPONENTS = join(process.cwd(), "src", "components");

/**
 * The shapes that print a handicap straight into the page.
 *
 * Deliberately narrow: `{x.handicap}` inside JSX, not every mention of the
 * word. A component may read `p.handicap` to sort a field, subtract two of
 * them, or pass one to an input's `defaultValue` — none of those is a label,
 * and flagging them would make this sweep noise somebody turns off.
 */
const RAW = [
  // Not after `=` (an attribute value) and not after `$` (a template literal).
  // Both were false positives on the first run: `defaultValue={p.handicap}` is
  // an input holding the number it edits, and `${res.handicap}` is a sentence
  // built in code. Neither is a label rendered from a player row.
  /(?<![=$])\{\s*[a-zA-Z_$][\w$]*\.handicap\s*\}/,
];

/**
 * THE ONES STILL TO DO, each with what it would take.
 *
 * Five screens were converted with this sweep — the roster, the field list,
 * the two pairing screens and score entry — and the sweep then found eight
 * more, which is exactly why it exists: fixing what you already knew about
 * fixes what you already knew about.
 *
 * They are listed rather than rushed. Every one needs `handicapSource` plumbed
 * from its own page, and a wrong guess about which row a component is showing
 * would hide a real handicap — the opposite mistake, made to the same
 * organizer. The sweep's value is already banked: nothing NEW can join this
 * list without somebody writing a line here saying why.
 */
const ALLOWED: Record<string, string> = {
  // EMPTY, AND THAT IS THE POINT. This list held eight screens the day it was
  // written — the flight board, the tee sheet a starter holds, the points
  // board, the league pair builder and four others — each with what it would
  // take to finish. They are all finished. The list stays because the next
  // screen to print a bare index has to come through here and say why.
  //
  // One entry, and it is the reason an allowlist beats a rule with no
  // exceptions: this one is not the same shape at all.
  "NewMatchForm.tsx":
    "A casual round's own picker, whose `handicap` is a STRING — '+2' for a plus-handicap, already formatted by the form that typed it. It is not a stored Player figure and has no source to ask about; a casual round belongs to a person, not a club playing off association indexes. Passing it to indexLabel is a type error, which is the type system making the same point.",
};

describe("nothing prints an index without asking whether there is one", () => {
  const files = readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx"));

  it("has components to search", () => {
    // The control: a sweep over nothing reports nothing wrong, loudly.
    expect(files.length).toBeGreaterThan(50);
  });

  const offenders: string[] = [];
  for (const file of files) {
    const body = readSource("src", "components", file);
    if (RAW.some((re) => re.test(body)) && !ALLOWED[file]) offenders.push(file);
  }

  it("finds no screen printing a bare handicap", () => {
    expect(
      offenders,
      "use indexLabel() from domain/handicap-label — a stored 0 with no claimed index is not a scratch golfer, and printing it as one is the failure handicap-policy.ts exists to prevent",
    ).toEqual([]);
  });

  it("can still see the shape it is looking for", () => {
    /**
     * The control that matters. A regex that matches nothing passes this file
     * for ever and proves nothing — the exact failure CLAUDE.md records three
     * sweeps having shipped with. So the pattern is run against the text it
     * was written for.
     */
    expect(RAW.some((re) => re.test("<span>{p.handicap}</span>"))).toBe(true);
    expect(RAW.some((re) => re.test("{p.name} (hcp {p.handicap})"))).toBe(true);
    // And does not fire on the legitimate uses it must leave alone.
    expect(RAW.some((re) => re.test("defaultValue={p.handicap}"))).toBe(false);
    expect(RAW.some((re) => re.test("sort((a, b) => a.handicap - b.handicap)"))).toBe(false);
  });
});
