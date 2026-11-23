import { expect } from "@playwright/test";
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";
import { openFold, openScreen, SCREENS_BUILT } from "./index";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn, addDays, dayIn, type Club } from "../rounds-fixture";

/**
 * THE REDESIGNED "SCORE ENTRY" SCREEN, AS A PERSON USES IT (R12): the section that closes a round and sets its scoring window,
 * under the cards. Opens at its building address (`?stepper=1&build=1`) and finds each part by its role or its words, never by
 * a position. A spec that ports to the new screen asks this object, so the screen's markup changes in one place.
 *
 * On a phone the section is folded unless a card is still to come: `openClose()` opens it the way a person taps its line (the
 * kit's `openFold`) and returns the section, and a spec finds every control INSIDE what it returns, never from `page`.
 */
export class ScoreEntryPage {
  constructor(readonly page: Page) {}

  /** The screen's path while it is built (`SCREENS_BUILT.scoreEntry`), for one round. */
  static path(round: string): string {
    return `${SCREENS_BUILT.scoreEntry ?? "/entry"}?round=${round}`;
  }

  async open(round: string): Promise<void> {
    await openScreen(this.page, ScoreEntryPage.path(round));
    await this.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
  }

  /** The close section, by its anchor. */
  closeSection(): Locator {
    return this.page.locator('[data-section="close-round"]');
  }

  /** The section's folded line (the button that opens or folds it). */
  closeLine(): Locator {
    return this.closeSection().getByRole("button").first();
  }

  /** Opens the section a phone folds, and returns it. */
  async openClose(): Promise<Locator> {
    await openFold(this.closeLine());
    return this.closeSection();
  }

  /** One missing player's line, inside the open section. */
  missingLine(section: Locator, playerId: string): Locator {
    return section.locator(`[data-missing-card="${playerId}"]`);
  }

  /** The tick that closes the round, inside the open section. */
  finishedTick(section: Locator): Locator {
    return section.getByRole("checkbox", { name: /This round is finished/ });
  }
}

/**
 * A LAUNCHED STROKE MEDAL OF TWO ROUNDS AT A CLUB IN `ZONE`, built by the fixture (never assumed by a spec). Round 1 was
 * "played" yesterday AT THE CLUB with a play-by date of yesterday at the club, and holds approved cards from `returned`;
 * `missing` returned none. Round 2 is today and untouched. Four entries, read from the fixture.
 */
export interface ScoreEntryDay {
  club: Club;
  eventId: string;
  round1: string;
  round2: string;
  returned: { id: string; name: string }[];
  missing: { id: string; name: string };
  /** The club's zone, and its day today and yesterday AS THE CLUB WRITES THEM. */
  zone: string;
  today: string;
  yesterday: string;
}

export async function seedScoreEntryDay(mark: string, zone: string, opts: { windowShut?: boolean; cardStatus?: string } = {}): Promise<ScoreEntryDay> {
  const windowShut = opts.windowShut ?? true;
  const cardStatus = opts.cardStatus ?? "approved";
  await dropClub(mark);
  const club = await makeClub(mark, { timeZone: zone });
  const today = dayIn(zone);
  const yesterday = addDays(today, -1);
  const made = await makeEvent(club, "Monthly Medal", {
    status: "live",
    stages: [
      { playedOn: yesterday, deadline: windowShut ? yesterday : "" },
      { playedOn: today },
    ],
    players: 4,
  });
  const ps = made.players;
  // Approved by default, so closing the round does not stop to ask about a card nobody has signed off; a spec about that question says otherwise.
  for (const p of ps.slice(0, 3)) {
    await returnCard(made.event.id, made.stages[0].id, p.id);
    await prisma.scorecard.updateMany({ where: { stageId: made.stages[0].id, playerId: p.id }, data: { status: cardStatus } });
  }
  return {
    club,
    eventId: made.event.id,
    round1: made.stages[0].id,
    round2: made.stages[1].id,
    returned: ps.slice(0, 3).map((p) => ({ id: p.id, name: p.name })),
    missing: { id: ps[3].id, name: ps[3].name },
    zone,
    today,
    yesterday,
  };
}

export async function dropScoreEntryDay(mark: string): Promise<void> {
  await dropClub(mark);
}

/** The secretary's browser on the new screen: a context with the service worker blocked (a save spec's rule), closed after. */
export async function withScoreEntry(
  browser: Browser,
  baseURL: string,
  testInfo: TestInfo,
  day: ScoreEntryDay,
  run: (screen: ScoreEntryPage, page: Page) => Promise<void>,
  viewport?: { width: number; height: number },
): Promise<void> {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", ...(viewport ? { viewport } : {}) });
  try {
    await signIn(context, baseURL, day.club, day.eventId);
    const page = await context.newPage();
    const screen = new ScoreEntryPage(page);
    await screen.open(day.round1);
    await run(screen, page);
  } finally {
    await context.close();
  }
}

/**
 * THE CLUB'S PLAN HAS LAPSED, so the tournament is an archive (read-only, `ArchiveReadOnly`): the paid plan ended yesterday, as
 * `a-lapsed-club-cannot-close-a-round.spec.ts` sets it. Set-up only: what the archive does to the screen is the thing under test.
 */
export async function lapseTheClub(day: ScoreEntryDay): Promise<void> {
  const lapsedAt = new Date(Math.floor((Date.now() - 86_400_000) / 1000) * 1000);
  await prisma.subscription.updateMany({
    where: { organizationId: day.club.orgId },
    data: {
      plan: "free", status: "canceled", provider: "stripe", providerCustomerId: `cus_${day.club.mark}`, providerSubscriptionId: `sub_${day.club.mark}`,
      planTermsApply: true, lapsedAt, currentPeriodEnd: lapsedAt,
    },
  });
  await prisma.event.update({ where: { id: day.eventId }, data: { archivedAt: lapsedAt } });
}

/** The kept answer of a press, asserted after a fresh load (a spec's `reload()` then this). */
export async function expectClosedRound(screen: ScoreEntryPage, label: string): Promise<void> {
  await expect(screen.closeLine()).toContainText(`${label} is closed`);
}
