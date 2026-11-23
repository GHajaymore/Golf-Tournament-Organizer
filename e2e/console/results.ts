import type { Locator, Page } from "@playwright/test";
import { openScreen, SCREENS_BUILT } from "./index";

/**
 * THE REDESIGNED "RESULTS" SCREEN, AS A PERSON USES IT (R12): Reports & export with the one verb for releasing drawn above
 * the exports. Opens at its building address and finds the release card by its anchor and its words, never by a position.
 * The card writes nothing itself: its verb is a link to the machine's own press, so a spec that presses the press does it on
 * the screen that asks (the Dashboard), then looks here again.
 */
export class ResultsPage {
  constructor(readonly page: Page) {}

  static path(): string {
    return SCREENS_BUILT.results ?? "/reports";
  }

  async open(): Promise<void> {
    await openScreen(this.page, ResultsPage.path());
  }

  /** The release card, whatever state it is in (`ready`, `blocked`, `released`, `later`). */
  releaseCard(): Locator {
    return this.page.locator("[data-release-results]");
  }

  /** The one verb, as a link, when the results can be released. */
  releaseVerb(): Locator {
    return this.releaseCard().getByRole("link", { name: "Make results final" });
  }
}
