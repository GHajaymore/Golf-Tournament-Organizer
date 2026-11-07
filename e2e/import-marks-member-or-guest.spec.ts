import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * AN ENTRY LIST SAYS MEMBER OR GUEST, AND THE ORGANIZER CHECKS IT FIRST (the no-email player
 * identity, PR 1; Ajay's CSV default, 2026-11-07).
 *
 * The organizer imports a list of six on Entries. `previewCsvSignups` shows each row before
 * anything is entered ("Check the list"), with Ajay's default and its Check flags:
 *
 *   row                                  default   flag
 *   Ann: an email                        Member    —
 *   Ben: no email, a handicap ID         Member    "No email, but has a handicap ID"
 *   Cleo: no email, named on the roster  Member    "Same name as a member on your roster"
 *   Dev: no email, nothing else          Guest     —
 *   Eve: the file says guest             Guest     —
 *   Fay: the file says member            Member    —
 *
 * The organizer switches two rows (Ben → guest, Dev → member) and imports; `importCsvSignups`
 * stores each standing as switched, and the field shows the tags. Break `defaultStanding` and the
 * preview's first assertions go red.
 *
 * Its own club and tournament (`zz-guest1`); the roster member Cleo is made here. Deleted after.
 */

const prisma = new PrismaClient();
const MARK = "zz-guest1";
const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { organizer: { session: string } };
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

const ids = { org: "", event: "" };
const n = (who: string) => `${MARK} ${who}`;

const CSV = [
  "name,email,handicap,handicap id,member or guest",
  `${n("Ann Email")},${MARK}-ann@example.invalid,10.2,,`,
  `${n("Ben Id")},,12,1234567,`,
  `${n("Cleo Roster")},,8,,`,
  `${n("Dev Nothing")},,20,,`,
  `${n("Eve Written")},,5,,guest`,
  `${n("Fay Written")},,7,,member`,
].join("\n");

test.beforeAll(async () => {
  const admin = { userId: data.organizer.session.split("~")[0] };
  await prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { id: true } });
  const org = await prisma.organization.create({ data: { name: `${MARK} import club ${Date.now()}`, kind: "club" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "free" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: admin.userId, role: "admin" } });
  // A member on the club's roster with no email: the third row's name matches them.
  await prisma.member.create({ data: { organizationId: org.id, name: n("Cleo Roster"), handicap: 8 } });
  const token = `${MARK}-import-${Date.now()}`;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Spring Mixed`,
      status: "draft",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${token}-share`,
      registrationToken: token,
    },
  });
  ids.event = event.id;
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: ids.org } });
      await prisma.subscription.deleteMany({ where: { organizationId: ids.org } });
      // The roster rows (Cleo, and those the import made) go with the club.
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("a mixed list is checked, two rows are switched, and the import stores each standing", async ({ page, context, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await context.addCookies([{ name: "ng_active_event", value: sign(ids.event), url: baseURL! }]);
  // The fixture's facts, read: an empty field and Cleo on the roster with no email.
  expect(await prisma.player.count({ where: { eventId: ids.event } })).toBe(0);
  expect((await prisma.member.findFirstOrThrow({ where: { organizationId: ids.org, name: n("Cleo Roster") } })).email).toBe("");

  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("button", { name: "Download template" })).toBeVisible({ timeout: 20_000 });
  // The hint beside the import, and on Add above it.
  await expect(page.getByTestId("standing-hint")).toHaveCount(2);

  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({
    name: `${MARK}-list.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  const preview = page.getByTestId("csv-preview");
  await expect(preview.getByText("Check the list")).toBeVisible({ timeout: 20_000 });
  // Nothing is entered by looking.
  expect(await prisma.player.count({ where: { eventId: ids.event } })).toBe(0);

  const row = (who: string) => preview.locator("tr", { hasText: n(who) });
  const standingOf = (who: string) => row(who).locator("[data-standing]");
  // Ajay's default, row by row.
  await expect(standingOf("Ann Email")).toHaveAttribute("data-standing", "member");
  await expect(standingOf("Ben Id")).toHaveAttribute("data-standing", "member");
  await expect(row("Ben Id")).toContainText("Check: No email, but has a handicap ID");
  await expect(standingOf("Cleo Roster")).toHaveAttribute("data-standing", "member");
  await expect(row("Cleo Roster")).toContainText("Check: Same name as a member on your roster");
  await expect(standingOf("Dev Nothing")).toHaveAttribute("data-standing", "guest");
  await expect(standingOf("Eve Written")).toHaveAttribute("data-standing", "guest");
  await expect(standingOf("Fay Written")).toHaveAttribute("data-standing", "member");
  await expect(preview.getByRole("status")).toHaveText("4 members (2 to check), 2 guests.");
  // The handicap ID is shown masked: enough to recognise.
  await expect(row("Ben Id")).toContainText("•••4567");

  // The organizer switches two rows.
  await row("Ben Id").getByRole("button", { name: /^Make guest/ }).click();
  await row("Dev Nothing").getByRole("button", { name: /^Make member/ }).click();
  await expect(standingOf("Ben Id")).toHaveAttribute("data-standing", "guest");
  await expect(standingOf("Dev Nothing")).toHaveAttribute("data-standing", "member");
  await expect(preview.getByRole("status")).toHaveText("4 members (1 to check), 2 guests.");

  await preview.getByRole("button", { name: "Import 6 players" }).click();
  const stored = async () =>
    Object.fromEntries(
      (await prisma.player.findMany({ where: { eventId: ids.event }, select: { name: true, standing: true } })).map((p) => [p.name, p.standing]),
    );
  await expect.poll(stored, { timeout: 20_000, message: "the import did not store the standings as checked" }).toEqual({
    [n("Ann Email")]: "member",
    [n("Ben Id")]: "guest",
    [n("Cleo Roster")]: "member",
    [n("Dev Nothing")]: "member",
    [n("Eve Written")]: "guest",
    [n("Fay Written")]: "member",
  });
  // The handicap ID column, under its new heading, is kept on the entry.
  expect((await prisma.player.findFirstOrThrow({ where: { eventId: ids.event, name: n("Ben Id") } })).ghin).toBe("1234567");
  // A guest's entry holds no email; a member's keeps theirs.
  expect((await prisma.player.findFirstOrThrow({ where: { eventId: ids.event, name: n("Ann Email") } })).email).toBe(`${MARK}-ann@example.invalid`);

  await expect(preview).toHaveCount(0);
  await expect(page.getByText(/Imported 6 \(4 members, 2 guests\)/)).toBeVisible({ timeout: 15_000 });
  const fieldRow = (who: string) => page.getByRole("row", { name: new RegExp(n(who)) });
  await expect(fieldRow("Eve Written").locator('[data-standing="guest"]')).toHaveText("Guest", { timeout: 15_000 });
  await expect(fieldRow("Fay Written").locator('[data-standing="member"]')).toHaveText("Member");
  await expect(fieldRow("Fay Written").getByText("No email yet")).toBeVisible();
  expect(errors).toEqual([]);
});
