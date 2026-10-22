import { expect, type Page } from "./coverage";

/**
 * OPEN ONE SECTION OF CLUB SETTINGS, THE WAY A PERSON DOES: BY ITS TAB.
 *
 * Club settings shows one section at a time since 2026-10-21 (`SettingsTabs`).
 * A control in a section that is not open is in the page and not on the
 * screen, so a spec that presses one has to open its tab first — by tapping
 * it, not by going to `/organization#money`, because the tap is the door
 * people use and the one that has to work.
 *
 * Named by the start of the tab's label: a tab with something waiting reads
 * "Staff & access (2 waiting)" to a screen reader.
 */
export async function openSettingsTab(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tab = page.locator("main").getByRole("tab", { name: new RegExp(`^${escaped}\\b`) });
  await expect(tab, `Club settings has no "${label}" tab`).toHaveCount(1);
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab, `the "${label}" tab did not open`).toHaveAttribute("aria-selected", "true");
  const panel = page.locator(`[id="${await tab.getAttribute("aria-controls")}"]`);
  await expect(panel, `the "${label}" section is not on the screen`).toBeVisible();
  return panel;
}
