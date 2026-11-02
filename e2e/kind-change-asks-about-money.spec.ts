import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre } from "./rounds-fixture";

/**
 * A SOCIETY THAT BECOMES A GOLF CLUB IS TOLD WHAT HAPPENS TO ITS MONEY FIRST.
 *
 * Money is resolved at read time — the tournament's own mode, then the club's,
 * then the kind of outfit — so changing "What this is" from a society to a golf
 * club silently moved every tournament that never chose from "Split shared
 * costs" to "Costs handled outside the app" (found 2026-11-01 by reading the
 * code). The picker now asks, naming the tournaments, with two answers:
 *
 *   keep          the club's own money default is set to what they get today,
 *                 then the kind changes — nothing a player sees moves
 *   switch anyway the kind changes and the tournaments follow it
 *
 * Done as the secretary does it, on Club settings, and read back from the
 * database and from the screen after a reload. A tournament with its own money
 * setting is the control: it is never named.
 *
 * WHAT IT CANNOT SEE: a call to the action without an answer from anywhere but
 * this screen — `a-kind-change-says-what-it-does-to-money.audit.test.ts` drives
 * the action itself; and the to-personal roster question, which
 * `an-outfit-can-say-what-it-is.audit.test.ts` holds.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-kindwarn-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-kindwarn-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openSettings(page: Page) {
  await page.goto(`/organization?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Club settings — not signed in?").toBe("/organization");
  await expect(page.locator("main h1")).toBeVisible();
}

const whatThisIs = (page: Page) =>
  page.locator("section.card", { has: page.getByText("What this is", { exact: true }) });

async function chooseGolfClub(page: Page) {
  const option = whatThisIs(page).locator("label", { hasText: "Golf club" });
  await centre(option);
  await option.click();
}

for (const answer of ["keep", "switch"] as const) {
  test(`a society switched to a golf club is asked about its tournaments' money first, and "${answer}" does what it says`, async ({ page, context, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
    const errors: string[] = [];
    watchPageErrors(page, errors, "secretary");
    const mark = markFor(answer, testInfo.project.name);
    const club = await makeClub(mark);
    try {
      await prisma.organization.update({ where: { id: club.orgId }, data: { kind: "community", moneyMode: "" } });
      // Four that follow the club — so the question names three and "1 more" —
      // and one with its own money setting, which no change of kind can move.
      const { event } = await makeEvent(club, "Spring Medal", { stages: [{}] });
      await makeEvent(club, "Summer Pairs", { stages: [{}] });
      await makeEvent(club, "Autumn Cup", { stages: [{}] });
      await makeEvent(club, "Winter Stableford", { stages: [{}] });
      await makeEvent(club, "Captains Day", { stages: [{}], event: { moneyMode: "float" } });
      await signIn(context, baseURL!, club, event.id);
      const stored = async () => {
        const o = await prisma.organization.findUniqueOrThrow({ where: { id: club.orgId } });
        return { kind: o.kind, moneyMode: o.moneyMode };
      };

      await openSettings(page);
      await chooseGolfClub(page);

      const question = whatThisIs(page).getByRole("alert");
      await expect(question, "switching to a golf club asked nothing about money").toBeVisible();
      await expect(question).toContainText("4 tournaments follow the default for money");
      await expect(question).toContainText("and 1 more");
      await expect(question).toContainText("“Split shared costs” to “Costs handled outside the app”");
      await expect(question).not.toContainText("Captains Day");
      // Asked, not done: nothing is written until they answer.
      expect(await stored()).toEqual({ kind: "community", moneyMode: "" });

      const button = whatThisIs(page).getByRole("button", {
        name: answer === "keep" ? "Keep their money as it is" : "Switch anyway",
      });
      await centre(button);
      await button.click();

      const want = answer === "keep" ? { kind: "club", moneyMode: "split" } : { kind: "club", moneyMode: "" };
      await expect.poll(stored, { message: `"${answer}" did not store what it says` }).toEqual(want);
      await expect(question, "the question stayed up after it was answered").toHaveCount(0);

      await openSettings(page);
      await expect(
        whatThisIs(page).locator("label", { hasText: "Golf club" }).locator('input[type="radio"]'),
        "the golf club choice did not survive a reload",
      ).toBeChecked();
    } finally {
      await dropClub(mark);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
