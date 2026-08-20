import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * No control may explain itself only in a tooltip.
 *
 * This codebase has rejected the pattern three times in writing — in
 * `drawReadiness`, in `GroupingControls`, and in the 2026-08-18 session record —
 * and kept shipping it anyway, because rejecting it in a comment stops nobody.
 * A `title` never appears on a touch device, is not announced reliably, and
 * cannot hold a link, so a control that is off with its reason in a `title` is
 * a control that is off for no reason as far as the organizer can tell.
 *
 * SWEPT FROM THE FILESYSTEM, not from a list, for the same reason
 * `e2e/layout.spec.ts` is: a hand-written list covers what its author
 * remembered. Four instances were found the day this was written, in
 * CutControl, FoursomeMaker (twice), TeamsClient and RegistrationClient — the
 * last of which had already been flagged and parked.
 *
 * ## What it catches, and what it deliberately does not
 *
 * The signature is a CONDITIONAL title with an `undefined` branch:
 *
 *     title={blocked ? "Draw at least two sides first" : undefined}
 *     title={p.email ? undefined : "No email on file…"}
 *
 * One branch says something and the other says nothing, which is what an
 * explanation-when-blocked looks like. That is different from a two-state
 * NAME, which is fine and stays:
 *
 *     title={a.pinned ? "Unpin" : "Pin"}
 *
 * A name is not an explanation — it is what the control is called, and the
 * icon beside it carries the same meaning. A plain static `title="Edit"` is
 * the same thing and is also untouched.
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

/** `title={ … ? … : … }`, with the braces balanced well enough for JSX. */
const CONDITIONAL_TITLE = /title=\{[^{}]*\?[^{}]*\}/g;

describe("no control explains itself only in a tooltip", () => {
  it("swept some files at all, so an empty sweep cannot pass vacuously", () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.some((f) => f.endsWith(`components${sep}TeamsClient.tsx`))).toBe(true);
  });

  it("has no conditional title with an undefined branch", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.match(CONDITIONAL_TITLE) ?? []) {
        // Both branches say something → it is a two-state name, which is fine.
        if (!/\bundefined\b/.test(match)) continue;
        offenders.push(`${file.split(sep).slice(-2).join("/")}: ${match.trim()}`);
      }
    }
    expect(
      offenders,
      `A disabled control's reason belongs on the page, not in a tooltip — see drawReadiness.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("still allows a two-state name, which is not an explanation", () => {
    // Guards the rule itself: if the regex were tightened to ban every
    // conditional title, "Pin" / "Unpin" would fail and somebody would delete
    // the test rather than the tooltip.
    const name = 'title={a.pinned ? "Unpin" : "Pin"}';
    const reason = 'title={blocked ? "Draw at least two sides first" : undefined}';
    expect(name.match(CONDITIONAL_TITLE)?.[0]).toBeTruthy();
    expect(/\bundefined\b/.test(name)).toBe(false);
    expect(/\bundefined\b/.test(reason)).toBe(true);
  });
});
