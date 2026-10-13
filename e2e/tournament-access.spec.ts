import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A HELPER IS LET INTO A TOURNAMENT, MOVED DOWN TO A PLAYER, AND SHOWN THE DOOR.
 *
 * Who may open the console is the organizer's to say, on the Access screen:
 * `addAccount`, `setAccountRole`, `removeAccount`. Every one of them is tried
 * by a stranger and refused (`every-action-vs-a-stranger`) — and none was ever
 * performed by the organizer, with the result checked from the OTHER side
 * (round 1 on the frozen app, 2026-10-13). A grant that grants nothing, or a
 * removal that leaves the door open, would both have passed.
 *
 * So the helper has a browser of their own, and after each thing the organizer
 * does, the helper asks for the console's Registration screen — a screen an
 * assistant may open and a player may not:
 *
 *   before anything                        → turned away (the control: holding the
 *                                             right cookies is not being let in)
 *   added as an assistant                  → Registration opens
 *   made a player — asked first            → turned away from the console
 *   made an assistant again                → opens again
 *   access removed — asked first           → turned away, and the row has gone
 *
 * And the organizer cannot shut themselves out: the only organizer is warned
 * that making themselves a player will be refused, and it is.
 *
 * WHAT IT CANNOT SEE: the email an invited person is sent.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const MARK = "zz-access";
const HELPER = { name: `${MARK} Robin Helper`, email: `${MARK}-helper@example.invalid` };
const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

async function sweep() {
  await prisma.account.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}
let helperSession = "";
test.beforeAll(async () => {
  await sweep();
  const user = await prisma.user.create({ data: { email: HELPER.email, name: HELPER.name, password: "x:unusable" } });
  helperSession = sign(signedInNow(user.id));
});
test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

const account = () => prisma.account.findFirst({ where: { eventId: data.eventId, email: HELPER.email } });

/** What the helper gets when they ask for the console's Registration screen: "in", or where they were sent instead. */
async function asks(page: Page): Promise<string> {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const path = new URL(page.url()).pathname;
  if (path !== "/registration") return `sent to ${path}`;
  return (await page.getByRole("heading", { level: 1 }).count()) ? "in" : "a screen with no heading";
}

test("the organizer lets a helper in, makes them a player, lets them back in and removes them — and the helper's own browser agrees each time", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const helper = await browser.newContext({ ...device, baseURL, storageState: undefined });
  await helper.addCookies([
    { name: "ng_session", value: helperSession, url: baseURL! },
    { name: "ng_active_event", value: sign(data.eventId), url: baseURL! },
  ]);
  try {
    const desk = await organizer.newPage();
    const theirs = await helper.newPage();
    watchPageErrors(desk, errors);
    watchPageErrors(theirs, errors);
    const access = async () => {
      await desk.goto(`/access?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
    };
    const row = () => desk.locator("tr", { hasText: HELPER.email });

    // ── holding the cookies is not being let in ─────────────────────────────
    expect(await asks(theirs), "CONTROL: somebody with no access was let into the console").not.toBe("in");

    // ── added as an assistant ───────────────────────────────────────────────
    await access();
    const add = desk.locator(".card", { has: desk.locator(".card-title", { hasText: "Add account" }) }).last();
    await add.getByLabel("Name").fill(HELPER.name);
    await add.getByLabel("Email").fill(HELPER.email);
    await add.locator("label.seg-opt", { hasText: /^\s*Assistant\s*$/ }).click();
    await add.getByRole("button", { name: "Add account" }).click();
    await expect.poll(async () => (await account())?.role, { timeout: 20_000, message: "the helper was not added" }).toBe("assistant");
    expect(await asks(theirs), "an assistant cannot open the console they were just given").toBe("in");

    // ── made a player: asked first ──────────────────────────────────────────
    await access();
    await row().locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).click();
    expect((await account())?.role, "one press changed somebody's role without asking").toBe("assistant");
    await row().getByRole("button", { name: /^Yes — make / }).click();
    await expect.poll(async () => (await account())?.role, { timeout: 20_000, message: "the role was not changed" }).toBe("player");
    expect(await asks(theirs), "somebody made a player can still open the console").not.toBe("in");

    // ── and back ────────────────────────────────────────────────────────────
    await access();
    await row().locator("label.seg-opt", { hasText: /^\s*Assistant\s*$/ }).click();
    await row().getByRole("button", { name: /^Yes — make / }).click();
    await expect.poll(async () => (await account())?.role, { timeout: 20_000 }).toBe("assistant");
    expect(await asks(theirs), "an assistant made one again is still shut out").toBe("in");

    // ── the organizer cannot shut themselves out ────────────────────────────
    await access();
    const admins = await prisma.account.findMany({ where: { eventId: data.eventId, role: "admin" } });
    if (admins.length === 1) {
      const own = desk.locator("tr", { hasText: admins[0].email });
      await own.locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).click();
      // Told before they press, and refused when they do: the screen says which, in words, both times.
      await expect(own, "the only organizer is not warned that this will be refused").toContainText(/This is the only .+ on the event — promote someone else first/);
      await own.getByRole("button", { name: /^Yes — make / }).click();
      await expect(desk.getByText(/This is the only .+ on this event — promote someone else first\./), "the refusal is not said in words").toBeVisible({ timeout: 20_000 });
      expect((await prisma.account.findFirstOrThrow({ where: { id: admins[0].id } })).role, "the only organizer was made a player").toBe("admin");
    }

    // ── removed: asked first ────────────────────────────────────────────────
    await access();
    await row().getByRole("button", { name: `Remove ${HELPER.name}'s access` }).click();
    expect(await account(), "one press removed somebody's access without asking").not.toBeNull();
    await row().getByRole("button", { name: "Remove access" }).click();
    await expect.poll(account, { timeout: 20_000, message: "the access was not removed" }).toBeNull();
    expect(await asks(theirs), "somebody whose access was removed can still open the console").not.toBe("in");
    await access();
    await expect(row(), "a removed helper is still listed").toHaveCount(0);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, helper].map((c) => c.close()));
  }
});
