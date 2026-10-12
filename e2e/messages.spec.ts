import { createHmac } from "node:crypto";
import { test, expect, type Browser, type Page, type TestInfo } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * MESSAGES, BETWEEN TWO PEOPLE WHO ARE REALLY TWO PEOPLE.
 *
 * The first full round with its reach printed (2026-10-13) named this file's
 * subject exactly: `src/app/actions/messaging.ts — 0 of 9 reached`. Nine server
 * actions, a screen for the organizer and a screen for the player, and nothing
 * in the suite had ever sent a message. The every-action sweep had CALLED all
 * nine — as a stranger, to see them refuse — which is the opposite question.
 *
 * A message is the plainest case there is of something only two browsers can
 * test: what one person sends, the other must be shown; unread on one side
 * until it is opened on that side; and a setting one of them ticks is theirs.
 *
 *   announce   the secretary tells the whole tournament; the member is shown
 *              it, unread, under the secretary's name — and cannot answer an
 *              announcement
 *   direct     the secretary writes to the member alone; she answers; he is
 *              shown her answer, unread, under HER name
 *   read       a conversation opened is no longer unread, after a reload
 *   settings   "don't let other players message me" is kept, and can be
 *              turned back; so is agreeing to texts
 *   a text     ticking "Also send this as a text" says what it would do BEFORE
 *              anything is sent — and this spec never presses "Send + text":
 *              a test must not send anybody a text
 *
 * Every message carries a stamp of its own, so a conversation left by an
 * earlier run cannot be what an assertion found.
 *
 * One project. A conversation is not a layout; `layout.spec` measures these
 * two screens at every width.
 */

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const STAMP = Date.now().toString(36);
const ANNOUNCED = `Tee times move back ten minutes (${STAMP})`;
const ASKED = `Could you play at 8:10 instead? (${STAMP})`;
const ANSWERED = `Yes, 8:10 is fine (${STAMP})`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  await teardown();
});

async function device(browser: Browser, testInfo: TestInfo, baseURL: string, session: string) {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  await context.addCookies([
    { name: "ng_session", value: session, url: baseURL },
    { name: "ng_active_event", value: sign(club.landing.id), url: baseURL },
  ]);
  return context;
}

/** Open the messages screen fresh, and put away the one-time notice about data rates if it is up. */
async function inbox(page: Page, path: string) {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, `${path} was not opened`).toBe(path);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.count()) await gotIt.click();
}

/** The row in the list of conversations whose last message is the one given. */
const row = (page: Page, text: string) => page.getByRole("button").filter({ hasText: text });
/** A bubble in the open conversation. */
const bubble = (page: Page, text: string) => page.locator("[data-authored]").filter({ hasText: text });

test("the secretary tells the field and writes to one member; she reads both and answers", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one project: a conversation is not a layout");
  test.setTimeout(240_000);
  const errors: string[] = [];
  const hisDevice = await device(browser, testInfo, baseURL!, club.organizer.session);
  const herDevice = await device(browser, testInfo, baseURL!, club.player.session);
  try {
    const his = await hisDevice.newPage();
    const hers = await herDevice.newPage();
    watchPageErrors(his, errors, "secretary");
    watchPageErrors(hers, errors, "member");

    await test.step("he announces to the whole tournament — and is told what a text would do before sending one", async () => {
      await inbox(his, "/messages");
      await his.getByRole("button", { name: "New message" }).click();
      const group = his.getByLabel("Send to a group");
      const groups = await group.locator("option").allTextContents();
      expect(groups.length, "the secretary can write to no group at all").toBeGreaterThan(0);
      // It opens on THIS TOURNAMENT, not on the whole club: a message cannot be called back, and
      // the club is the first group in the list.
      expect(groups, "the whole club is not among the groups, so the default proves nothing").toContain("Everyone at the club");
      expect((await group.locator("option:checked").textContent())!.trim()).toBe("Everyone in this tournament");
      // The answer to "Who is this for?" is in words — and is a sentence. It read "Going to everyone
      // in Everyone at the club."
      const answer = his.locator("p").filter({ hasText: "Going to" });
      await expect(answer).toHaveText("Going to everyone in this tournament.");
      await group.selectOption({ label: "Everyone at the club" });
      await expect(answer).toHaveText("Going to everyone at the club.");
      await group.selectOption({ label: "Everyone in this tournament" });

      const body = his.getByPlaceholder("Message…");
      // Nothing typed: said, not sent.
      await his.getByRole("button", { name: "Send", exact: true }).click();
      await expect(his.getByText("Type a message first.")).toBeVisible();
      await body.fill(ANNOUNCED);
      // …and once a message IS typed, the card stops saying one is missing.
      await expect(his.getByText("Type a message first.")).toHaveCount(0);

      // "Also send this as a text": the estimate BEFORE the send. Nobody in the seeded club has
      // agreed to texts, so whatever it says, it must say something — and it is then unticked.
      const alsoText = his.getByRole("checkbox", { name: /Also send this as a text/ });
      if (await alsoText.count()) {
        await alsoText.check();
        await expect(his.getByRole("button", { name: "Send + text" })).toBeVisible();
        await expect(
          his.getByText(/Nobody has agreed to texts yet|billed|Text alerts aren.t switched on yet/i).first(),
          "ticking the box said nothing about what a text would do",
        ).toBeVisible({ timeout: 20_000 });
        await alsoText.uncheck();
      }
      await expect(his.getByRole("button", { name: "Send + text" })).toHaveCount(0);
      await his.getByRole("button", { name: "Send", exact: true }).click();
      // He is put in the conversation, with what he said in it as his.
      await expect(bubble(his, ANNOUNCED)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("she is shown it, unread, under his name — and cannot answer an announcement", async () => {
      await inbox(hers, "/me/messages");
      const announced = row(hers, ANNOUNCED);
      await expect(announced, "the member was not shown the announcement").toHaveCount(1, { timeout: 20_000 });
      await expect(announced.getByText("1", { exact: true }), "it is not marked unread").toBeVisible();
      await announced.click();
      await expect(bubble(hers, ANNOUNCED)).toBeVisible();
      await expect(hers.getByText("R. Ganizer").first(), "the announcement does not say who it is from").toBeVisible();
      const canAnswer = await hers.getByPlaceholder("Message…").count();
      if (canAnswer === 0) await expect(hers.getByText(/announcements only/)).toBeVisible();
    });

    await test.step("opened is read: after a reload it is no longer marked", async () => {
      await inbox(hers, "/me/messages");
      const announced = row(hers, ANNOUNCED);
      await expect(announced).toHaveCount(1);
      await expect(announced.getByText("1", { exact: true }), "a conversation she has opened is still unread").toHaveCount(0);
    });

    await test.step("he writes to her alone", async () => {
      await inbox(his, "/messages");
      await his.getByRole("button", { name: "New message" }).click();
      const one = his.getByLabel("…or send to one person");
      const her = await one.locator("option", { hasText: club.player.name }).getAttribute("value");
      expect(her, "the member is not somebody the secretary can write to").toBeTruthy();
      await one.selectOption(her!);
      await expect(his.locator("p").filter({ hasText: "Going to" }).locator("b")).toHaveText(club.player.name);
      await his.getByPlaceholder("Message…").fill(ASKED);
      await his.getByRole("button", { name: "Send", exact: true }).click();
      await expect(bubble(his, ASKED)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("she answers", async () => {
      await inbox(hers, "/me/messages");
      const asked = row(hers, ASKED);
      await expect(asked, "the member was not shown a message written to her alone").toHaveCount(1, { timeout: 20_000 });
      await expect(asked.getByText("1", { exact: true })).toBeVisible();
      await asked.click();
      await expect(bubble(hers, ASKED)).toBeVisible();
      await hers.getByPlaceholder("Message…").fill(ANSWERED);
      await hers.getByRole("button", { name: "Send", exact: true }).click();
      await expect(bubble(hers, ANSWERED)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("he is shown her answer, unread, under her name", async () => {
      await inbox(his, "/messages");
      const answered = row(his, ANSWERED);
      await expect(answered, "the secretary was not shown her answer").toHaveCount(1, { timeout: 20_000 });
      await expect(answered.getByText("1", { exact: true })).toBeVisible();
      await answered.click();
      await expect(bubble(his, ANSWERED)).toBeVisible();
      await expect(bubble(his, ASKED)).toBeVisible();
      // Her bubble carries her name; his own does not carry his.
      const theirs = his.locator("div").filter({ has: bubble(his, ANSWERED) }).last();
      await expect(theirs.getByText(club.player.name)).toBeVisible();
    });

    await test.step("her settings are hers, are kept, and can be turned back", async () => {
      for (const label of [/Don.t let other players message me directly/, /Also text me tournament announcements/]) {
        for (const on of [true, false]) {
          await inbox(hers, "/me/messages");
          await hers.getByRole("button", { name: "Message settings" }).click();
          const box = hers.getByRole("checkbox", { name: label });
          await expect(box, "the setting is not as it was left").toBeChecked({ checked: !on });
          // The box shows what is SAVED: it does not tick until the server has answered, so it is
          // pressed and then watched, not set.
          await box.click();
          await expect(box).toBeChecked({ checked: on, timeout: 20_000 });
          await expect(box).toBeEnabled({ timeout: 20_000 });
          await expect(hers.getByText(/Couldn.t save|nothing to save this against/)).toHaveCount(0);
          // Kept: read back from a fresh page, not from the tick she just made.
          await inbox(hers, "/me/messages");
          await hers.getByRole("button", { name: "Message settings" }).click();
          await expect(hers.getByRole("checkbox", { name: label }), `${String(label)} was not kept ${on ? "on" : "off"}`).toBeChecked({ checked: on });
        }
      }
    });
  } finally {
    await hisDevice.close();
    await herDevice.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
