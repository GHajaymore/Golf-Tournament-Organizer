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
  // Already Gross: nothing to choose, and nothing will save.
  if (await gross.locator("input").isChecked()) return;
  await gross.click();
  // The choice reads back ticked at once — that is the radio's own state, not
  // the server's answer (the round no longer repeats the option in a sentence
  // under it: 2026-10-16, Gross and Net say themselves).
  await expect(gross.locator("input")).toBeChecked({ timeout: 20_000 });
  // WAIT FOR "Saved", as the organizer does, before touching the next round.
  // While the card says "Saving…" its heading is wider and the Net-only
  // allowance row is still drawn; both go when the server answers, and the
  // rounds under it move up by about 56px. The Firefox nightly of 2026-11-01
  // pressed Round 2's heading during "Saving…" and the press landed after the
  // shift, in the gap below it: Round 2 never opened, and its Gross waited
  // 480 s for a card that was shut.
  await expect(card.getByText("Saved", { exact: true }), `${round}: Gross never said Saved`).toBeVisible({ timeout: 20_000 });
}
