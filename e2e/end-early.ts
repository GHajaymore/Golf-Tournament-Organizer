import type { Locator, Page } from "@playwright/test";
import { expect } from "./coverage";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

/**
 * COMPLETING, THE WAY AN ORGANIZER NOW DOES IT (the panel, 9 Nov; the PM, 10 Nov).
 *
 * The dashboard's status card presses the tournament's one job (`tournamentJob`). "Complete tournament"
 * is its button only once play is over; while golf remains to be played — before the first card, with
 * cards out, between rounds — ending is a deliberately named action behind the card's quiet "More":
 * "End this event early…", which asks first and names the round nobody played. A spec that completes
 * goes through whichever the card offers at that moment, as a person would; a spec that only wanted to
 * know the launch went through reads the card's chip.
 */

/** The dashboard's status card (`LifecycleBar`). */
export function statusCard(page: Page): Locator {
  return page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: "Tournament status" }) });
}

/** Launched: the status card's chip says Live (it used to be read off a Complete button that is no longer there). */
export async function expectLaunched(page: Page): Promise<void> {
  await expect(statusCard(page).locator(".tag").first(), "the tournament is not live").toHaveText(/^Live/, { timeout: 30_000 });
}

/**
 * The control that completes the tournament now: the card's "Complete tournament" once play is over, or
 * "End this event early…" from its More while golf remains — pressable or refused in place.
 */
export async function completeControl(page: Page): Promise<Locator> {
  const card = statusCard(page);
  const complete = card.getByRole("button", { name: "Complete tournament" });
  // "More actions", exactly: the card's explanations (`MoreInfo`) are buttons named "More".
  const more = card.getByRole("button", { name: "More actions", exact: true });
  // Every card in and the last round still open: the job is closing it, and nothing ends the event
  // until it is — the dashboard's "ready to close" card does it, then Complete is the button.
  const ready = page.getByRole("region", { name: "The round is ready to close" });
  await expect(complete.or(more).or(ready).first(), "the dashboard offers neither Complete, More nor a round to close").toBeVisible({ timeout: 30_000 });
  if ((await complete.count()) > 0) return complete.first();
  if ((await more.count()) > 0) {
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    const early = card.getByRole("button", { name: END_EARLY });
    await expect(early).toBeVisible();
    return early;
  }
  await ready.getByRole("button", { name: /^Close / }).first().click();
  await ready.getByRole("button", { name: /Close the round/ }).click();
  await expect(complete.first(), "closing the last round did not make Complete the button").toBeVisible({ timeout: 30_000 });
  return complete.first();
}

/** Press it. The confirmations that follow are the same either way. */
export async function pressComplete(page: Page): Promise<void> {
  const control = await completeControl(page);
  await control.scrollIntoViewIfNeeded();
  await control.click();
}

/**
 * REOPENING, AS AN ORGANIZER DOES IT: the completed tournament's status card offers "Reopen
 * tournament", which asks first ("The boards stop reading Final…") and reopens on the second press.
 * Opens the dashboard itself; the caller then reads the status back (`f.status`) before the screens.
 */
export async function pressReopen(page: Page): Promise<void> {
  await page.goto(`/dashboard?bust=${Date.now()}`);
  const reopen = statusCard(page).getByRole("button", { name: "Reopen tournament" });
  await expect(reopen, "a completed tournament offers no Reopen").toBeVisible({ timeout: 30_000 });
  await reopen.click();
  const asked = page.getByRole("alertdialog");
  await expect(asked, "Reopen did not ask first").toBeVisible({ timeout: 15_000 });
  await asked.getByRole("button", { name: "Reopen tournament" }).click();
}
