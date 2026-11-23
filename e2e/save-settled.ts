import { expect, type Page } from "@playwright/test";

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
 * Never `networkidle`: the service worker keeps the network busy (`docs/claude/e2e-traps.md`).
 */
export async function savedBeforeReload(page: Page): Promise<void> {
  await expect(page.getByText("Saving…"), "the screen is still saving").toHaveCount(0, { timeout: 20_000 });
}
