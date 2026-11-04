import { expect, type Page } from "@playwright/test";

/**
 * WHAT THE TOURNAMENT SAYS, ASKED OF EVERY PANEL THAT SAYS IT (state machine
 * PR 3; QA, panel 8.4).
 *
 * The state machine (`tournamentStatus(facts)`) answers "which step is it on,
 * what is next, and why not yet" once; the screens draw that answer in several
 * places. A disagreement between two of them is exactly the fault the machine
 * was built to end (D1: a Launch button that works under a checklist and a
 * journey card that say setup is not done). So one helper reads them ALL, at
 * every step a spec walks, and fails on the first that says otherwise:
 *
 *   the context bar's chip           every console screen (`EventContextBar`)
 *   the status card's chip           the dashboard (`LifecycleBar`)
 *   the one next action              the dashboard's status card, with its
 *                                    refusal in place and the way out
 *                                    (`RefusedAction`)
 *   the setup rail                   Tournament details (`SetupFlowRail`)
 *   "Still to set up"                the dashboard's checklist
 *   the journey's "You are here"     Tournament details (`TournamentJourney`)
 *
 * It navigates (dashboard, then Tournament details), so call it where the next
 * step of a walk can start from either.
 */
export interface TournamentSays {
  /** The chip: "Setting up", "Setting up · results in", "Live", "Play over", "Completed". */
  chip: string;
  /** The line under "Play over" — "Every round closed · results not released" — or null for none. */
  chipDetail?: string | null;
  /** THE one button's words on the dashboard's status card, or null for none. */
  nextAction: string | null;
  /** Refused in place: part of the reason, and the way out under it. Null: the button is live. */
  refused?: { because: string | RegExp; wayOut: { says: string; href: string } } | null;
  /**
   * The setup rail on Tournament details, and the dashboard's "Still to set up":
   *   `{ holds, done, of }`  a step holds launch — the rail counts, the checklist names it;
   *   `{ ready, done, of, optional }`  nothing holds — "Ready to launch", each optional
   *                          step marked "Optional", and no "Still to set up" card;
   *   `null`                 past launch — no rail at all.
   */
  setup?: { holds: string; done: number; of: number } | { ready: true; done: number; of: number; optional: string[] } | null;
  /** The phase the journey card marks "You are here". */
  journey?: "Set up" | "Launch" | "Play" | "Finish";
}

/** The dashboard's lifecycle buttons — never "Unlock configuration" or a quick action. */
const LIFECYCLE = /^(Launch|Complete|Reopen|Generate|Set )/;

export async function expectTournamentSays(page: Page, says: TournamentSays): Promise<void> {
  await page.goto(`/dashboard?bust=${Date.now()}`);
  const bar = page.locator(".event-context-bar");
  await expect(bar.locator(".tag").first(), "the context bar's chip").toHaveText(says.chip, { timeout: 30_000 });
  if (says.chipDetail !== undefined) {
    if (says.chipDetail === null) await expect(bar, "a second line under the chip").not.toContainText("results not released");
    else await expect(bar, "the line under the chip").toContainText(says.chipDetail);
  }

  const card = page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: "Tournament status" }) });
  await expect(card.locator(".tag").first(), "the dashboard's chip disagrees with the context bar").toHaveText(says.chip);

  if (says.nextAction === null) {
    await expect(card.getByRole("button", { name: LIFECYCLE }), "a next action is offered").toHaveCount(0);
    await expect(card.getByRole("link", { name: LIFECYCLE }), "a next action is offered").toHaveCount(0);
  } else {
    const action = card.getByRole("button", { name: says.nextAction }).or(card.getByRole("link", { name: says.nextAction })).first();
    await expect(action, `the next action is not "${says.nextAction}"`).toBeVisible();
    if (says.refused) {
      await expect(action, "a refused action looks pressable").toHaveAttribute("aria-disabled", "true");
      const reason = page.locator(`#${await action.getAttribute("aria-describedby")}`);
      await expect(reason, "the refusal is not said under the button").toContainText(says.refused.because);
      await expect(reason.getByRole("link", { name: says.refused.wayOut.says }), "the refusal has no way out").toHaveAttribute("href", says.refused.wayOut.href);
    } else if (says.refused === null) {
      await expect(action, "the action is refused").not.toHaveAttribute("aria-disabled", "true");
    }
  }

  const stillToDo = page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: /Still to set up|Getting started/ }) });
  if (says.setup && "holds" in says.setup) {
    await expect(stillToDo, "the dashboard's checklist does not name the step that holds launch").toContainText(says.setup.holds);
  } else if (says.setup !== undefined) {
    // Nothing holds (or it is launched): no checklist waits on the organizer.
    await expect(stillToDo, "the dashboard says setup is not finished while nothing holds launch").toHaveCount(0);
  }

  if (says.setup === undefined && says.journey === undefined) return;
  await page.goto(`/event?bust=${Date.now()}`);
  const main = page.locator("main");
  if (says.setup && "holds" in says.setup) {
    await expect(main, "the rail's count").toContainText(`${says.setup.done} of ${says.setup.of} done`, { timeout: 30_000 });
    await expect(main).not.toContainText("Ready to launch");
  } else if (says.setup) {
    const rail = page.locator(".card").filter({ hasText: "Ready to launch" });
    await expect(rail, "the rail does not say it is ready to launch").toContainText(
      `Ready to launch — ${says.setup.done} of ${says.setup.of} done, the rest optional`,
      { timeout: 30_000 },
    );
    for (const label of says.setup.optional) {
      await expect(rail.locator("li", { hasText: label }), `${label} is not marked optional on the rail`).toContainText(/Optional/i);
    }
  } else if (says.setup === null) {
    await expect(main.locator(".card-kicker", { hasText: "Setting up" }), "a launched tournament still shows the rail").toHaveCount(0);
    await expect(main, "a launched tournament is offered launching").not.toContainText("Ready to launch");
  }
  if (says.journey) {
    const journey = page.locator(".card").filter({ hasText: "How a tournament runs" });
    await expect(journey.locator("li").filter({ hasText: "You are here" }), "the journey card disagrees").toContainText(says.journey, { timeout: 30_000 });
    await expect(journey, "the journey card counts again").not.toContainText(/phase \d of \d/);
  }
}
