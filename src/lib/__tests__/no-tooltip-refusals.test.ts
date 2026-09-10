import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { stripComments } from "./source";

/**
 * No control may explain itself only in a tooltip.
 *
 * This codebase has rejected the pattern four times in writing — in
 * `drawReadiness`, in `GroupingControls`, in the 2026-08-18 session record and
 * in the pass that added the first version of this file — and kept shipping it
 * anyway, because rejecting it in a comment stops nobody. A `title` never
 * appears on a touch device, is not announced reliably, and cannot hold a link,
 * so a control that is off with its reason in a `title` is a control that is
 * off for no reason as far as the organizer can tell.
 *
 * SWEPT FROM THE FILESYSTEM, not from a list, for the same reason
 * `e2e/layout.spec.ts` is: a hand-written list covers what its author
 * remembered.
 *
 * ## Why this was rewritten
 *
 * The first version matched `title={…?…}` and required the literal
 * `undefined`. Review found it closed one door of three:
 *
 *   1. `title={blocked ? "…" : ""}` — the same defect, no `undefined`, passed.
 *   2. A STATIC explanatory title was never examined at all. Six survived,
 *      one of them two lines above the very tooltip the sweep replaced.
 *   3. `[^{}]*` cannot cross nested braces, so a conditional title holding a
 *      template literal was invisible to it.
 *
 * A guard with holes is worse than no guard: it reads as settled.
 *
 * ## What counts as an explanation
 *
 * A NAME is what the control is called — "Edit", "Pin", "Unpin", "Copy". Those
 * are fine and stay: the icon beside them carries the same meaning, and on an
 * icon-only button the `title` is doing accessible-name duty.
 *
 * An EXPLANATION is a sentence about what will happen, why something is off,
 * or what a value means. That belongs on the page. The heuristic is length —
 * names are one or two words, explanations are clauses — plus the presence of
 * a conditional with a silent branch, which is the shape of "…and here is why
 * you cannot".
 */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const ROOTS = ["components", "app"].map((d) => join(process.cwd(), "src", d).split("/").join(sep));
const FILES = ROOTS.flatMap(tsxFiles);

interface TitleAttr {
  /** The attribute value's source, without the wrapping braces or quotes. */
  raw: string;
  /** `{…}` expression rather than a `"…"` literal. */
  expression: boolean;
}

/**
 * Every `title=` attribute in a file, with braces balanced properly.
 *
 * Hand-scanned rather than regexed because a JSX expression can contain
 * braces — a template literal, a nested ternary, an object style — and the
 * regex that could not cross them was the third hole in the first version.
 */
function titleAttrs(source: string): TitleAttr[] {
  const out: TitleAttr[] = [];
  const re = /\btitle=(\{|")/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // Only a real HTML `title` ATTRIBUTE is a tooltip. `title` is also an
    // ordinary React prop — `<SettingsGroup title="What this round decides">`
    // renders a heading, not a hover — and a sweep that cannot tell them apart
    // reports the app's own section titles as defects. JSX settles it: a
    // lowercase tag is an element, a capitalised one is a component.
    const open = source.lastIndexOf("<", m.index);
    const tag = open === -1 ? "" : (source.slice(open + 1, open + 40).match(/^[A-Za-z][\w.-]*/) ?? [""])[0];
    if (!tag || !/^[a-z]/.test(tag)) continue;
    const start = m.index + m[0].length;
    if (m[1] === '"') {
      const end = source.indexOf('"', start);
      if (end === -1) continue;
      out.push({ raw: source.slice(start, end), expression: false });
      continue;
    }
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
    }
    out.push({ raw: source.slice(start, i - 1), expression: true });
  }
  return out;
}

/** One to three words is a name; a clause is an explanation. */
const MAX_NAME_WORDS = 3;

function isExplanation(attr: TitleAttr): boolean {
  if (attr.expression) {
    // A conditional whose other branch says NOTHING is the classic
    // explanation-when-blocked. Both branches speaking is a two-state name.
    const conditional = attr.raw.includes("?");
    const silentBranch = /:\s*(undefined|""|''|``)\s*$/.test(attr.raw.trim()) || /\bundefined\b/.test(attr.raw);
    return conditional && silentBranch;
  }
  return attr.raw.trim().split(/\s+/).length > MAX_NAME_WORDS;
}

/**
 * Deliberate exceptions, each with the reason it is not a page-level message.
 *
 * Keyed by a distinctive fragment. Anything NOT here has to be fixed rather
 * than added — the point of the list is that adding to it is a visible
 * decision somebody has to justify in the diff.
 */
const ALLOWED: Array<{ fragment: string; because: string }> = [
  {
    fragment: "Replace this link — the old one stops working",
    because:
      "The consequence is also in the window.confirm() this button opens, which is modal and unmissable. The tooltip only previews a message the organizer cannot avoid reading.",
  },
  {
    fragment: "Bring in a whole round from a spreadsheet",
    because:
      "Elaboration of a button that already reads 'Import scores' in visible text. Nothing is withheld from somebody who cannot see it — the visible label alone says what the control does.",
  },
  {
    fragment: "Remove this round's scores without touching the draw",
    because:
      "Elaboration of a visibly labelled button, the same shape as the import control beside it. The label carries the action; the title adds detail.",
  },
  {
    fragment: "Use my current location",
    because:
      "A NAME for the action, not a reason — it is over the word threshold only because the action needs four words to say. Nothing is explained here that the button does not do.",
  },
];

/**
 * Known debt: real instances of the pattern, recorded rather than fixed.
 *
 * The rule was written to stop NEW ones. Rewriting the guard to catch all
 * three spellings turned up fourteen existing tooltips, and fixing every one
 * is a screen-by-screen UI job — it belongs to the simplification pass, which
 * has these in its queue, not to a test rewrite that would be changing screens
 * nobody had looked at.
 *
 * So the debt is frozen instead. This list may SHRINK and never grow: a fixed
 * tooltip must be deleted from here (the stale-entry test enforces it), and a
 * new one has nowhere to go but a failure.
 *
 * Do not move an entry to ALLOWED to make a build pass. ALLOWED is for
 * tooltips that are genuinely not the only place the information lives; these
 * are ones where it is.
 */
const KNOWN_DEBT: string[] = [
  // Two entries left here on 2026-09-07, PAID rather than reworded. Both sat
  // on a Remove button whose tooltip carried the reassurance that decides the
  // answer. Both are now `ConfirmButton` notes — visible text beside the armed
  // confirm, which is the moment somebody is deciding, and readable on the
  // phone the button is being tapped on.
  //
  // The remaining SEVEN were paid on 2026-09-10, which is what this list is
  // for. They fell into two kinds, and the difference decided the fix:
  //
  //   the tooltip repeated what was already on screen — "Plays off 12" IS the
  //   playing handicap, "invited" IS the state, "Entered by Ann · 12 Jun" IS
  //   who and when. Deleted; nothing was lost by anybody.
  //
  //   the tooltip was the ONLY carrier — a bare "Blue" that did not say it was
  //   a tee, a "14.0 plays" column, a "via club" tag, and a season table's
  //   em-dash whose title held the whole `minEvents` rule. Those moved onto
  //   the page: a word in the visible text, or one line under the table.
  //
  // The em-dash was the worst of them. A member not ranked in their society's
  // season saw "—" and, on a phone, had no way to find out why.
  //
  // The list is now empty and the freeze below is 0. A new tooltip has nowhere
  // to go but a failure, which is what the guard was written for.
];

describe("no control explains itself only in a tooltip", () => {
  it("swept some files at all, so an empty sweep cannot pass vacuously", () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.some((f) => f.endsWith(`components${sep}TeamsClient.tsx`))).toBe(true);
  });

  it("finds title attributes at all, including ones with nested braces", () => {
    // Guards the scanner. If titleAttrs silently returned nothing, the sweep
    // below would pass while reading no attributes at all.
    const found = FILES.flatMap((f) => titleAttrs(stripComments(readFileSync(f, "utf8"))));
    expect(found.length).toBeGreaterThan(5);
    const sample = titleAttrs("<a title={x ? `Checked by ${y}` : undefined} />");
    expect(sample).toHaveLength(1);
    expect(sample[0].raw).toContain("Checked by");
    expect(sample[0].raw).toContain("undefined");
  });

  it("adds no NEW control whose explanation lives only in a title", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const attr of titleAttrs(stripComments(readFileSync(file, "utf8")))) {
        if (!isExplanation(attr)) continue;
        if (ALLOWED.some((a) => attr.raw.includes(a.fragment))) continue;
        if (KNOWN_DEBT.some((d) => attr.raw.includes(d))) continue;
        offenders.push(`${file.split(sep).slice(-2).join("/")}: title=${attr.raw.trim().slice(0, 80)}`);
      }
    }
    expect(
      offenders,
      "A control's reason belongs on the page, not in a tooltip — see drawReadiness.\n" +
        "Put the reason on the page. If the tooltip is genuinely not the only place\n" +
        "the information lives, add it to ALLOWED with that reason. Do NOT add to\n" +
        "KNOWN_DEBT — that list is frozen and may only shrink.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("keeps the known debt from growing", () => {
    /**
     * Frozen at the count found when the guard was rewritten, and lowered
     * every time one was paid — nine, then seven, and zero on 2026-09-10.
     *
     * AT ZERO THIS IS NO LONGER A FREEZE BUT A FLOOR. There is no debt left to
     * grandfather, so the only way to add an entry is to raise this number in
     * the same diff, which is the visible decision the list exists to force.
     */
    expect(KNOWN_DEBT.length).toBe(0);
  });

  it("catches every spelling of the blocked-reason tooltip", () => {
    // The three holes the first version had, asserted so they cannot reopen.
    const undef = { raw: 'blocked ? "Draw at least two sides first" : undefined', expression: true };
    const empty = { raw: 'blocked ? "Draw at least two sides first" : ""', expression: true };
    const nested = { raw: "x ? `Blocked because ${why}` : undefined", expression: true };
    for (const a of [undef, empty, nested]) expect(isExplanation(a), a.raw).toBe(true);
  });

  it("catches a static sentence, which the first version never examined", () => {
    expect(
      isExplanation({ raw: "Whether this handicap index is a 9-hole or 18-hole index", expression: false }),
    ).toBe(true);
  });

  it("still allows a two-state name and a short static one", () => {
    // Guards the rule against over-tightening: if every conditional title were
    // banned, "Pin"/"Unpin" would fail and somebody would delete the test
    // rather than the tooltip.
    expect(isExplanation({ raw: 'a.pinned ? "Unpin" : "Pin"', expression: true })).toBe(false);
    expect(isExplanation({ raw: "Edit", expression: false })).toBe(false);
    expect(isExplanation({ raw: "Copy link", expression: false })).toBe(false);
  });

  it("gives every allowlisted exception a reason", () => {
    // An allowlist without reasons becomes a place to hide things.
    for (const a of ALLOWED) expect(a.because.length, a.fragment).toBeGreaterThan(40);
  });

  it("has no stale allowlist or debt entry", () => {
    // An entry matching nothing means the tooltip was fixed and the exception
    // outlived it — which would quietly permit a future one using those words,
    // and would let the debt count stop reflecting reality.
    const all = FILES.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
    for (const a of ALLOWED) {
      expect(all.includes(a.fragment), `stale ALLOWED entry: ${a.fragment}`).toBe(true);
    }
    for (const d of KNOWN_DEBT) {
      expect(all.includes(d), `fixed — delete from KNOWN_DEBT: ${d}`).toBe(true);
    }
  });
});
