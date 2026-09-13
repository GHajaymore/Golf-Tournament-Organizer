import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A SENTENCE ABOUT THE LIST BELONGS TO THE LIST, NOT TO EVERY ROW OF IT.
 *
 * Found by sweeping every route's rendered HTML for text appearing more than
 * once on one screen, rather than one screen at a time. Most of what that
 * turned up was legitimate — two colour grids offering the same presets, a
 * format dropdown repeated per round — and two were not:
 *
 *   `/me/money`  "— ask them or an organizer to change it." SIX times, once
 *                under every expense line the viewer had not entered. Every
 *                `<details>` on that screen is `open`, so all six were on the
 *                page at once.
 *
 *   `/event`     the "14.0 plays" explainer THREE times, once under each
 *                course's tee table. `CourseLibrary` renders a `TeeEditor` per
 *                course, so a club with a dozen venues printed a dozen copies.
 *
 * Both are the same shape as the deadline sentence that appeared three times
 * on Registration & field: a rule that governs the whole list, attached to
 * each row of it. The per-row half that genuinely VARIES stays — "Entered by
 * Alex Rourke" identifies somebody and is different every time.
 *
 * These assert the arrangement rather than a count of rendered text, because
 * the count depends on how many courses a club has and how many lines are on
 * a trip. What has to hold is WHERE the sentence lives.
 */

describe("the money screen's editing rule", () => {
  const client = () => readSource("src", "components", "MoneyClient.tsx");

  it("is stated once, outside the per-expense loop", () => {
    const src = client();
    const loopStart = src.indexOf("view.expenses.map((e) =>");
    const loopEnd = src.indexOf("</details>", loopStart);
    expect(loopStart, "the expense list is gone").toBeGreaterThan(-1);

    const advice = src.indexOf("ask whoever entered it or");
    expect(advice, "the advice is gone").toBeGreaterThan(-1);
    expect(advice, "the advice is back inside the row").toBeGreaterThan(loopEnd);
  });

  it("still names who entered each line, which is the part that varies", () => {
    /**
     * THE CONTROL. Deleting the whole sentence would pass the test above and
     * lose the only thing on the row that identifies anybody — a player
     * looking at a bill they cannot change would have no idea who to ask.
     */
    const src = client();
    const loopStart = src.indexOf("view.expenses.map((e) =>");
    const row = src.slice(loopStart, src.indexOf("</details>", loopStart));
    expect(row).toContain("Entered by {e.createdBy");
  });

  it("says nothing at all to somebody who entered every line", () => {
    // Advice about lines you cannot change, on a screen where you can change
    // all of them, is furniture.
    expect(client()).toContain("view.expenses.some((e) => !e.canEdit)");
  });

  it("no longer carries the old per-row wording", () => {
    // Read through `readSource`, which strips comments — the note explaining
    // the change quotes the old sentence and would otherwise satisfy a search
    // for its absence.
    expect(client()).not.toContain("ask them or an organizer to change it");
  });
});

describe("the course library's tee explainer", () => {
  it("is rendered by the list, not by each table in it", () => {
    /**
     * `TeeEditor` is rendered once per course. The column it explains is the
     * same on every one of those tables, so one explanation covers all of them
     * — and the place that knows how many tables there are is the list.
     */
    const editor = readSource("src", "components", "TeeEditor.tsx");
    const library = readSource("src", "components", "CourseLibrary.tsx");

    /**
     * Scoped to the TeeEditor function itself. The sentence still LIVES in
     * this file — `PlaysExplainer` is exported from it, deliberately, so the
     * column heading and its explanation cannot drift apart — so a whole-file
     * search would be asserting the opposite of what is wanted.
     */
    const perCourse = editor.slice(0, editor.indexOf("export function PlaysExplainer"));
    expect(perCourse, "the explainer is back inside the per-course editor").not.toContain(
      "is the course handicap a 14.0 index",
    );
    expect(library).toContain("<PlaysExplainer />");
    expect(library.split("<PlaysExplainer />").length - 1, "rendered more than once").toBe(1);
  });

  it("keeps the words in one place, beside the column they describe", () => {
    // Exported from the file that owns the table rather than copied into the
    // list, so the heading and its explanation cannot drift apart.
    const editor = readSource("src", "components", "TeeEditor.tsx");
    expect(editor).toContain("export function PlaysExplainer");
    expect(editor).toContain("is the course handicap a 14.0 index");
    // And the column it explains is still there to be explained.
    expect(editor).toContain("14.0 plays");
  });

  it("is rendered outside the course loop", () => {
    const library = readSource("src", "components", "CourseLibrary.tsx");
    const teeEditor = library.indexOf("<TeeEditor");
    const explainer = library.indexOf("<PlaysExplainer />");
    expect(teeEditor).toBeGreaterThan(-1);
    expect(explainer, "the explainer moved back into the per-course row").toBeGreaterThan(teeEditor);
    // After the table closes, which is what puts it under the whole library.
    expect(explainer).toBeGreaterThan(library.indexOf("</tbody>"));
  });
});
