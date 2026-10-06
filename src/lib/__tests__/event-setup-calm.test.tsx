import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaySettings } from "@/components/PlaySettings";
import { SetupChecklist } from "@/components/SetupChecklist";
import { TeeEditor, PlaysExplainer } from "@/components/TeeEditor";
import { cleanSettings } from "@/lib/tournament-settings";

/**
 * EVENT SETUP, SAID SHORT — step B of the organizer cleanup Ajay approved on
 * 2026-10-05. Read off the real screen first: about twenty-five long sentences,
 * sixteen of them the explanations under each radio option in Players &
 * scoring; the full setup checklist on a tournament already launched; and two
 * paragraphs on tees under Courses.
 *
 * Nothing is removed. Every explanation stays in the page, one tap away — so
 * every assertion elsewhere that a sentence EXISTS still holds — and each test
 * here also checks the words are still there.
 */

const settings = (over: Record<string, string> = {}) =>
  renderToStaticMarkup(
    <PlaySettings
      mode="tournament"
      settings={cleanSettings(over)}
      canEdit
      shareToken="zz-token"
      rounds={[{ stageId: "r1", label: "Round 1", code: "" }]}
    />,
  );

describe("each radio option is its name, its explanation an ⓘ away", () => {
  /**
   * Through `FieldInfo`, the app's existing "why does this field work like
   * that" control — tap to open, named "More about X", a 44px target — rather
   * than a second way of doing the same thing. Its panel is drawn on tap, so
   * the words being REACHABLE is walked in `e2e/event-setup-calm.spec.ts`;
   * `settings-explained.test.ts` still requires every option's explanation to
   * be passed to the control.
   */
  const html = settings();

  it("no longer prints the explanation under every option", () => {
    expect(html).not.toContain("A blind event");
    expect(html).toContain("Organizers only");
  });

  it("gives an explained option an ⓘ named for it, closed", () => {
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-label="More about Organizers only"|aria-label="More about Organizers only"[^>]*aria-expanded="false"/);
  });

  it("an ⓘ for every option, across the whole screen", () => {
    // Every option on this screen is explained (`settings-explained`), so no
    // option may be left without its ⓘ. A label's own hint adds one more —
    // "Who enters scores" carries one — so this is at least, not exactly.
    const buttons = (html.match(/aria-label="More about /g) ?? []).length;
    const radios = (html.match(/type="radio"/g) ?? []).length;
    expect(radios).toBeGreaterThan(0);
    expect(buttons).toBeGreaterThanOrEqual(radios);
    expect(html).toContain('aria-label="More about Who enters scores"');
  });
});

describe("weekly sign-up is asked where there is a next week", () => {
  const withRounds = (n: number, over: Record<string, string> = {}) =>
    renderToStaticMarkup(
      <PlaySettings
        mode="tournament"
        settings={cleanSettings(over)}
        canEdit
        shareToken="zz-token"
        rounds={Array.from({ length: n }, (_, i) => ({ stageId: `r${i}`, label: `Round ${i + 1}`, code: "" }))}
      />,
    );

  it("is not asked of a single-round tournament", () => {
    expect(withRounds(1)).not.toContain("Weekly sign-up");
  });

  it("is asked where there is more than one round", () => {
    expect(withRounds(2)).toContain("Weekly sign-up");
  });

  it("stays in view wherever it has been changed — a setting in force is never hidden", () => {
    expect(withRounds(1, { attendanceMode: "opt-in" })).toContain("Weekly sign-up");
  });

  it("is unchanged on the club's defaults", () => {
    const org = renderToStaticMarkup(<PlaySettings mode="organization" settings={cleanSettings({})} canEdit />);
    expect(org).toContain("Weekly sign-up");
  });
});

describe("a launched tournament's checklist folds to one line", () => {
  const items = [
    { label: "Tournament details", detail: "Named", done: true, href: "/event" },
    { label: "Flights", detail: "No flights yet", done: false, href: "/flights" },
    { label: "Access & staff", detail: "1 staff", done: true, href: "/access", optional: true },
  ];

  it("says how much is done, in one line, with the rows a tap away", () => {
    const html = renderToStaticMarkup(<SetupChecklist items={items} folded />);
    expect(html).toMatch(/<details/);
    expect(html).toContain("Setup checklist · 2 of 3 done");
    expect(html).toContain("No flights yet");
  });

  it("is unchanged where it is not folded — the control", () => {
    const html = renderToStaticMarkup(<SetupChecklist items={items} />);
    expect(html).not.toMatch(/<details/);
    expect(html).toContain("Setup checklist");
  });
});

describe("the tee explanations are a short line each", () => {
  it("says what no tees means in a line, the reason an ⓘ away", () => {
    const html = renderToStaticMarkup(<TeeEditor courseId="c1" tees={[]} canEdit />);
    expect(html).toMatch(/<summary[\s\S]*No tees yet[\s\S]*<\/summary>/);
    expect(html).toContain("raw handicap index");
  });

  it("names the 14.0 plays column in a line, the working an ⓘ away", () => {
    const html = renderToStaticMarkup(<PlaysExplainer />);
    expect(html).toMatch(/<summary[\s\S]*14\.0 plays[\s\S]*<\/summary>/);
    expect(html).toContain("rating, slope and par");
  });
});
