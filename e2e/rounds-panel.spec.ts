import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre } from "./rounds-fixture";

/**
 * ROUNDS & FORMATS AS A TIMELINE (`?view=timeline`, behind its switch, 2026-10-30).
 *
 * The QA & Test Lead's guards for step 1 of the rehaul, written before the switch can be turned
 * on. The open round's settings move into a side panel, inside the round's own card; this walks
 * the panel the way an organizer meets it, at every width the suite runs:
 *
 *   the switch      off by default: no panel, the round unfolds inline as it always has
 *   the panel       a named modal; focus moves in; nothing wider than the screen; its last
 *                   control can be reached; the page behind does not scroll
 *   closing         Escape closes it and gives focus back to the round; a press outside closes it
 *   one at a time   opening another round leaves exactly one panel showing
 *   one copy        no id is in the page twice (a round's controls drawn twice would be)
 *   it saves        a choice made in the panel is stored and is still there after a reload
 *
 * WHAT IT CANNOT SEE: a dialog opened over the panel (the delete confirmation is inline today, not
 * a dialog), the keyboard's Tab order inside the panel, and Safari's engine unless the run asks
 * for it (`E2E_ENGINE=webkit`).
 */

const markFor = (project: string) => `zz-rpanel-${project}`;

test.describe.configure({ timeout: 120_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-rpanel-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function open(page: Page, timeline: boolean) {
  await page.goto(`/stages?${timeline ? "view=timeline&" : ""}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1")).toBeVisible();
}
const head = (page: Page, stageId: string) => page.locator(`[id="round-${stageId}"] button[aria-expanded]`).first();
const visibleDialogs = (page: Page) => page.locator('[role="dialog"]:visible');

test("the timeline opens one round at a time in a named panel that fits the screen, closes on Escape or outside, and saves", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor(testInfo.project.name);
  const club = await makeClub(mark);
  try {
    // Three rounds, so none opens on arrival (the screen opens the first of one or two).
    const { event, stages } = await makeEvent(club, "Spring Meeting", { stages: [{}, {}, {}], players: 4 });
    await signIn(context, baseURL!, club, event.id);
    const [r1, r2] = stages;

    // ── the switch is OFF by default: today's screen, no panel ──
    await open(page, false);
    await head(page, r1.id).click();
    await expect(head(page, r1.id)).toHaveAttribute("aria-expanded", "true");
    await expect(visibleDialogs(page), "a panel opened with the switch off").toHaveCount(0);
    await expect(page.locator(`[id="round-${r1.id}"]`).getByLabel(/^Holes for Round 1$/), "today's screen does not unfold the round inline").toBeVisible();

    // ── the timeline: nothing open on arrival ──
    await open(page, true);
    await expect(visibleDialogs(page)).toHaveCount(0);
    await centre(head(page, r1.id));
    await head(page, r1.id).click();
    const panel = page.getByRole("dialog", { name: "Round 1" });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(visibleDialogs(page)).toHaveCount(1);
    expect(await panel.evaluate((p) => p.contains(document.activeElement)), "focus did not move into the panel").toBe(true);

    // ── it fits: nothing wider than the screen, the panel inside it, its last control reachable ──
    const fit = await page.evaluate(() => {
      const p = document.querySelector('[role="dialog"]:not([hidden])') ?? [...document.querySelectorAll('[role="dialog"]')].find((d) => (d as HTMLElement).offsetParent !== null);
      const box = p!.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - innerWidth, left: box.left, right: box.right, width: innerWidth, bodyScroll: getComputedStyle(document.body).overflow };
    });
    expect(fit.overflow, "the page scrolls sideways with the panel open").toBeLessThanOrEqual(0);
    expect(fit.left, "the panel starts off the screen").toBeGreaterThanOrEqual(-0.5);
    expect(fit.right, "the panel runs off the screen").toBeLessThanOrEqual(fit.width + 0.5);
    expect(fit.bodyScroll, "the page behind the panel still scrolls").toBe("hidden");
    // The last control a person can SEE: the panel also holds the closed "Customize this round"
    // section's controls, hidden, as the inline card always did.
    const last = panel.locator(".side-panel-body").locator("button, select, input, a[href]").filter({ visible: true }).last();
    await last.scrollIntoViewIfNeeded();
    await expect(last, "the panel's last control cannot be reached").toBeInViewport();

    // ── one copy: no id in the page twice ──
    const dupes = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    expect(dupes, "ids in the page more than once").toEqual([]);

    // ── Escape closes it and gives focus back to the round ──
    await page.keyboard.press("Escape");
    await expect(visibleDialogs(page)).toHaveCount(0);
    await expect(head(page, r1.id), "focus did not come back to the round").toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow), "the page stayed locked after closing").not.toBe("hidden");

    // ── a press outside closes it (where there is an outside: a phone's panel is the whole screen) ──
    await head(page, r1.id).click();
    await expect(panel).toBeVisible();
    const viewport = page.viewportSize()!;
    if (viewport.width > 600) {
      await page.mouse.click(12, Math.round(viewport.height / 2));
      await expect(visibleDialogs(page), "a press outside did not close the panel").toHaveCount(0);
    } else {
      await panel.getByRole("button", { name: "Close Round 1" }).click();
      await expect(visibleDialogs(page)).toHaveCount(0);
      testInfo.annotations.push({ type: "not walked", description: "press outside: at this width the panel is the whole screen, so there is no outside; closed with its Close button instead" });
    }

    // ── one at a time ──
    await head(page, r2.id).click();
    await expect(page.getByRole("dialog", { name: "Round 2" })).toBeVisible();
    await expect(visibleDialogs(page), "more than one panel showing").toHaveCount(1);
    await page.keyboard.press("Escape");

    // ── it saves: a choice made in the panel is stored and survives a reload ──
    await head(page, r1.id).click();
    const holes = panel.getByRole("radiogroup", { name: "Holes for Round 1" });
    await holes.getByText("9", { exact: true }).click();
    await expect.poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: r1.id } })).holes, { message: "nine holes was not stored" }).toBe(9);
    await open(page, true);
    await head(page, r1.id).click();
    await expect(page.getByRole("dialog", { name: "Round 1" }).getByRole("radiogroup", { name: "Holes for Round 1" }).getByRole("radio").nth(1)).toBeChecked();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
