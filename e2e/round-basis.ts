import { expect, type Page } from "@playwright/test";

/**
 * PLAY A ROUND SCRATCH, as the organizer of a scratch event does on Rounds & formats.
 *
 * A new round is played off handicap unless somebody says otherwise — the club
 * default since 2026-10-16 (`newRoundBasis`). A championship, a scratch
 * knockout or a gross qualifier says Gross, on the face of the round. Before
 * that day every round was created gross, and the specs for those events never
 * had to choose; this is the choice they now make.
 *
 * `round` is the start of the round's heading — "Round 1", or "Round 2 · Stroke
 * Play Round" where the type matters. Leaves that round open.
 */
export async function playScratch(page: Page, round: string): Promise<void> {
  const head = page.getByRole("button", { name: new RegExp(`^${round}`) }).first();
  await expect(head, `no round headed ${round}`).toBeVisible({ timeout: 20_000 });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  const card = page.locator(".card", { has: head });
  const gross = card.locator("label.seg-opt", { hasText: /^\s*Gross\s*$/ });
  await gross.click();
  await expect(card.getByText("Scratch: the strokes as taken, no handicaps.")).toBeVisible({ timeout: 20_000 });
  await expect(gross.locator("input")).toBeChecked();
}
