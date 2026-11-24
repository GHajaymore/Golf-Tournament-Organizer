import type { Locator, Page } from "@playwright/test";
import { openScreen } from "./index";

/**
 * ROUNDS & FORMATS, THE REDESIGNED SCREEN (R4), as a person drives it: a page object so every spec that ports a Rounds
 * job writes the job once. It reaches the screen at `consoleUrl("/stages", "build")` (the key is "building": only a build
 * preview shows it) and finds each control by the name the old screen gave it, because the controls ARE the old screen's.
 */
export class RoundsScreen {
  constructor(readonly page: Page) {}

  /** Opens the redesigned screen and waits for its heading. */
  async open(): Promise<void> {
    await openScreen(this.page, "/stages");
    await this.page.locator("[data-rounds-screen]").waitFor({ state: "visible" });
  }

  /** One round's column, by its name ("Round 1"). */
  column(round: string): Locator {
    return this.page.locator(`section[data-round-column="${round}"]`);
  }

  /** The event's Scoring card, drawn once above the rounds. */
  scoringTile(): Locator {
    return this.page.locator("[data-scoring-tile]");
  }

  /** The team cup's points to win and holder (R4d), drawn once above the rounds for a team cup only. */
  cupSettings(): Locator {
    return this.page.locator("[data-cup-settings]");
  }

  /** The banner of the rounds lock, drawn once (`LockedOnce`) with the lock's words. */
  lockedOnce(): Locator {
    return this.page.locator("[data-locked-once]");
  }

  formatSelect(round: string): Locator {
    return this.column(round).getByRole("combobox", { name: `Format for ${round}` });
  }

  /** The Holes choice (18 or 9), a radio group named for the round. */
  holesGroup(round: string): Locator {
    return this.column(round).getByRole("radiogroup", { name: `Holes for ${round}` });
  }

  dayInput(round: string): Locator {
    return this.column(round).getByLabel(`Date ${round} is played`);
  }

  /** Opens a round's More (the rest of its settings); they are in the page while it is closed. */
  async openMore(round: string): Promise<void> {
    const button = this.column(round).getByRole("button", { name: `More about ${round}` });
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  }
}
