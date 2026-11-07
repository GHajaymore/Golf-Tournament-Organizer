import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { openSettingsTab } from "./settings-tabs";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE CLUB THAT WAS HERE FIRST IS TOLD, IN THE APP (Ajay, 7 Nov 2026).
 *
 * A second organizer names their first tournament's club after one that already exists, is asked,
 * and answers "mine is a different one". Until now the existing club never heard. Done as the two
 * people who would:
 *
 *   the newcomer   names the club, is asked, presses "Create a separate … anyway"
 *   the Commissioner  opens Club settings: the Staff & access tab says one is waiting; the card
 *                  names the new club, its founder and the day, with no email address in it;
 *                  presses Dismiss, and it leaves, and stays gone on a reload
 *
 * Each outcome is read back from the rows too. WHAT IT CANNOT SEE: that no email is sent (no mail
 * leaves a test; the audit test pins that), and the refusal to another club's staff (audit test).
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-namesake";
const CLUB = `${MARK} Oakmere Golf Club`;
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const ids = { org: "", event: "", owner: "", newcomer: "" };
const cookies = { owner: "", newcomer: "" };

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const theirs = await prisma.organizationMember.findMany({ where: { userId: { in: userIds } }, select: { organizationId: true } });
  const orgIds = [...new Set(theirs.map((m) => m.organizationId))];
  await prisma.event.deleteMany({ where: { OR: [{ name: { startsWith: MARK } }, { organizationId: { in: orgIds } }] } });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { OR: [{ name: { startsWith: MARK } }, { id: { in: orgIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: CLUB, kind: "club", city: "Oakmere", region: "Cheshire" } });
  ids.org = org.id;
  const run = Date.now().toString(36);
  const user = (who: string, name: string) =>
    prisma.user.create({ data: { email: `${MARK}-${who}-${run}@example.invalid`, name, password: "x:unusable", emailVerifiedAt: new Date() } });
  const owner = await user("secretary", "Zz Secretary");
  const newcomer = await user("newcomer", "Zz Newcomer");
  ids.owner = owner.id;
  ids.newcomer = newcomer.id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: "owner" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${MARK} Club Medal`, status: "draft", shape: "single", format: "stroke",
      dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${MARK}-${Date.now()}`,
    },
  });
  ids.event = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: owner.email, name: "Zz Secretary", role: "admin" } });
  cookies.owner = sign(signedInNow(owner.id));
  cookies.newcomer = sign(signedInNow(newcomer.id));
});

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, baseURL: string, session: string, eventId?: string) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: session, url: baseURL },
    ...(eventId ? [{ name: "ng_active_event", value: sign(eventId), url: baseURL }] : []),
  ]);
}

test("a second club takes the name; the first club's Commissioner is told in the app and dismisses it", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "namesake");

  await test.step("the newcomer names the club, is asked, and carries on with a separate one", async () => {
    await signIn(page, baseURL!, cookies.newcomer);
    await page.goto(`/choose?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Tournament name").fill(`${MARK} Spring Cup`);
    await page.getByRole("button", { name: /^A single round/ }).click();
    await page.getByLabel(/Who.s running this\?/).fill(CLUB);
    // A club, not the default outing: a personal workspace named like a club is nobody's club (it starts no notice).
    await page.getByRole("radiogroup", { name: "What kind of outfit runs it" }).getByText(/club/i).first().click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    const carryOn = page.getByRole("button", { name: /^Create a separate / });
    await expect(carryOn, "the newcomer was not asked about the club that exists").toBeVisible({ timeout: 20_000 });
    await carryOn.click();
    await expect.poll(() => prisma.namesakeNotice.count({ where: { organizationId: ids.org } }), { timeout: 30_000 }).toBe(1);
  });

  await test.step("the Commissioner sees it on Staff & access, worded with a name and no email", async () => {
    await signIn(page, baseURL!, cookies.owner, ids.event);
    await page.goto(`/organization?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByRole("tab", { name: /^Staff & access \(1 waiting\)/ }), "the tab does not say one is waiting").toBeVisible();
    await openSettingsTab(page, "Staff & access");
    const card = page.getByTestId("namesake-notices");
    await expect(card).toContainText("Same name nearby (1)");
    await expect(card).toContainText(`“${CLUB}”`);
    await expect(card).toContainText("was set up on");
    await expect(card).toContainText("by Zz Newcomer");
    expect(await card.innerText(), "an email address was shown").not.toContain("@");
  });

  await test.step("Dismiss takes it away, for good", async () => {
    await page.getByTestId("namesake-notices").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("namesake-notices")).toHaveCount(0, { timeout: 20_000 });
    expect((await prisma.namesakeNotice.findFirst({ where: { organizationId: ids.org } }))?.status).toBe("dismissed");
    await page.goto(`/organization?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await openSettingsTab(page, "Staff & access");
    await expect(page.getByTestId("namesake-notices"), "a dismissed notice came back").toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Staff & access$/ })).toBeVisible();
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
