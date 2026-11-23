import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { openScreen, openFold } from "./index";

/**
 * EVENT, THE REDESIGNED SCREEN (R3), as a person drives it: a page object so every spec that ports an Event job writes it once.
 * It reaches the screen at `consoleUrl("/event", "build")` (the key is "building": only a build preview shows it). The controls
 * are the old screen's own, found by the names they have, inside the section they belong to.
 */
export class EventScreen {
  constructor(readonly page: Page) {}

  /** Opens the redesigned screen and waits for it. */
  async open(): Promise<void> {
    await openScreen(this.page, "/event");
    await this.page.locator("[data-event-screen]").waitFor({ state: "visible" });
  }

  /** What, when or where: one section of the screen. */
  section(name: "what" | "when" | "where"): Locator {
    return this.page.locator(`[data-section="event-${name}"]`);
  }

  nameInput(): Locator {
    return this.section("what").getByLabel("Tournament name");
  }

  lastDay(): Locator {
    return this.section("when").getByLabel("Tournament dates, last day");
  }

  /** The ONE Save, drawn once for the whole screen. */
  save(): Locator {
    return this.page.locator("[data-event-screen]").getByRole("button", { name: /^(Save|Saved)$/ });
  }

  /** A refusal, found by its own element: the route announcer is an alert too. */
  refusal(text: RegExp | string): Locator {
    return this.page.locator('[data-event-screen] p[role="alert"]').filter({ hasText: text });
  }

  /** The one lock banner (`LockedOnce`), "locked" or "open". */
  lockedOnce(): Locator {
    return this.page.locator("[data-locked-once]");
  }

  /** Opens More, which a phone folds, and returns its section. */
  async openMore(): Promise<Locator> {
    const more = this.page.locator('[data-section="event-more"]');
    // The fold's own line is the section's direct child; the controls inside carry "More about ..." buttons of their own.
    await openFold(more.locator(":scope > button"));
    return more;
  }

  /** The tees beside the course: the one select, inside Where. */
  teeSelect(): Locator {
    return this.section("where").locator("#default-tee");
  }

  /** Presses Save and waits for the server's answer: the button settles on "Saved". */
  async saveAndWait(): Promise<void> {
    await this.save().click();
    await expect(this.save()).toHaveText(/Saved/);
  }
}
