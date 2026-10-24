import { test, expect, type Browser, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes, scryptSync } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";

/**
 * SEVEN O'CLOCK ON THE MORNING OF THE TOURNAMENT, AND THE SECRETARY HAS NOT
 * SIGNED IN FOR EIGHT DAYS (the testing panel, 2026-10-23, item F1).
 *
 * The tournament director's case: the one person who must get in, at the one
 * time nobody is around to help. Their last sign-in was over a week ago, so the
 * server has ended it (`session-token.ts` holds a sign-in to seven days), and
 * they have picked up the clubhouse tablet — a device that has never seen them.
 * Every other spec starts already signed in, with a cookie made a second ago.
 *
 *   the old device, holding a cookie issued 8 days ago
 *     → turned to the front door, and the screen they asked for remembered
 *     CONTROL: the same person's cookie issued NOW opens that screen, so the
 *     refusal is the age of the cookie and nothing else
 *     → signs in with the password, and lands on the screen they asked for
 *   a NEW device, nothing in it, at 07:xx in the club's own time
 *     → the front door, the password, and the console of today's tournament
 *     → a fresh sign-in (issued this minute), no page error, one heading
 *
 * SEVEN IN THE MORNING WHEREVER IT IS RUN. `E2E_TZ` puts a whole run in one
 * zone; this needs an HOUR, so it finds a zone in which it is seven o'clock
 * right now (`E2E_TZ` itself, when it is seven there) and puts the club AND
 * both browsers in it, while the server stays where it is — the state
 * production is always in. A control asserts the browser really reads 7.
 *
 * THE PASSWORD PATH. A new-device code for organizers is ruled for after email
 * verification (the sign-in security plan) and is not on main; when it lands,
 * this spec is where its first step belongs.
 *
 * Its own club, an invented secretary, `@example.invalid`, deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = `zz-weekback-${process.pid}`;
const PASSWORD = "seven-Bells-before-the-1st-tee";
const DAY_MS = 24 * 60 * 60 * 1000;
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
/** The app's own stored form, "salt:hash" by scrypt (src/lib/auth.ts, which a spec cannot import: it is server-only). */
const hash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

/** A zone in which it is 07:xx right now. One per whole-hour offset from -11 to +14: one of them always is. */
const SEVEN_AM_ZONES = [
  "Pacific/Pago_Pago", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago",
  "America/New_York", "America/Halifax", "America/Sao_Paulo", "America/Noronha", "Atlantic/Azores", "Europe/London",
  "Europe/Paris", "Africa/Johannesburg", "Europe/Moscow", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Bangkok",
  "Asia/Singapore", "Asia/Tokyo", "Australia/Brisbane", "Pacific/Noumea", "Pacific/Auckland", "Pacific/Tongatapu", "Pacific/Kiritimati",
];
const hourIn = (zone: string, at = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(at));
const dayIn = (zone: string, at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
function sevenAmZone(): string {
  const asked = process.env.E2E_TZ;
  if (asked && hourIn(asked) === 7) return asked;
  // Real places first; then the fixed-offset zones, which have no summer time and so cover every
  // hour. The list of places alone does not: on 24 Oct 2026, with Europe and America both still on
  // summer time, no place in it was at UTC-9, UTC-1 or UTC+12, and the spec failed on main at that
  // hour (it had passed when written, at another). "Etc/GMT-5" is UTC+5 — the sign is inverted.
  const fixed = Array.from({ length: 27 }, (_, i) => i - 12).map((off) => (off === 0 ? "Etc/UTC" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`));
  const zone = [...SEVEN_AM_ZONES, ...fixed].find((z) => hourIn(z) === 7);
  if (!zone) throw new Error("no zone in the list is at seven o'clock — the list has lost an offset");
  return zone;
}

const ids = { org: "", event: "", secretary: "", owner: "" };
let zone = "";
const EMAIL = `${MARK}-secretary@example.invalid`;
const EVENT_NAME = `${MARK} Autumn Foursomes — Men’s & Ladies’`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  zone = sevenAmZone();
  const org = await prisma.organization.create({ data: { name: `${MARK} Golf Club`, kind: "club", timeZone: zone } });
  ids.org = org.id;
  // A club made through the app always has a Commissioner; the secretary is staff beside them.
  const owner = await prisma.user.create({ data: { email: `${MARK}-commissioner@example.invalid`, name: "Zz Weekback Commissioner", password: "x:unusable" } });
  ids.owner = owner.id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: "owner" } });
  // Last signed in eight days ago: the account is old, and nothing has ended its sessions since.
  const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);
  const secretary = await prisma.user.create({ data: { email: EMAIL, name: "Zz Weekback Secretary", password: hash(PASSWORD), sessionsValidFrom: eightDaysAgo } });
  ids.secretary = secretary.id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: secretary.id, role: "admin" } });
  const today = dayIn(zone);
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: EVENT_NAME,
      status: "live",
      format: "stroke",
      dates: "",
      startOn: today,
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-board`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  ids.event = event.id;
  await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", playedOn: today } });
  for (const [i, name] of ["Ailsa Brodie", "Calum Dunn", "Effie Grant", "Hamish Innes"].entries()) {
    await prisma.player.create({ data: { eventId: event.id, name, email: `${MARK}-p${i + 1}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 10 + i } });
  }
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** A browser at the club: its zone, a tablet's size, and nothing in it. */
async function device(browser: Browser) {
  return browser.newContext({ timezoneId: zone, viewport: { width: 820, height: 1180 }, hasTouch: true });
}

async function logIn(page: Page) {
  await landingSettled(page);
  await page.getByRole("tab", { name: "Log in", exact: true }).click();
  await page.getByPlaceholder("you@email.com").fill(EMAIL);
  await page.getByPlaceholder("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/** The session the browser now holds was issued in the last minute, to this person. */
async function freshSession(page: Page) {
  const cookie = (await page.context().cookies()).find((c) => c.name === "ng_session");
  expect(cookie, "no session after signing in").toBeTruthy();
  const value = decodeURIComponent(cookie!.value);
  const [who, stamp] = value.slice(0, value.lastIndexOf(".")).split("~");
  expect(who).toBe(ids.secretary);
  expect(Math.abs(Date.now() / 1000 - parseInt(stamp, 36)), "the session was not issued now").toBeLessThan(120);
}

test("a secretary eight days away, at seven in the morning, gets back in on the old device and on a new one", async ({ browser, baseURL, request }) => {
  test.setTimeout(150_000);
  const path = (p: Page) => new URL(p.url()).pathname;

  // ── the old device: a cookie from eight days ago ───────────────────────
  const stale = sign(signedInNow(ids.secretary, Date.now() - 8 * DAY_MS));
  const fresh = sign(signedInNow(ids.secretary));
  const opens = async (session: string) => (await request.get("/dashboard", { headers: { cookie: `ng_session=${session}` }, maxRedirects: 0 })).status();
  // CONTROL: the same person, the same signature, issued now — the refusal below is the age and nothing else.
  expect(await opens(fresh), "a cookie issued now does not open the console — the next assertion would prove nothing").toBe(200);
  expect(await opens(stale), "a sign-in eight days old still opens the console").toBe(307);

  const old = await device(browser);
  await old.addCookies([{ name: "ng_session", value: stale, url: baseURL! }]);
  const tablet = await old.newPage();
  const errors: string[] = [];
  watchPageErrors(tablet, errors, "old device");
  // CONTROL: this browser really is at seven in the morning at the club.
  await tablet.goto("/dashboard");
  expect(await tablet.evaluate(() => new Date().getHours()), `the browser is not at 7am in ${zone}`).toBe(7);
  expect(path(tablet), "an expired sign-in was let into the console").toBe("/");
  expect(new URL(tablet.url()).searchParams.get("next"), "where they were going was forgotten").toBe("/dashboard");
  await logIn(tablet);
  await tablet.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30_000 });
  await expect(tablet.locator("h1")).toHaveCount(1);
  await freshSession(tablet);
  await old.close();

  // ── a new device: nothing in it ────────────────────────────────────────
  const fresher = await device(browser);
  const page = await fresher.newPage();
  watchPageErrors(page, errors, "new device");
  await page.goto("/");
  expect(await page.evaluate(() => new Date().getHours())).toBe(7);
  await logIn(page);
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/choose", { timeout: 30_000 });
  expect(path(page), "the secretary did not land in the console").toBe("/dashboard");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByText(EVENT_NAME).first(), "the console is not today's tournament").toBeVisible();
  await freshSession(page);
  await fresher.close();

  expect(errors, "a screen threw in the browser").toEqual([]);
});
