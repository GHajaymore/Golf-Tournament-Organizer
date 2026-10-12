import type { Page } from "@playwright/test";

/**
 * LABELS THAT BELONG TO THE WRONG THING (2026-10-11).
 *
 * A `<label>` wrapped round a whole field belongs to the FIRST control inside
 * it. On the log-in form that was the "Forgot?" button, not the password box:
 * tapping the word "Password" opened "Reset your password", the box had no
 * label, and the button had no name a screen reader could find.
 *
 * Nothing about that is visible in a screenshot, and no assertion about text
 * can see it. So this asks the browser, which knows: every label on the page
 * that holds a box to type or choose in, and is nonetheless the label of a
 * button.
 *
 * Returns the labels' own words, for saying which.
 */
export async function labelsForTheWrongThing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("label"))
      .filter((label) => {
        const control = (label as HTMLLabelElement).control;
        return !!control && control.tagName === "BUTTON" && !!label.querySelector("input, select, textarea");
      })
      .map((label) => (label.textContent ?? "").split("\n").join(" ").trim().slice(0, 40)),
  );
}
