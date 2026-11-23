import type { Locator, Page } from "@playwright/test";
import { openScreen } from "./index";
import { PLAYER_TABS, playerTabHref } from "../../src/lib/domain/players-tabs";

/**
 * THE REDESIGNED "PLAYERS" ROOM (R6), as a person drives it: Entries, Flights, Teams and Cup teams are four tabs,
 * each its own address. This object opens a tab at its building address (`?stepper=1&build=1`) and finds the
 * strip and its links by role and name, never by position, so a spec that ports to the room asks here.
 */
export type PlayersTabName = "Entries" | "Flights" | "Teams" | "Cup teams";

/** Each tab's address, from the same list the strip is drawn from (`PLAYER_TABS`). */
const PATHS: Record<PlayersTabName, string> = Object.fromEntries(PLAYER_TABS.map((t) => [t.label, playerTabHref(t, "")])) as Record<PlayersTabName, string>;

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
