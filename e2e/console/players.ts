import type { Locator, Page } from "@playwright/test";
import { openScreen, SCREENS_BUILT } from "./index";

/**
 * THE REDESIGNED "PLAYERS" ROOM (R6), as a person drives it: Entries, Flights, Teams and Cup teams are four tabs,
 * each its own address. This object opens a tab at its building address (`?stepper=1&build=1`) and finds the
 * strip and its links by role and name, never by position, so a spec that ports to the room asks here.
 */
export type PlayersTabName = "Entries" | "Flights" | "Teams" | "Cup teams";

const PATHS: Record<PlayersTabName, string> = {
  Entries: SCREENS_BUILT.players ?? "/registration",
  Flights: "/grouping",
  Teams: "/teams",
  "Cup teams": "/teams?tab=cup",
};

export class PlayersPage {
  constructor(readonly page: Page) {}

  /** Open one tab by its address and wait for its heading. */
  async open(tab: PlayersTabName, extra = ""): Promise<void> {
    const path = PATHS[tab] + (extra ? `${PATHS[tab].includes("?") ? "&" : "?"}${extra}` : "");
    await openScreen(this.page, path);
  }

  /** The strip of tabs. */
  strip(): Locator {
    return this.page.getByRole("navigation", { name: "Players" });
  }

  /** One tab's link in the strip. */
  tab(name: PlayersTabName): Locator {
    return this.strip().getByRole("link", { name, exact: true });
  }

  /** The tab the strip marks as the one you are on. */
  current(): Locator {
    return this.strip().locator('[aria-current="page"]');
  }
}
