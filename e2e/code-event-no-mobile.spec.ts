import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { watchPageErrors } from "./page-errors";

/**
 * A CODE-SCORED TOURNAMENT ON THE FREE PLAN TAKES A PLAYER WITHOUT A MOBILE,
 * AND ITS ROUNDS ARE NUMBERED DOWN THE SCREEN.
 *
 * Both found setting up a real two-team cup on 2026-10-17:
 *
 *   - the free plan asked a mobile of every entrant, and refused thirteen
 *     guests whose players would only ever use the round code. Since that day
 *     a tournament whose players sign in with codes asks for none (Ajay:
 *     "I dont understand why we need mobile number of other players");
 *   - the team-cup template made three sessions, the organizer removed the
 *     middle one, and Rounds & formats went on calling the last "Round 3"
 *     because it read the stored position, which keeps the gap.
 *
 *   added by name and handicap alone, code tournament  → in the field
 *   CONTROL: the same club's EMAIL tournament           → refused for the mobile
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

test("a free club's code tournament takes a player with no mobile; its email tournament does not", async ({ page, baseURL }) => {
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

  // CONTROL: the same club, a tournament signing players in by email, still asks.
  // Given an email, so the mobile is the ONLY thing missing — refused for the
  // address instead, this would pass whatever the rule said.
  await as(page, baseURL!, ids.email);
  await fillNew(page, "Zz Guest Mailer", `${MARK}-mailer@example.invalid`);
  await expect(page.getByText(/Mobile\s*·\s*required/)).toBeVisible();
  // The form will not even send it without the mobile.
  await expect(page.getByRole("button", { name: "Add to field" })).toBeDisabled();
  expect(await prisma.player.count({ where: { eventId: ids.email, name: "Zz Guest Mailer" } }), "the email tournament let a player in without a mobile").toBe(0);
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
