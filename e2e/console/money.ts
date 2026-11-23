import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { consoleUrl } from "../../src/lib/console-url";
import { SCREENS_BUILT } from "./index";

/**
 * WINNERS & MONEY, THE SETTLE HALF (R8b), as a person drives it: `/money` reached while it is only previewed
 * (`consoleUrl("/money", "build")`, the key is "building"). The controls ARE the old screen's (the prize table's winner pickers,
 * the kitty, the ledger, the groups' game cards), so a spec finds each by the name the old screen gave it; what is new is the
 * page, its marker and the section the groups' games are drawn in.
 */
export const MONEY_PATH = SCREENS_BUILT.money ?? "/money";

export class MoneyScreen {
  constructor(readonly page: Page) {}

  /** Opens the redesigned screen (optionally on one round) and waits for its marker. */
  async open(round?: string): Promise<void> {
    const path = round ? `${MONEY_PATH}?round=${encodeURIComponent(round)}` : MONEY_PATH;
    await this.page.goto(consoleUrl(path, "build"));
    await this.page.locator("[data-money-screen]").waitFor({ state: "visible" });
  }

  /** The winner picker of a prize line, the visible one (the row is drawn for a wide and a narrow screen; one is visible). */
  winnerOf(category: string): Locator {
    return this.page.getByLabel(`Winner of ${category}`).locator("visible=true");
  }

  /** The kitty's card. */
  kitty(): Locator {
    return this.page.locator("section.card", { has: this.page.locator(".card-title", { hasText: /^The kitty$/ }) }).first();
  }

  /** The groups' games section. */
  groups(): Locator {
    return this.page.locator("#groups");
  }

  /** Nothing on this screen may offer to change what was offered. */
  async expectNoOfferControls(): Promise<void> {
    await expect(this.page.getByRole("button", { name: "Add", exact: true }), "Winners & money draws the prize list's Add").toHaveCount(0);
    await expect(this.page.getByLabel(/^Amount for /), "Winners & money draws an amount box to re-price a prize").toHaveCount(0);
  }
}
