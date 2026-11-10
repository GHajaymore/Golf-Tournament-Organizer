import { expect, type Page } from "@playwright/test";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

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
  /**
   * The tournament's own line on the secretary's home (dashboard → What's next;
   * state machine PR 6): its words and its one button — the dashboard's next
   * action, or the way out of its refusal. Null: no such line. The fixture's
   * club runs this one tournament, so its line is the only one of these kinds.
   */
  home?: { text: string | RegExp; action: string } | null;
  /**
   * Also ask Rounds & formats' "Course day" timeline (`/stages?view=timeline`, behind its switch;
   * state machine PR 5c, J16): its chip, the line under it, and the lead of its "Needs you" strip
   * must say what the dashboard's status card says — the one next action, refused in place with
   * the same reason. A completed tournament's strip leads with nothing (Reopen is a remedy, not a need).
   */
  timeline?: boolean;
}

/** The home's lines that are a tournament's own next action (`lifecycleJob` in needs-you-now.ts). */
const OWN_LINE = '[data-job="launch"], [data-job="schedule"], [data-job="draw"], [data-job="results"]';

/** The dashboard's lifecycle buttons — never "Unlock configuration" or a quick action. */
const LIFECYCLE = /^(Launch|Complete|Reopen|Generate|Set |End this event early)/;

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
    // While golf remains to be played, completing is "End this event early…" behind the card's More
    // (the PM, 10 Nov): open it first, as an organizer would.
    if (says.nextAction === END_EARLY) {
      const more = card.getByRole("button", { name: "More actions", exact: true });
      await expect(more, "the card has no More to end the event early").toBeVisible();
      if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    }
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

  if (says.home !== undefined) {
    const next = page.getByRole("region", { name: "What's next" });
    await expect(next, "the dashboard has no What's next").toBeVisible();
    const own = next.locator(OWN_LINE);
    if (says.home === null) {
      await expect(own, "the home offers a next step the dashboard does not").toHaveCount(0);
    } else {
      await expect(own, "the home's line for this tournament").toHaveCount(1);
      await expect(own, "the home says something else than the dashboard").toContainText(says.home.text);
      // The open tournament's line is a link to the screen that does it (`WhatsNext`).
      await expect(own.getByRole("link", { name: says.home.action }), "the home's button").toBeVisible();
    }
  }

  const stillToDo = page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: /Still to set up|Getting started/ }) });
  if (says.setup && "holds" in says.setup) {
    await expect(stillToDo, "the dashboard's checklist does not name the step that holds launch").toContainText(says.setup.holds);
  } else if (says.setup !== undefined) {
    // Nothing holds (or it is launched): no checklist waits on the organizer.
    await expect(stillToDo, "the dashboard says setup is not finished while nothing holds launch").toHaveCount(0);
  }

  if (says.timeline) await expectTimelineSays(page, says);

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

/**
 * THE TIMELINE SAYS IT TOO (PR 5c, J16). Rounds & formats as "Course day" draws the machine's
 * chip above the rounds (`TimelineStep`) and leads its "Needs you" strip with the machine's next
 * action (`NeedsYou`, through `courseDayOf`) — the same `tournamentStatusFor` the context bar on the
 * same page reads, so the two are held to each other here as well as to `says`.
 */
async function expectTimelineSays(page: Page, says: TournamentSays): Promise<void> {
  await page.goto(`/stages?view=timeline&bust=${Date.now()}`);
  const step = page.locator(".rt-hero-step");
  await expect(step.locator(".tag"), "the timeline's chip").toHaveText(says.chip, { timeout: 30_000 });
  await expect(page.locator(".event-context-bar .tag").first(), "the timeline's chip disagrees with the context bar above it").toHaveText(says.chip);
  if (says.chipDetail) await expect(step, "the line under the timeline's chip").toContainText(says.chipDetail);
  else if (says.chipDetail === null) await expect(step, "a second line under the timeline's chip").not.toContainText("results not released");

  const lead = page.locator(".rt-need-next");
  if (says.nextAction === null || says.chip === "Completed") {
    await expect(lead, "the timeline leads with a next action the dashboard does not offer").toHaveCount(0);
    return;
  }
  // The timeline (still behind its own `?view=timeline` switch) leads with the MACHINE's next action as
  // it gives it; the lifecycle stepper's PR (B03) left it alone. So where the dashboard's card says
  // "End this event early…" behind More, the timeline says the machine's own "Complete tournament",
  // with the same refusal and way out.
  const timelineSays = says.nextAction === END_EARLY ? "Complete tournament" : says.nextAction;
  const action = lead.getByRole("button", { name: timelineSays }).or(lead.getByRole("link", { name: timelineSays })).first();
  await expect(action, `the timeline's next action is not "${timelineSays}"`).toBeVisible();
  if (says.refused) {
    await expect(action, "the timeline's refused action looks pressable").toHaveAttribute("aria-disabled", "true");
    const reason = page.locator(`#${await action.getAttribute("aria-describedby")}`);
    await expect(reason, "the timeline does not say the dashboard's refusal").toContainText(says.refused.because);
    if (says.refused.wayOut.href === "/stages") {
      // Put right on this very screen: the way out opens the round concerned, in place.
      await expect(lead.getByRole("button", { name: /^Open / }), "the timeline's refusal has no way out").toBeVisible();
    } else {
      await expect(reason.getByRole("link", { name: says.refused.wayOut.says }), "the timeline's refusal has no way out").toHaveAttribute("href", says.refused.wayOut.href);
    }
  } else if (says.refused === null) {
    await expect(action, "the timeline refuses what the dashboard allows").not.toHaveAttribute("aria-disabled", "true");
  }
}
