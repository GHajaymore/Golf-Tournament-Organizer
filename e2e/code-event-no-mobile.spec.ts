import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { watchPageErrors } from "./page-errors";

/**
 * A FREE CLUB'S TOURNAMENT TAKES A PLAYER WITHOUT A MOBILE UNLESS ITS
 * ORGANIZER ASKS FOR ONE, AND ITS ROUNDS ARE NUMBERED DOWN THE SCREEN.
 *
 * Both found setting up a real two-team cup on 2026-10-17:
 *
 *   - the free plan asked a mobile of every entrant, and refused thirteen
 *     guests whose players would only ever use the round code. That day a
 *     tournament whose players sign in with codes stopped asking (Ajay:
 *     "I dont understand why we need mobile number of other players"); since
 *     2026-10-21 (decisions review A7) no tournament on any plan asks unless
 *     its organizer ticks "Require a mobile number", and one that does asks
 *     whatever the sign-in;
 *   - the team-cup template made three sessions, the organizer removed the
 *     middle one, and Rounds & formats went on calling the last "Round 3"
 *     because it read the stored position, which keeps the gap.
 *
 *   added by name and handicap alone, code tournament  → in the field
 *   the same club's EMAIL tournament, given an email   → in the field (A7)
 *   CONTROL: the code tournament once it asks          → "· required", Add waits
 *   rounds stored at positions 0 and 2                  → "Round 1", "Round 2"
 *
 * Its own club on the free plan, two tournaments, invented names, deleted
 * afterwards. WHAT IT CANNOT SEE: the public sign-up form (it follows the same
 * `phoneRequiredFor`, and `phone-required.test.ts` pins the rule itself).
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-code-no-mobile";
const ids = { org: "", code: "", email: "", user: "" };
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "free" } });
  const event = (name: string, playerAccess: string) =>
    prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${MARK} ${name}`,
        status: "draft",
        format: "match",
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${MARK}-${name.toLowerCase()}`,
        playerAccess,
      },
    });
  const code = await event("Cup", "both");
  const email = await event("Medal", "email");
  ids.code = code.id;
  ids.email = email.id;
  // Two rounds left after the middle one of three was removed: positions 0 and 2.
  for (const [position, format] of [[0, "Four-Ball"], [2, "Match Play"]] as const) {
    await prisma.stage.create({ data: { eventId: code.id, position, type: "Team Session", format, holes: 9 } });
  }
  const user = await prisma.user.create({ data: { email: `${MARK}-organizer@example.invalid`, name: "Zz Organizer", password: "x:unusable" } });
  ids.user = user.id;
  for (const e of [code, email]) {
    await prisma.account.create({ data: { eventId: e.id, name: "Zz Organizer", email: user.email, role: "admin" } });
  }
});

test.afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { id: { in: [ids.code, ids.email].filter(Boolean) } } });
    await prisma.member.deleteMany({ where: { organizationId: ids.org } });
    if (ids.org) {
      await prisma.subscription.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  } finally {
    await prisma.$disconnect();
  }
});

async function as(page: import("@playwright/test").Page, baseURL: string, eventId: string) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: sign(signedInNow(ids.user)), url: baseURL },
    { name: "ng_active_event", value: sign(eventId), url: baseURL },
  ]);
}

async function fillNew(page: import("@playwright/test").Page, name: string, email = "") {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Player name").fill(name);
  if (email) await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel("Handicap", { exact: true }).fill("12");
}

test("a free club's tournaments take a player with no mobile, code or email, until the organizer asks for one", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await as(page, baseURL!, ids.code);
  await fillNew(page, "Zz Guest Coder");
  // The form does not call the mobile required where the server will not insist.
  await expect(page.getByText(/Mobile\s*·\s*required/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add to field" }).click();
  await expect
    .poll(() => prisma.player.count({ where: { eventId: ids.code, name: "Zz Guest Coder" } }), {
      timeout: 15_000,
      message: "a code tournament on the free plan refused a player for having no mobile",
    })
    .toBe(1);

  // The same club, a tournament signing players in by email: since A7 it does
  // not ask either. Given an email, so the mobile is the ONLY thing missing.
  await as(page, baseURL!, ids.email);
  await fillNew(page, "Zz Guest Mailer", `${MARK}-mailer@example.invalid`);
  await expect(page.getByText(/Mobile\s*·\s*required/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add to field" }).click();
  await expect
    .poll(() => prisma.player.count({ where: { eventId: ids.email, name: "Zz Guest Mailer" } }), {
      timeout: 15_000,
      message: "an email tournament on the free plan refused a player for having no mobile",
    })
    .toBe(1);

  // CONTROL: once the organizer asks, the code tournament asks too — the rule
  // is the setting, whatever the sign-in. Without this, a form that never asked
  // anybody would pass both cases above.
  await prisma.event.update({ where: { id: ids.code }, data: { requirePhone: true } });
  try {
    await as(page, baseURL!, ids.code);
    await fillNew(page, "Zz Guest Asked");
    await expect(page.getByText(/Mobile\s*·\s*required/)).toBeVisible();
    // The form will not even send it without the mobile.
    await expect(page.getByRole("button", { name: "Add to field" })).toBeDisabled();
    expect(await prisma.player.count({ where: { eventId: ids.code, name: "Zz Guest Asked" } }), "a tournament that asks let a player in without a mobile").toBe(0);
  } finally {
    await prisma.event.update({ where: { id: ids.code }, data: { requirePhone: false } });
  }
  expect(errors).toEqual([]);
});

test("rounds are numbered down the screen, not by the gap a removed round left", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await as(page, baseURL!, ids.code);
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // The round cards' own headings: "Round N · <type>" while a round has no day.
  await expect(page.getByText("Round 1 · Team Session", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Round 2 · Team Session", { exact: true })).toBeVisible();
  await expect(page.getByText("Round 3 · Team Session", { exact: true })).toHaveCount(0);
});
