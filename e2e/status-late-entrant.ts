import { expect, type Page } from "@playwright/test";
import { prisma, type StatusFixture } from "./status-fixture";

/**
 * THE LATE-ENTRANT STEP OF THE STATE MACHINE'S FAMILY WALKS (J13, PR 9c): the
 * organizer opens Entries of a tournament that is under way and types a name
 * into the Add form, as a person does — then each family's ruled answer is read
 * where the press is. The answers are `fieldChangeAllowed`'s (`field-change.ts`),
 * worked per family there and written out in each spec as a sentence, never
 * imported, so a reworded refusal is a red step and not a silent pass.
 *
 * A refusal is read in words at the dead button, with its way out; a taken entry
 * is read as a row on the field. Each name is the spec's own and the address is
 * the fixture's mark, `@example.invalid`.
 */

/** Entries, loaded and settled. */
export async function openEntries(page: Page): Promise<void> {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
}

/** The Add form filled the way an organizer fills it: a name and the fixture's own address. */
export async function fillLateEntrant(page: Page, f: StatusFixture, name: string): Promise<void> {
  await page.getByLabel("Player name").fill(name);
  // The Add form's own box ("Email · …"), not a row's "Email for …".
  await page.getByLabel(/^Email ·/).fill(`${f.mark}-late@example.invalid`);
}

/**
 * The late entry REFUSED: the Add button is dead, the rule's sentence is said under it (with
 * its way out inside the sentence), and nothing was written. Returns with the form still filled,
 * so a spec can go on to press the way out (a knockout's reserve).
 */
export async function expectLateEntryRefused(page: Page, f: StatusFixture, name: string, says: string): Promise<void> {
  await openEntries(page);
  await fillLateEntrant(page, f, name);
  await expect(page.getByRole("button", { name: "Add late entry" }), `${name}: a late entry is offered where the rule refuses it`).toBeDisabled();
  // Read INSIDE the Add form (the card holding its button): the Entries banner above says the same
  // sentence for a family the rule refuses outright, so a page-wide read would pass without the form's own line.
  const form = page.locator(".card").filter({ has: page.getByRole("button", { name: "Add late entry" }) });
  await expect(form.getByText(says, { exact: false }).first(), `${name}: the refusal is not said where the press is`).toBeVisible();
  expect(await prisma.player.count({ where: { eventId: f.eventId, name } }), `${name}: a refused add wrote a row`).toBe(0);
}
