import { expect, type Locator, type Page } from "@playwright/test";

/**
 * WHAT IS SHUT, WHY, AND THE WAY OUT — the lock half of J13, asked of the
 * screens that say it (state machine PR 5b, 7b), beside `expectTournamentSays`
 * (the step and the one next action).
 *
 * When the family specs (`status-*.spec.ts`) were written the lock was one
 * blanket with an Unlock button, and none of them looked at it. Since then:
 *
 *   PR 5b   each scope is locked by the thing that invalidates it, its banner
 *           says that thing, and the way out of a lock by launch is the
 *           Organizer's committee correction — never "Unlock";
 *   PR 7b   a round's own format, holes, venue and tees are NOT under that
 *           lock: they are open until the round's first card and then shut with
 *           the rounds rule's sentence, whatever the tournament's status.
 *
 * Every sentence is written out by the spec that calls these, not taken from
 * the app, so the words the organizer reads are what is held.
 *
 * Each helper navigates. Locators are scoped to the banner region, the round's
 * own card or the Tees label, so a hidden or neighbouring element cannot answer.
 */

/** A lock by launch, as the banner says it (`locksOf`). */
export const LOCKED_LIVE = "Locked because the tournament is live.";
/** A lock by completion. */
export const LOCKED_COMPLETED = "Locked because the tournament is completed.";
/** The rounds rule's sentence for every setting of a round once the tournament is completed (`COMPLETED_ROUNDS`). */
export const ROUNDS_FINAL = "The tournament is completed, so its rounds are final. An Organizer can reopen it on the dashboard.";
/** The Organizer's way out of a lock by launch (`CORRECTION_BUTTON`). */
const CORRECTION = "Make a committee correction";

/**
 * The control about to be read, in the middle of the screen (as `rounds-fixture.ts`
 * does it — kept here so these specs do not open that fixture's second database client).
 */
async function centre(control: Locator): Promise<void> {
  await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
}

/** A round's card on Rounds & formats, opened: the screen opens one of one or two rounds and none of three. */
async function roundCard(page: Page, stageId: string): Promise<Locator> {
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1").first(), "Rounds & formats did not draw").toBeVisible({ timeout: 30_000 });
  const card = page.locator(`[id="round-${stageId}"]`);
  await expect(card, "Rounds & formats has no card for this round").toBeVisible();
  const head = card.locator("button[aria-expanded]").first();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return card;
}

export interface ScopeLockSays {
  /** The scope as the banner names it: "Rounds", "Details", "The field", "Flights". */
  scope: string;
  /** The reason, whole: "Locked because the tournament is live." */
  because: string;
  /**
   * The way out: `"correction"` — the Organizer's "Make a committee correction"
   * button on the banner — or a link (a lock by completion: Reopen it on the
   * dashboard), in which case NO correction is offered.
   */
  wayOut: "correction" | { says: string; href: string };
}

/**
 * The screen at `path` (`/stages`, `/event`, `/registration`, `/grouping`) says
 * this lock on its banner — or, for `null`, draws no "Locked" banner at all.
 */
export async function expectScopeLock(page: Page, path: string, says: ScopeLockSays | null): Promise<void> {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // The screen itself first: a count of nothing on a page that has not drawn is not an answer.
  await expect(page.locator("main h1").first(), `${path} did not draw`).toBeVisible({ timeout: 30_000 });
  const banner = page.getByRole("region", { name: "Locked", exact: true });
  if (says === null) {
    await expect(banner, `${path} says something is locked`).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: CORRECTION }), `${path} offers a correction with nothing locked`).toHaveCount(0);
    return;
  }
  await expect(banner, `${path} draws no lock banner`).toBeVisible();
  const line = banner.locator("p").filter({ hasText: says.because });
  await expect(line, `${path}: the banner does not say why ${says.scope} is locked`).toHaveCount(1);
  await expect(line, `${path}: the reason is not said of ${says.scope}`).toContainText(`${says.scope} · ${says.because}`);
  await expect(banner, `${path}: the banner still says Unlock`).not.toContainText(/unlock/i);
  const correction = banner.getByRole("button", { name: CORRECTION });
  if (says.wayOut === "correction") {
    await expect(correction, `${path}: a lock by launch offers the Organizer no committee correction`).toBeVisible();
    await expect(correction).toBeEnabled();
  } else {
    await expect(line.getByRole("link", { name: says.wayOut.says }), `${path}: the lock has no way out`).toHaveAttribute("href", says.wayOut.href);
    await expect(correction, `${path}: a correction is offered over a lock it cannot open`).toHaveCount(0);
  }
}

/**
 * One round's Format and Holes on Rounds & formats: `null` — open, pressable,
 * nothing said under them — or shut, with exactly this sentence under them.
 * `round` is the round's label as the screen names it ("Round 1").
 */
export async function expectRoundDoors(
  page: Page,
  stageId: string,
  round: string,
  says: { format: string | null; holes: string | null },
): Promise<void> {
  const card = await roundCard(page, stageId);
  const format = card.getByLabel(`Format for ${round}`);
  await centre(format);
  const nine = card.getByRole("radiogroup", { name: `Holes for ${round}` }).getByRole("radio", { name: "9", exact: true });
  if (says.format === null) {
    await expect(format, `${round}'s format is shut with no card in it`).toBeEnabled();
    await expect(card.getByTestId("format-door"), `${round}'s format gives a reason while open`).toHaveCount(0);
  } else {
    await expect(format, `${round}'s format is still offered`).toBeDisabled();
    await expect(card.getByTestId("format-door"), `${round}'s format is shut without its reason`).toHaveText(says.format);
  }
  if (says.holes === null) {
    await expect(nine, `${round}'s holes are shut with no card in it`).toBeEnabled();
    await expect(card.getByTestId("holes-door"), `${round}'s holes give a reason while open`).toHaveCount(0);
  } else {
    await expect(nine, `${round}'s holes are still offered`).toBeDisabled();
    await expect(card.getByTestId("holes-door"), `${round}'s holes are shut without their reason`).toHaveText(says.holes);
  }
}

/**
 * One round's venue and tees on Score entry (`RoundVenue`): `null` — the Tees
 * box pressable and nothing said — or both shut, this sentence under them. The
 * round's course needs two sets for the Tees box to be drawn at all; the caller
 * makes them and this says so if it is not.
 */
export async function expectTeesDoor(page: Page, stageId: string, says: string | null): Promise<void> {
  await page.goto(`/entry?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1").first(), "Score entry did not draw").toBeVisible({ timeout: 30_000 });
  // The Tees box sits in a label with these words beside it; the venue picker above it is a combobox, not a select.
  const tees = page.locator("main label").filter({ hasText: "decides the shots" }).locator("select");
  await expect(tees, "Score entry draws no Tees box for this round").toHaveCount(1);
  await centre(tees);
  const door = page.getByTestId("tees-door");
  if (says === null) {
    await expect(tees, "the Tees of a round with no card are shut").toBeEnabled();
    await expect(door, "a reason is given for tees that are open").toHaveCount(0);
  } else {
    await expect(tees, "Tees are offered on a round whose handicaps are frozen").toBeDisabled();
    await expect(door, "the venue and tees are shut without their reason").toContainText(says);
  }
}
