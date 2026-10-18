import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A CLUB'S HANDICAP BODY FOLLOWS WHERE THE CLUB IS — ON EVERY SCREEN THAT NAMES IT.
 *
 * Ajay, 2026-10-17: "we need to add international bodies too … go with what
 * the golf clubs follow … make it geographical vs US enforced … it should be
 * part of the ongoing testing effort". In every WHS country a club's members
 * hold a number with its national body; a club in England was shown "GHIN
 * (USGA) only" and asked for a "GHIN #".
 *
 * For three places — England, nowhere said yet, the United States — the club's
 * country is set (in the database: the Branding form is not what is under
 * test), the secretary presses "<body> where a member has one" on Club
 * settings, and three screens are read:
 *
 *   Club settings   "Handicap body: <body>", the choice named for it, no picker
 *   the server      the body stored is the country's, whatever the page sent
 *   Members         the number box is the body's ("England Golf membership number (CDH)")
 *   Entries         the handicap-source choice is the body's, the number box too
 *
 * The CONTROL is the US club: GHIN is right there, so a screen that still said
 * GHIN everywhere would pass England's checks only if it also failed this one.
 *
 * WHAT IT CANNOT SEE: whether any body is CONNECTED — none is, and each says so
 * (`a-club-names-its-own-handicap-body.test.tsx` holds that).
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const prisma = new PrismaClient();
const FIELDS = { country: true, handicapPolicy: true, handicapAuthorityId: true } as const;

let clubId = "";
let was: { country: string; handicapPolicy: string; handicapAuthorityId: string } | null = null;
test.beforeAll(async () => {
  clubId = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true } })).organizationId!;
  was = await prisma.organization.findUniqueOrThrow({ where: { id: clubId }, select: FIELDS });
});
/** The fixture's club is every later spec's: it goes back exactly as it was. */
test.afterAll(async () => {
  if (clubId && was) await prisma.organization.update({ where: { id: clubId }, data: was });
  await prisma.$disconnect();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

const PLACES = [
  { country: "England", id: "england-golf", name: "England Golf", short: "England Golf", number: "England Golf membership number (CDH)" },
  { country: "", id: "national", name: "Your national association", short: "Association", number: "National association number" },
  { country: "United States", id: "ghin", name: "GHIN (USGA)", short: "GHIN", number: "GHIN number" },
] as const;

test("a club's handicap body follows its country on Club settings, Members and Entries — never assumed American", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: ORGANIZER });
  const page = await ctx.newPage();
  watchPageErrors(page, errors);
  try {
    for (const place of PLACES) {
      await test.step(`${place.country || "no country yet"} → ${place.name}`, async () => {
        await prisma.organization.update({ where: { id: clubId }, data: { country: place.country, handicapPolicy: "club", handicapAuthorityId: "ghin" } });

        await open(page, "/organization");
        const panel = page.locator("section.card", { has: page.locator(".card-title", { hasText: /^Handicaps$/ }) }).first();
        await expect(panel, "Club settings has no Handicaps panel").toBeVisible();
        await expect(panel).toContainText(`Handicap body: ${place.name}`);
        // Geographical, not picked.
        await expect(panel.locator("select")).toHaveCount(0);
        if (!place.country) await expect(panel).toContainText("add your club's country under Branding");

        await panel.getByRole("button", { name: `${place.short} where a member has one` }).click();
        await expect
          .poll(async () => prisma.organization.findUniqueOrThrow({ where: { id: clubId }, select: FIELDS }), {
            timeout: 20_000,
            message: "the choice was not stored, or stored another country's body",
          })
          .toMatchObject({ handicapPolicy: "hybrid", handicapAuthorityId: place.id });
        if (place.id !== "ghin") await expect(panel).not.toContainText("GHIN");

        await open(page, "/roster");
        await page.getByRole("button", { name: /Add member/ }).first().click();
        await expect(page.getByLabel(new RegExp(`^${place.number.replace(/[()]/g, "\\$&")}`, "i"))).toBeVisible();

        await open(page, "/registration");
        const add = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Add someone new$/ }) }).first();
        await expect(add.locator("label.seg-opt", { hasText: new RegExp(`^\\s*${place.short}\\s*$`) })).toBeVisible();
        await expect(add.getByText(new RegExp(`^${place.number.replace(/[()]/g, "\\$&")}$`, "i"))).toBeVisible();
        if (place.id !== "ghin") expect(await add.innerText(), "the Entries form still says GHIN").not.toMatch(/GHIN/);
      });
    }
  } finally {
    await ctx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
