import { expect, type Locator } from "@playwright/test";

/**
 * Choose a radio the way a person does: press its label, then see it chosen.
 *
 * The app draws most radios invisible (`.seg-opt input`, `.radio input`:
 * opacity 0, no size). Playwright's `.check()` waits for a visible input, so on
 * an option that is NOT yet chosen it waits for ever, and on one that already is
 * it returns at once and proves nothing. Press the label, then `toBeChecked()`.
 * `src/lib/__tests__/seg-opt-radios-are-pressed-not-checked.test.ts` refuses
 * `.check()` on a radio.
 */
export async function pressRadio(radio: Locator): Promise<void> {
  const label = radio.locator("xpath=ancestor::label[1]");
  if (await label.count()) await label.click();
  else await radio.click({ force: true });
  await expect(radio).toBeChecked();
}
