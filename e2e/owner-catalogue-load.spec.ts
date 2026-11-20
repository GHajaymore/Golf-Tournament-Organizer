import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { E2E_OWNER_EMAIL } from "./owner-email.mjs";

/**
 * THE OWNER LOADS THE COURSE CATALOGUE (J29), AS THE OWNER DOES.
 *
 * Picks a small file on /owner (three courses: one clean, one whose stroke index is all zeros, one
 * GolfCourseAPI's) and reads the words beside the control, then the rows. A second pick of the same
 * file changes nothing. A stranger is told /owner is not there.
 *
 * Its own rows are marked `zz-catload-e2e-`; the owner's catalogue audit line is put back as it was.
 */
test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-catload-e2e-";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
let ownerCookie = "";
let logWas: { value: string } | null = null;

const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const course = (n: string, over: Record<string, unknown> = {}) => ({
  id: `${MARK}${n}`, name: `Zz Invented ${n}`, city: "Nowhere", state: "ZZ", country: "US", website: "", address: "",
  par: 72, pars: JSON.stringify(PARS), yards: "", strokeIndex: JSON.stringify(SI), tees: "[]", cardProblem: "", ...over,
});
const FILE = {
  name: "catalogue.json",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      format: "tourneyhq-catalogue", version: 1, count: 3, exportedFrom: "development",
      courses: [course("ok"), course("blank", { strokeIndex: JSON.stringify(PARS.map(() => 0)) }), course("gca", { id: "gca:zz-catload-e2e" })],
    }),
  ),
};

async function cleanup() {
  await prisma.courseCatalog.deleteMany({ where: { OR: [{ id: { startsWith: MARK } }, { id: "gca:zz-catload-e2e" }] } });
  await prisma.user.deleteMany({ where: { email: E2E_OWNER_EMAIL } });
}

test.beforeAll(async () => {
  await cleanup();
  logWas = await prisma.platformSetting.findUnique({ where: { key: "catalogue-load-log" }, select: { value: true } });
  const owner = await prisma.user.create({ data: { email: E2E_OWNER_EMAIL, name: "Zz Owner", password: "x:unusable" } });
  ownerCookie = sign(signedInNow(owner.id));
});

test.afterAll(async () => {
  try {
    if (logWas) await prisma.platformSetting.update({ where: { key: "catalogue-load-log" }, data: { value: logWas.value } });
    else await prisma.platformSetting.deleteMany({ where: { key: "catalogue-load-log" } });
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

test("the owner picks a catalogue file and reads what was loaded, skipped and refused", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "owner-catalogue");
  await page.context().addCookies([{ name: "ng_session", value: ownerCookie, url: baseURL! }]);
  await page.goto(`/owner?tab=content&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});

  await test.step("a first pick: one loaded, one skipped, one refused as GolfCourseAPI's", async () => {
    await page.locator("#catalogue-file").setInputFiles(FILE);
    await expect(page.getByRole("status").filter({ hasText: "1 loaded, 0 updated, 0 unchanged, 1 skipped (card refused), 1 refused (GolfCourseAPI)" })).toBeVisible({ timeout: 30_000 });
    expect(await prisma.courseCatalog.findUnique({ where: { id: `${MARK}ok` } })).not.toBeNull();
    expect(await prisma.courseCatalog.findUnique({ where: { id: `${MARK}blank` } })).toBeNull();
    expect(await prisma.courseCatalog.findUnique({ where: { id: "gca:zz-catload-e2e" } })).toBeNull();
  });

  await test.step("the same file again changes nothing", async () => {
    await page.locator("#catalogue-file").setInputFiles(FILE);
    await expect(page.getByRole("status").filter({ hasText: "0 loaded, 0 updated, 1 unchanged, 1 skipped (card refused), 1 refused (GolfCourseAPI)" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("a file that is not a catalogue is refused in words, and nothing is sent", async () => {
    await page.locator("#catalogue-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
    await expect(page.getByRole("alert").filter({ hasText: "not a catalogue file" })).toBeVisible({ timeout: 15_000 });
  });

  await test.step("somebody who is not signed in is told /owner is not there, and has no file control", async () => {
    await page.context().clearCookies();
    const res = await page.goto(`/owner?tab=content&bust=${Date.now()}`);
    expect(res?.status(), "a stranger was not refused /owner").toBe(404);
    await expect(page.locator("#catalogue-file")).toHaveCount(0);
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
