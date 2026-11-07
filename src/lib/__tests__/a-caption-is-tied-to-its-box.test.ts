import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./source";

/**
 * A BARE CAPTION IS TIED TO NO BOX (J51, 2026-11-06).
 *
 * `<label>Course name</label>` followed by a sibling `<input>` looks like a
 * labelled box and is not one: with no `htmlFor` and no control inside it, the
 * words name nothing. A screen reader lands on "edit text" with no name, and
 * tapping the words does not focus the box. `a-caption-does-not-press-its-info-button`
 * is the opposite fault (a label that holds only a button); this is a label that
 * holds nothing.
 *
 * A RATCHET, not a ban: `KNOWN_BARE_CAPTIONS` is today's set (the screens are
 * fixed in their own pull requests, not here), and it may only SHRINK. A caption
 * written tomorrow fails here; a caption fixed tomorrow fails here too until its
 * line is deleted, so the list cannot go on claiming a fault that is gone.
 *
 * Tied means ANY of: `htmlFor`, an `id` (an `aria-labelledby` can point at it),
 * or a control (`input`, `select`, `textarea`) inside the label itself.
 */
const SRC = join(process.cwd(), "src");
const files = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : files(p);
    return p.endsWith(".tsx") ? [p] : [];
  });

const LABEL = /<label\b([^>]*)>((?:(?!<\/label>)[\s\S])*?)<\/label>/g;

/** The `<label>`s in one file's code that name no box. Pure, so the control can feed it a string. */
export function bareCaptions(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(LABEL)) {
    const attrs = m[1];
    const body = m[2];
    if (/\bhtmlFor\b/.test(attrs) || /\bid=/.test(attrs)) continue;
    if (/<input\b|<select\b|<textarea\b/.test(body)) continue;
    // The words only: tags dropped, each {expression} shown as an ellipsis, so a key is stable
    // under a restyle and readable in a diff.
    let words = body.replace(/<[^>]*>/g, " ");
    for (let i = 0; i < 4; i++) words = words.replace(/\{[^{}]*\}/g, "…");
    out.push(words.replace(/\s+/g, " ").trim().slice(0, 50));
  }
  return out;
}

function swept(): string[] {
  const keys: string[] = [];
  for (const f of files(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const seen = new Map<string, number>();
    for (const text of bareCaptions(stripComments(readFileSync(f, "utf8")))) {
      const n = (seen.get(text) ?? 0) + 1;
      seen.set(text, n);
      keys.push(`${rel} :: ${text}${n > 1 ? ` #${n}` : ""}`);
    }
  }
  return keys.sort();
}

/** Today's set. Delete a line the day its caption is tied; never add one. */
const KNOWN_BARE_CAPTIONS: string[] = [
  "app/(app)/group-games/page.tsx :: Round",
  "app/styleguide/page.tsx :: Format",
  "app/styleguide/page.tsx :: Notes",
  "app/styleguide/page.tsx :: Tournament name",
  "components/AccessClient.tsx :: Role",
  "components/CardImport.tsx :: City",
  "components/CardImport.tsx :: Course name",
  "components/CardImport.tsx :: Holes",
  "components/CardImport.tsx :: Where it came from — optional",
  "components/CardImport.tsx :: … …",
  "components/CoursePicker.tsx :: …",
  "components/CourseSearch.tsx :: Find a course",
  "components/CourseSetupPrompt.tsx :: City",
  "components/CourseSetupPrompt.tsx :: Course name",
  "components/CourseSetupPrompt.tsx :: Paste the card — the whole table is fine; rows are",
  "components/CourseSetupPrompt.tsx :: Your …&rsquo;s courses",
  "components/DraftAssistant.tsx :: Anything to mention? (optional)",
  "components/DraftAssistant.tsx :: What would you like drafted?",
  "components/EntryTermsCard.tsx :: Places",
  "components/EntryTermsCard.tsx :: When someone enters",
  "components/EventSetupClient.tsx :: Player count",
  "components/FoursomeMaker.tsx :: Group size",
  "components/GroupingControls.tsx :: Flight size",
  "components/GroupingControls.tsx :: …",
  "components/MatchKeeper.tsx :: By how much",
  "components/MoneyClient.tsx :: Split",
  "components/MoneyClient.tsx :: Split between",
  "components/NewMatchForm.tsx :: Are shots being given?",
  "components/NewMatchForm.tsx :: Handicap",
  "components/NewMatchForm.tsx :: How many holes?",
  "components/NewMatchForm.tsx :: Player … … … …",
  "components/NewMatchForm.tsx :: Playing for anything?",
  "components/NewMatchForm.tsx :: What for?",
  "components/NewMatchForm.tsx :: Who enters scores?",
  "components/OrganizationAccess.tsx :: Role",
  "components/OrganizationClient.tsx :: Name beside the logo",
  "components/PlaySettings.tsx :: Voice entry",
  "components/PlaySettings.tsx :: …",
  "components/RegistrationClient.tsx :: Handicap is a…",
  "components/RegistrationClient.tsx :: Handicap source",
  "components/ResetPasswordForm.tsx :: Confirm password",
  "components/ResetPasswordForm.tsx :: New password",
  "components/ScoreEntryClient.tsx :: Result (e.g. “3&2”, “1 UP”, “AS”)",
  "components/SideBetStart.tsx :: What to call it",
  "components/SkinsPotClient.tsx :: What to call it",
  "components/StrokePlayEntry.tsx :: Scoring",
  "components/VenuePrompt.tsx :: Address",
  "components/VenuePrompt.tsx :: City",
  "components/VenuePrompt.tsx :: Golf course",
  "components/VenuePrompt.tsx :: Par",
  "components/VenuePrompt.tsx :: Paste the card, a row at a time",
  "components/VenuePrompt.tsx :: Rating",
  "components/VenuePrompt.tsx :: Slope",
  "components/VenuePrompt.tsx :: Tees",
  "components/VenuePrompt.tsx :: Which nine?",
  "components/VenuePrompt.tsx :: … …",
];

describe("a caption names its box", () => {
  it("no caption is added to the set that is tied to nothing", () => {
    const known = new Set(KNOWN_BARE_CAPTIONS);
    const added = swept().filter((k) => !known.has(k));
    expect(added, `new bare captions (tie each with htmlFor + id):\n${added.join("\n")}`).toEqual([]);
  });

  it("the set only shrinks: a caption that has been tied is struck off the list", () => {
    const now = new Set(swept());
    const gone = KNOWN_BARE_CAPTIONS.filter((k) => !now.has(k));
    expect(gone, `tied now, delete from KNOWN_BARE_CAPTIONS:\n${gone.join("\n")}`).toEqual([]);
  });

  it("CONTROL: the sweep sees a bare caption, and not a tied one", () => {
    const bare = '<div className="field"><label>Course name</label><input className="input" /></div>';
    expect(bareCaptions(bare)).toEqual(["Course name"]);
    expect(bareCaptions('<label htmlFor="n">Course name</label><input id="n" />')).toEqual([]);
    expect(bareCaptions('<label>Course name <input className="input" /></label>')).toEqual([]);
    expect(bareCaptions('<label id="cap">Holes</label><div role="radiogroup" aria-labelledby="cap" />')).toEqual([]);
  });

  it("CONTROL: the sweep reads files at all (a sweep of nothing reports nothing)", () => {
    expect(files(SRC).length).toBeGreaterThan(100);
    expect(swept().length).toBeGreaterThan(0);
  });
});
