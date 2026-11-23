import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { consoleUrl } from "../../src/lib/console-url";
import { SCREENS_BUILT, openFold } from "./index";

/**
 * PRIZES & SIDE GAMES, THE OFFER HALF (R8a), as a person drives it: `/prizes` reached while it is only previewed
 * (`consoleUrl("/prizes", "build")`, the key is "building"). The controls ARE the old screen's (PrizesClient, SkinsPotClient,
 * ContestsClient), so a spec finds each by the name the old screen gave it; what is new is the page's order, the marker, and
 * the money-setup fold a phone draws.
 */
export const PRIZES_PATH = SCREENS_BUILT.prizes ?? "/prizes";

export class PrizesScreen {
  constructor(readonly page: Page) {}

  /** Opens the redesigned screen (optionally on one round) and waits for its marker. */
  async open(round?: string): Promise<void> {
    const path = round ? `${PRIZES_PATH}?round=${encodeURIComponent(round)}` : PRIZES_PATH;
    await this.page.goto(consoleUrl(path, "build"));
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await this.page.locator("[data-prizes-screen]").waitFor({ state: "visible" });
  }

  /** The "How money works here" section: one folded line on a phone, always open on a wider screen. */
  moneySetup(): Locator {
    return this.page.locator("section#money-setup");
  }

  /**
   * Opens the money-setup fold where a phone has folded it, and returns the section. It presses the fold's own line only
   * when it says `aria-expanded="false"`, then asserts it is open: a control inside is then located INSIDE the section.
   */
  async openMoneySetup(): Promise<Locator> {
    const section = this.moneySetup();
    const line = section.locator(":scope > button[aria-expanded]");
    await expect(line, "the money setup has no line to open").toBeVisible();
    await openFold(line);
    return section;
  }

  /** The skins pot's card on the screen: the one with a buy-in box. */
  skinsCard(): Locator {
    return this.page.locator(".card", { has: this.page.getByLabel(/^Buy-in \(/) }).first();
  }

  /** The prize list's amount box for a category (the row is drawn for a wide and a narrow screen; one is visible). */
  amountFor(category: string): Locator {
    return this.page.getByLabel(`Amount for ${category}`).locator("visible=true");
  }

  /** The winner picker of a prize line, the visible one. */
  winnerOf(category: string): Locator {
    return this.page.getByLabel(`Winner of ${category}`).locator("visible=true");
  }
}
