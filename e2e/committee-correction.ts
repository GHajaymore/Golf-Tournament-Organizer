import type { Page } from "@playwright/test";

/**
 * OPEN A COMMITTEE CORRECTION as the Organizer would (state machine PR 5b; TD
 * Q2): press the banner's or the dashboard's button, say why, open it. It
 * replaces the one-press "Unlock setup" the specs used to make. `scope` picks
 * the part when the dialog offers more than one (the dashboard); a banner
 * preselects its own.
 */
export const CORRECTION_REASON = "zz spec: correcting a setup mistake";

export async function makeCommitteeCorrection(page: Page, opts: { scope?: string; reason?: string } = {}): Promise<void> {
  await page.getByRole("button", { name: "Make a committee correction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Make a committee correction" });
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  if (opts.scope) await dialog.getByLabel("Open which part").selectOption({ label: opts.scope });
  await dialog.getByLabel("Why").fill(opts.reason ?? CORRECTION_REASON);
  await dialog.getByRole("button", { name: "Open it for a correction" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
}
