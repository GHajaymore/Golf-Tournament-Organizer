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

/**
 * EVERY SECTION BEHIND A TAB, OPENED IN TURN, FOR A CHECK THAT ONLY SEES WHAT
 * IS ON THE SCREEN.
 *
 * axe skips a hidden element and a hidden element has no box, so the
 * accessibility audit and the touch-size sweep saw the first section of Club
 * settings and nothing behind its other tabs: every control in six of its
 * seven sections was audited by neither. This opens each tab that is not
 * already open, the way a person does — a tap, then the tab reads as chosen and
 * its section is on the screen — and hands `look` the section's name, so a
 * check can file what it finds under `${path}#${section}`, each section its
 * own screen.
 *
 * Any screen, not one: it reads the tabs off the page. Only a tab that names
 * the section it shows (`aria-controls`) is walked — that is a tab with
 * content hidden behind it. The landing's tabs name none: the sign-in form's
 * two swap one form in place, and "The week, by time" is a picture.
 *
 * Returns how many sections were opened, so a caller can say it saw some.
 */
export async function eachOtherSection(page: Page, look: (section: string) => Promise<void>): Promise<number> {
  const tabs = page.locator('main [role="tab"][aria-controls]');
  const controls = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("aria-controls") ?? ""));
  let opened = 0;
  for (const id of controls) {
    expect(id, "a tab names an empty section").not.toBe("");
    const tab = page.locator(`main [role="tab"][aria-controls="${id}"]`);
    if ((await tab.getAttribute("aria-selected")) === "true") continue;
    await tab.click();
    await expect(tab, `the tab for "${id}" did not open`).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`[id="${id}"]`), `the "${id}" section is not on the screen`).toBeVisible();
    await look(id);
    opened += 1;
  }
  return opened;
}
