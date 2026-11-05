import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { roundShareMessage } from "../src/lib/domain/share-message";

/**
 * SHARE A ROUND'S CODE, FROM THE ORGANIZER'S SCREEN (2026-11-05).
 *
 * The Round Codes section has a Share button beside Copy. The message is the
 * domain's own sentence (`roundShareMessage`): "Scoring for <event>, <round>:
 * tap <link> — or open <host>/play and type <CODE>". Pressed as the organizer:
 *
 *   a phone with a share sheet   `navigator.share` is called with that message
 *                                (stubbed here to record the call — a real sheet
 *                                is the phone's, not ours)
 *   a browser without one        the button says "Copy message", and pressing it
 *                                copies exactly that message to the clipboard
 *
 * The section also says not to post it publicly. The expected text is built from
 * the same function the page uses, over the event's name, the row's own round
 * label and the page's own origin — so the host is the real one, not a fixed domain.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string } };
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

let was: { how: string; accessCode: string } | null = null;
test.beforeAll(async () => {
  const how = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playerAccess: true } })).playerAccess;
  const accessCode = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  was = { how, accessCode };
  await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: "both" } });
  if (!accessCode) await prisma.stage.update({ where: { id: stageId }, data: { accessCode: "ZZSH2346" } });
});
test.afterAll(async () => {
  if (was) {
    await prisma.stage.update({ where: { id: stageId }, data: { accessCode: was.accessCode } });
    await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: was.how } });
  }
  await prisma.$disconnect();
});

async function codesRow(page: import("@playwright/test").Page) {
  const code = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  const shown = `${code.slice(0, 4)}-${code.slice(4)}`;
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const panel = page.locator("div", { has: page.locator(".card-title", { hasText: /^Round Codes$/ }) }).last();
  const row = panel.locator("tr", { hasText: shown });
  await expect(row, "the codes panel has no row for the round's code").toHaveCount(1, { timeout: 20_000 });
  const label = (await row.locator("td").first().innerText()).trim();
  const eventName = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { name: true } })).name;
  return { panel, row, code, shown, label, eventName };
}

test("Share hands the sentence to the phone's share sheet", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  // Recorded, not shown: the share sheet belongs to the phone.
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: Array<{ title?: string; text?: string; url?: string }> };
    w.__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (d: { title?: string; text?: string; url?: string }) => void w.__shared.push(d) });
  });
  const { panel, row, code, label, eventName } = await codesRow(page);

  // It says what the button does, and that the message is not for a public page.
  await expect(panel).toContainText("don't post it publicly");
  const share = row.getByRole("button", { name: /^Share the .* code$/ });
  await expect(share, "the row has no Share beside Copy").toBeVisible();
  await expect(share).toHaveText(/^\s*Share\s*$/);
  await expect(row.getByRole("button", { name: /^Copy$|^Copied$/ }), "Copy went").toBeVisible();

  const want = roundShareMessage({ eventName, roundLabel: label, code, link: `${new URL(baseURL!).origin}/play#${code.slice(0, 4)}-${code.slice(4)}` });
  await share.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length), { message: "Share never reached the share sheet" }).toBe(1);
  const sent = await page.evaluate(() => (window as unknown as { __shared: Array<{ text?: string; url?: string }> }).__shared[0]);
  expect(sent.text, "the shared text is not the domain's message").toBe(want);
  // The link is IN the sentence; a second `url` would be pasted twice by some apps.
  expect(sent.url).toBeUndefined();
  // The real host, and the way in by hand.
  expect(sent.text).toContain(`or open ${new URL(baseURL!).host}/play and type ${code.slice(0, 4)}-${code.slice(4)}`);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("without a share sheet the button is Copy message, and copies the same sentence", async ({ page, context, baseURL, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium's to grant");
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
  // A desktop browser with no share sheet.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  });
  const { row, code, label, eventName } = await codesRow(page);
  const copy = row.getByRole("button", { name: /^Copy a message with the .* code$/ });
  await expect(copy).toHaveText(/Copy message/);
  const want = roundShareMessage({ eventName, roundLabel: label, code, link: `${new URL(baseURL!).origin}/play#${code.slice(0, 4)}-${code.slice(4)}` });
  await copy.click();
  await expect(copy, "the button did not say the message was copied").toHaveText(/Message copied/);
  expect(await page.evaluate(() => navigator.clipboard.readText()), "the clipboard does not hold the domain's message").toBe(want);
  expect(errors, errors.join("\n")).toEqual([]);
});
