import { expect, type Locator, type Page } from "@playwright/test";

/** The Teams tab's bar: the "Add a team" box, its button and the `SaveState` badge (the card a team is pressed in). */
export const teamsBar = (page: Page): Locator =>
  page
    .locator("div")
    .filter({ has: page.getByRole("textbox", { name: "Add a team" }) })
    .filter({ has: page.getByRole("button", { name: "Add team" }) })
    .last();

/** The "Prizes" card, which holds the list's `SaveState` badge. */
export const prizesCard = (page: Page): Locator => page.locator(".card", { has: page.locator(".card-title", { hasText: /^Prizes$/ }) }).last();

/**
 * LET THE SCREEN FINISH SAVING BEFORE IT IS LOADED AGAIN.
 *
 * A press that saves runs a server action and then refreshes the screen, all inside one transition, and
 * the app says so: "Saving…" (the `SaveState` badge, or a button's own label) until the refresh is back.
 * A row in the database, or a refusal on the screen, appears BEFORE that. A spec that reloads on seeing
 * either is reloading mid-refresh, which a person never does (they read "Saving…" and wait), and Firefox
 * answers `NS_BINDING_ABORTED` (nightly G72-1, `locked-sides-refuse-in-words.spec.ts`, 23 Nov 2026).
 *
 * The harness's `reload` waits for server actions in flight, not for the refresh's own requests, and is
 * not given a retry on purpose: a retry would hide a spec that reloads mid-save.
 *
 * `scope` is the card or form that was pressed, so an unrelated "Saving…" elsewhere cannot fail it. Use it
 * only where that control renders a saving indicator (`SaveState`); on one that shows none it passes at once.
 *
 * Never `networkidle`: the service worker keeps the network busy (`docs/claude/e2e-traps.md`).
 */
export async function savedBeforeReload(scope: Locator): Promise<void> {
  await expect(scope.getByText("Saving…"), "the pressed card is still saving").toHaveCount(0, { timeout: 20_000 });
}
