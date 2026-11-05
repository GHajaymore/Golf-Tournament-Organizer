import { expect, type Locator, type Page } from "@playwright/test";

/**
 * AFTER THE ROUND CODE: PICK THE GROUP, CONFIRM IT ONCE (2026-11-04).
 *
 * `/play` used to list every player — "Tap your name" — and a spec pressed a
 * name. At a real cup two scorers pressed an OPPOSING player's name and kept
 * the match from the wrong side, so the page now lists GROUPS: each match, or
 * the published tee sheet's groups; only a stroke round with no tee sheet still
 * lists names. Whichever is tapped is said back once — "You're keeping Group 3:
 * … · 12:54 off the 10th" — with "Yes, that's my group" (a name: "Yes, that's
 * right") and "No, go back"; in a group of somebody's own cards the scorer then
 * picks whose card. A phone that confirmed a group for a round is not asked
 * again for it (`thq-play-kept:<round>` in its storage).
 *
 * These press that flow as a scorer does. They never guess which list the
 * round draws: the page says, by drawing it.
 */

/** The group buttons, as `/play` draws them after the code. */
export function playGroups(page: Page): Locator {
  return page.locator('form[data-held-until-live="group"] button[name="group"]');
}

/** The group a player is in, found by their name, as a scorer finds it. */
export function groupWith(page: Page, name: string): Locator {
  return playGroups(page).filter({ hasText: name });
}

/** What this phone has already confirmed, round by round. */
async function remembered(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      try {
        return Object.keys(window.localStorage)
          .filter((k) => k.startsWith("thq-play-kept:"))
          .map((k) => window.localStorage.getItem(k) ?? "");
      } catch {
        return [] as string[];
      }
    })
    .catch(() => [] as string[]);
}

/**
 * Opens `name`'s card or match from the list after the code: their group, then
 * the one confirmation (unless this phone gave it already), then — in a group
 * of own cards — their card. On a round with no groups, their name, confirmed.
 */
export async function keepCardOf(page: Page, name: string): Promise<void> {
  await pickAndConfirm(page, name);
  // Gone past the question: its heading says the name too, so a caller waiting
  // for a heading with the name would otherwise be answered by the question.
  await expect(page.getByRole("heading", { name: /^You're keeping |^Whose card are you keeping\?$/ }), "the card never opened after the confirmation").toHaveCount(0, {
    timeout: 30_000,
  });
}

/**
 * THE FULL LIST, WHERE THE PAGE OFFERS ONE GROUP FIRST (2026-11-05). A phone that confirmed a group earlier in
 * this tournament is offered it as "Last time: …" with the list behind **Not my group**; a scorer who wants
 * another group (or a spec that wants the list) opens it. A round with no remembered group draws the list
 * at once, and nothing is pressed.
 */
export async function openFullList(page: Page): Promise<void> {
  const notMine = page.getByRole("button", { name: "Not my group" });
  // The page says which list it drew, the group list or the names, in the same render as the list itself.
  await expect(page.getByText(/^Tap your group to start scoring.$|^Tap the name on the card you.re keeping.$/)).toBeVisible({ timeout: 20_000 });
  if (await notMine.isVisible().catch(() => false)) await notMine.click();
}

async function pickAndConfirm(page: Page, name: string): Promise<void> {
  await openFullList(page);
  const group = groupWith(page, name);
  const byName = page.getByRole("button", { name, exact: true });
  await expect(group.or(byName).first(), `"${name}" is in no group and on no list after the code`).toBeVisible({ timeout: 20_000 });
  if ((await group.count()) > 0) {
    const key = (await group.first().getAttribute("value")) ?? "";
    const askedBefore = (await remembered(page)).includes(key);
    await group.first().click();
    if (askedBefore) {
      // Confirmed on this phone already: straight through, or to whose card.
      const pick = page.getByRole("heading", { name: "Whose card are you keeping?" });
      if (await pick.isVisible().catch(() => false)) await page.getByRole("button", { name, exact: true }).click();
      return;
    }
    const yes = page.getByRole("button", { name: "Yes, that's my group" });
    await expect(yes, "a group was tapped and nothing asked whether it was the right one").toBeVisible();
    // Said on the same screen as the question, so it is known before the answer.
    const picksNext = (await page.getByText(/^Next you pick whose card you.re keeping\.$/).count()) > 0;
    await yes.click();
    if (picksNext) {
      await expect(page.getByRole("heading", { name: "Whose card are you keeping?" })).toBeVisible();
      await page.getByRole("button", { name, exact: true }).click();
    }
    return;
  }
  await byName.click();
  await page.getByRole("button", { name: "Yes, that's right" }).click();
}
