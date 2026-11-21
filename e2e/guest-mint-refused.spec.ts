import { test, expect } from "./coverage";
import { createHmac } from "node:crypto";
import { prisma, makeClub, dropClub, makeEvent, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { GUEST_WORDS } from "../src/lib/domain/guest-entry";
import { RATE_LIMITS } from "../src/lib/domain/rate-limit";

/**
 * A GUEST WHOSE DEVICE MINT IS REFUSED IS TOLD SO, WHERE THEY PRESSED (B96; QA gate 1 on PR #1199, condition 1).
 *
 * "Enter as a guest" makes the browser's signed device cookie (`startGuestEntry` -> `mintDevice`). While the platform alarm
 * (`guest-mint-alarm`, 300 an hour) stands, each client network is held to `guest-mint-slow` (twelve per fifteen minutes). A
 * network whose twelve are spent is refused: the guest sees the one limit sentence beside the button they pressed, the form
 * stays shut, no cookie is set and no entry is made.
 *
 * The counters are RateLimitHit rows keyed `<kind>:<HMAC of "client:<address>">:<window bucket>` (`clientKeyFor`); this spec
 * writes those two rows itself, for a made-up client address it sends as `x-forwarded-for` (so no other spec's network is
 * touched), and puts the alarm row back as it found it in a `finally`. The rows' keys cannot carry the `zz-` mark; the club,
 * the event and the address do not collide with anything real. CONTROL: with the slow row removed, the same press opens the
 * form and sets the cookie, so the refusal came from the counters and from nothing else.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against GuestEntryForm.tsx; CI runs it first.
 */

const ZONE = "UTC";
const MARK = "zz-guest-mint-refused";
const TOKEN = "ZZGUESTMINTREFUSED24TK";
const octet = () => Math.floor(Math.random() * 250) + 1;
const ADDRESS = `10.${77 + Math.floor(Math.random() * 100)}.${octet()}.${octet()}`;

type Kind = "guest-mint-alarm" | "guest-mint-slow";

/** `clientKeyFor(kind, address, now)`, worked here from its description: HMAC-SHA256 under the app secret, base64url. */
function keyFor(kind: Kind, address: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  const who = createHmac("sha256", secret).update(`client:${address.trim().toLowerCase()}`).digest("base64url");
  return `${kind}:${who}:${Math.floor(Date.now() / RATE_LIMITS[kind].windowMs)}`;
}
const expiry = (kind: Kind) => new Date((Math.floor(Date.now() / RATE_LIMITS[kind].windowMs) + 1) * RATE_LIMITS[kind].windowMs);

test.describe("a guest whose device mint is refused", () => {
  let club: Club;
  let eventId = "";

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Mint Outing", {
      status: "draft",
      stages: [{ playedOn: dayIn(ZONE, new Date(Date.now() + 30 * 86_400_000)), scoringBasis: "net" }],
      players: 2,
      event: { registrationOpen: true, registrationToken: TOKEN, guestEntryOpen: true, capacity: 64 },
    });
    eventId = made.event.id;
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("the refusal is said beside the button in words, the form stays shut, no cookie and no entry; lifted, the same press opens it", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const alarmKey = keyFor("guest-mint-alarm", "guest-mint-platform");
    const slowKey = keyFor("guest-mint-slow", ADDRESS);
    const priorAlarm = await prisma.rateLimitHit.findUnique({ where: { key: alarmKey } });
    const context = await browser.newContext({
      ...testInfo.project.use,
      baseURL: baseURL!,
      serviceWorkers: "block",
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "x-forwarded-for": ADDRESS },
    });
    const errors: string[] = [];
    try {
      const page = await context.newPage();
      watchPageErrors(page, errors, "refused guest");
      // The alarm stands (301 > 300) and this network's twelve are spent (the next mint is its thirteenth).
      await prisma.rateLimitHit.upsert({ where: { key: alarmKey }, create: { key: alarmKey, count: 301, expiresAt: expiry("guest-mint-alarm") }, update: { count: 301 } });
      await prisma.rateLimitHit.upsert({ where: { key: slowKey }, create: { key: slowKey, count: 12, expiresAt: expiry("guest-mint-slow") }, update: { count: 12 } });
      const before = await prisma.player.count({ where: { eventId } });

      await page.goto(`/register/${TOKEN}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const section = page.getByTestId("guest-entry");
      const name = section.getByLabel("Your name");
      const refusal = section.getByRole("alert").filter({ hasText: GUEST_WORDS.limit });
      // A press made before the page woke is not taken up; press until the sentence is drawn.
      await expect(async () => {
        await section.getByRole("button", { name: /Enter as a guest/ }).click({ timeout: 3_000 });
        await expect(refusal).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await expect(refusal, "the refusal is said where the press was, on screen").toBeInViewport();
      await expect(name, "the form stays shut").toHaveCount(0);
      await expect(section.getByRole("button", { name: /Enter as a guest/ }), "the guest can press again").toBeEnabled();
      expect((await context.cookies()).filter((c) => c.name === "ng_device"), "a refused mint sets no device cookie").toEqual([]);
      expect(await prisma.player.count({ where: { eventId } }), "a refused mint made an entry").toBe(before);
      expect(await prisma.player.count({ where: { eventId, status: "pending" } }), "a waiting row exists").toBe(0);

      // CONTROL: this network's counter lifted, the same press opens the form and sets the cookie.
      await prisma.rateLimitHit.deleteMany({ where: { key: slowKey } });
      await expect(async () => {
        await section.getByRole("button", { name: /Enter as a guest/ }).click({ timeout: 3_000 });
        await expect(name).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      expect((await context.cookies()).filter((c) => c.name === "ng_device").length, "the control mint set the cookie").toBe(1);
      expect(errors, "page errors while the mint was refused").toEqual([]);
    } finally {
      await context.close().catch(() => {});
      await prisma.rateLimitHit.deleteMany({ where: { key: slowKey } });
      if (priorAlarm) await prisma.rateLimitHit.update({ where: { key: alarmKey }, data: { count: priorAlarm.count } }).catch(() => {});
      else await prisma.rateLimitHit.deleteMany({ where: { key: alarmKey } });
    }
  });
});
