import { expect } from "@playwright/test";
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";
import { openFold, openScreen, SCREENS_BUILT } from "./index";
import { prisma, makeClub, dropClub, makeEvent, signIn, addDays, dayIn, type Club } from "../rounds-fixture";

/**
 * THE REDESIGNED "TEE TIMES & DRAW" SCREEN, AS A PERSON USES IT (R9a). Opens at its building address
 * (`?stepper=1&build=1`) and finds each part by its role or its words, never by a position. A spec that
 * ports to the new screen asks this object, so the screen's markup changes in one place.
 */
export type DrawSectionName = "whoIn" | "draw" | "teeTimes" | "onTheDay" | "paper";

export class TeeTimesPage {
  constructor(readonly page: Page) {}

  /** The screen's path while it is built (`SCREENS_BUILT.teeTimes`). */
  static path(round?: string): string {
    const base = SCREENS_BUILT.teeTimes ?? "/foursomes";
    return round ? `${base}?round=${round}` : base;
  }

  async open(round?: string): Promise<void> {
    await openScreen(this.page, TeeTimesPage.path(round));
    await this.page.getByRole("heading", { level: 1, name: "Tee times & draw" }).waitFor({ state: "visible" });
  }

  /** One section by its anchor. */
  section(key: DrawSectionName): Locator {
    return this.page.locator(`[data-section="${key}"]`);
  }

  /** Open a section a phone has folded (a person taps its line); one already open is left alone. Returns the section. */
  async openSection(key: DrawSectionName): Promise<Locator> {
    await openFold(this.sectionLine(key));
    return this.section(key);
  }

  /** A section's folded line (the button that opens or folds it). */
  sectionLine(key: DrawSectionName): Locator {
    return this.section(key).getByRole("button").first();
  }

  /** Find a player's box. The round's handicap panel has a box of the same name, so it is found inside its own region. */
  findBox(): Locator {
    return this.page.locator("[data-find-a-player]").getByRole("searchbox", { name: "Find a player" });
  }

  /** The answer under the box: its state, and the rows. */
  findAnswer(): Locator {
    return this.page.locator("[data-find-state]");
  }

  /** "This round needs", when the round has needs. */
  thisRoundNeeds(): Locator {
    return this.page.locator("[data-this-round-needs]");
  }
}

/**
 * A LAUNCHED STROKE MEDAL OF TWO ROUNDS, built by the fixture (never assumed by a spec): Round 1 tomorrow at the
 * club (UTC) with its sheet PUBLISHED, Round 2 five days on with none. Eight entries, read from the fixture:
 * `placed` are in Round 1's two groups, `unplaced` is confirmed and in no group, `withdrew` is out of the field.
 */
export interface TeeTimesDay {
  club: Club;
  eventId: string;
  round1: string;
  round2: string;
  placed: { id: string; name: string }[];
  unplaced: { id: string; name: string };
  withdrew: { id: string; name: string };
}

const ZONE = "UTC";

export async function seedTeeTimesDay(mark: string): Promise<TeeTimesDay> {
  await dropClub(mark);
  const club = await makeClub(mark, { timeZone: ZONE });
  const made = await makeEvent(club, "Monthly Medal", {
    status: "live",
    stages: [{ playedOn: addDays(dayIn(ZONE), 1) }, { playedOn: addDays(dayIn(ZONE), 5) }],
    players: 8,
  });
  const ps = made.players;
  await prisma.player.update({ where: { id: ps[7].id }, data: { status: "withdrawn" } });
  await prisma.stage.update({
    where: { id: made.stages[0].id },
    data: {
      teeSheetPublished: true,
      teeSheet: JSON.stringify({
        savedAt: new Date().toISOString(),
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ps.slice(0, 4).map((p) => p.id) },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ps.slice(4, 6).map((p) => p.id) },
        ],
      }),
    },
  });
  return {
    club,
    eventId: made.event.id,
    round1: made.stages[0].id,
    round2: made.stages[1].id,
    placed: ps.slice(0, 6).map((p) => ({ id: p.id, name: p.name })),
    unplaced: { id: ps[6].id, name: ps[6].name },
    withdrew: { id: ps[7].id, name: ps[7].name },
  };
}

export async function dropTeeTimesDay(mark: string): Promise<void> {
  await dropClub(mark);
}

/** The secretary's browser on the new screen: a context with the service worker blocked (a save spec's rule), closed after. */
export async function withTeeTimes(
  browser: Browser,
  baseURL: string,
  testInfo: TestInfo,
  day: TeeTimesDay,
  run: (screen: TeeTimesPage, page: Page) => Promise<void>,
  viewport?: { width: number; height: number },
): Promise<void> {
  await withTeeTimesAs(browser, baseURL, testInfo, day, run, viewport);
}

/**
 * The same, for any club and tournament (R9b: a match, a league week, a round after a cut): the secretary's browser
 * with the service worker blocked, opened on the screen at its first round, closed after. A spec built on its own
 * fixture hands `{ club, eventId }`; the run opens the round it wants with `screen.open(roundId)`.
 */
export async function withTeeTimesAs(
  browser: Browser,
  baseURL: string,
  testInfo: TestInfo,
  who: { club: Club; eventId: string },
  run: (screen: TeeTimesPage, page: Page) => Promise<void>,
  viewport?: { width: number; height: number },
): Promise<void> {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", ...(viewport ? { viewport } : {}) });
  try {
    await signIn(context, baseURL, who.club, who.eventId);
    const page = await context.newPage();
    const screen = new TeeTimesPage(page);
    await screen.open();
    await run(screen, page);
  } finally {
    await context.close();
  }
}
