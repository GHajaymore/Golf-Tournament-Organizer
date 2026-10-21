import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, centre, saidBeside } from "./rounds-fixture";

/**
 * THE SECRETARY WRITES TO ONE FLIGHT SHE IS NOT IN — once in the app, once
 * "also as a text" — and the flight is told, and the other flight is not.
 *
 * `broadcastToScope` and `broadcastWithText` were performed by no browser test
 * (the reach baseline, 2026-10-21). A secretary who does not play is in no
 * flight, so the ordinary send is refused her and the screen sends it as a
 * broadcast — which is the path every non-playing secretary takes:
 *
 *   to Flight A      kept as a conversation of Flight A, under her name; a member
 *                    of Flight A is shown it, a member of Flight B is not
 *   too long         a message past the limit is refused beside Send, and
 *                    nothing is kept
 *   to Flight B,     the estimate is shown BEFORE the send; nobody in this club
 *   also as a text   has agreed to texts, so Send + text texts NOBODY (no
 *                    delivery is queued or sent — a test must never send a real
 *                    text) and the message is still kept for Flight B in the app
 *
 * WHAT IT CANNOT SEE: a text actually going out. That needs the provider, which
 * costs money per message; `messaging.audit.test.ts` holds the fan-out with the
 * provider stubbed.
 */

const WALKED = ["desktop", "phone"];
const markFor = (project: string) => `zz-maf-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-maf-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function inbox(page: Page, path: string) {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, `${path} was not opened — not signed in?`).toBe(path);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.count()) await gotIt.click();
}

const bubble = (page: Page, text: string) => page.locator("[data-authored]").filter({ hasText: text });
const row = (page: Page, text: string) => page.getByRole("button").filter({ hasText: text });

test("the secretary writes to a flight she is not in, in the app and as a text; only that flight is told", async ({ page, context, baseURL, browser }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor(testInfo.project.name);
  const club = await makeClub(mark);
  const stamp = Date.now().toString(36);
  const TO_A = `Flight A tees off from the 10th tomorrow (${stamp})`;
  const TO_B = `Flight B: buggies are on the main car park (${stamp})`;
  const ctxA = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  const ctxB = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    const { event, players, flights } = await makeEvent(club, "Autumn Fourball", { status: "live", stages: [{}], players: 4, flights: 2 });
    const [inA, inB] = [players[0], players[2]];
    const sessA = await memberSession(event.id, inA.email, inA.name);
    const sessB = await memberSession(event.id, inB.email, inB.name);
    await signIn(context, baseURL!, club, event.id);
    await signInWith(ctxA, baseURL!, sessA.session, event.id);
    await signInWith(ctxB, baseURL!, sessB.session, event.id);
    const memberA = await ctxA.newPage();
    const memberB = await ctxB.newPage();
    watchPageErrors(memberA, errors, "Flight A member");
    watchPageErrors(memberB, errors, "Flight B member");
    const threads = (groupId: string) =>
      prisma.thread.findMany({ where: { eventId: event.id, scopeKey: `flight:${groupId}` }, include: { messages: true } });

    const compose = async (flightName: string) => {
      await inbox(page, "/messages");
      await page.getByRole("button", { name: "New message" }).click();
      const group = page.getByLabel("Send to a group");
      const value = await group.locator("option", { hasText: flightName }).first().getAttribute("value");
      expect(value, `${flightName} is not somewhere the secretary can write to`).toBeTruthy();
      await group.selectOption(value!);
      return page.getByPlaceholder("Message…");
    };

    // ── too long: refused beside Send, nothing kept ──
    let body = await compose("Flight A");
    await body.fill("A".repeat(4001));
    const send = page.getByRole("button", { name: "Send", exact: true });
    await centre(send);
    await send.click();
    const refused = page.getByText("Keep it under 4000 characters.", { exact: true });
    await expect(refused, "a message past the limit was not refused in words").toBeVisible();
    await saidBeside(refused, send, "a message past the limit");
    expect(await threads(flights[0].id), "a refused message was kept").toHaveLength(0);

    // ── to Flight A, in the app ──
    await body.fill(TO_A);
    await send.click();
    await expect(bubble(page, TO_A), "the secretary is not put in the conversation she started").toBeVisible({ timeout: 20_000 });
    const keptA = await threads(flights[0].id);
    expect(keptA, "the message is not kept as Flight A's conversation").toHaveLength(1);
    expect(keptA[0].messages.map((m) => [m.body, m.authorName]), "the message is not under the secretary's name").toEqual([[TO_A, "Rowan Secretary"]]);

    await inbox(memberA, "/me/messages");
    await expect(row(memberA, TO_A), "a member of Flight A was not shown the message to Flight A").toHaveCount(1, { timeout: 20_000 });
    await inbox(memberB, "/me/messages");
    await expect(row(memberB, TO_A), "a member of Flight B was shown the message to Flight A").toHaveCount(0);

    // ── to Flight B, also as a text: the estimate first, and nobody texted ──
    expect(
      await prisma.member.count({ where: { organizationId: club.orgId, smsOptIn: true } }),
      "somebody in this club has agreed to texts — this test must not send one",
    ).toBe(0);
    body = await compose("Flight B");
    await body.fill(TO_B);
    const alsoText = page.getByRole("checkbox", { name: /Also send this as a text/ });
    await expect(alsoText, "a flight is not offered as somewhere a text can go").toBeVisible();
    await alsoText.check();
    await expect(
      page.getByText(/Nobody has agreed to texts yet|Text messages aren.t set up|Text alerts aren.t switched on yet/).first(),
      "ticking the box said nothing about what a text would do",
    ).toBeVisible({ timeout: 20_000 });
    const sendText = page.getByRole("button", { name: "Send + text", exact: true });
    await centre(sendText);
    await sendText.click();
    await expect(bubble(page, TO_B)).toBeVisible({ timeout: 20_000 });
    const keptB = await threads(flights[1].id);
    expect(keptB.flatMap((t) => t.messages.map((m) => m.body)), "the message to Flight B is not kept for Flight B").toEqual([TO_B]);
    expect(
      await prisma.smsDelivery.count({ where: { organizationId: club.orgId, status: { in: ["queued", "sent", "failed"] } } }),
      "a text was queued or sent to somebody who never agreed to texts",
    ).toBe(0);

    await inbox(memberB, "/me/messages");
    await expect(row(memberB, TO_B), "a member of Flight B was not shown the message to Flight B").toHaveCount(1, { timeout: 20_000 });
    await inbox(memberA, "/me/messages");
    await expect(row(memberA, TO_B), "a member of Flight A was shown the message to Flight B").toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
    await prisma.smsDelivery.deleteMany({ where: { organizationId: club.orgId } }).catch(() => {});
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
