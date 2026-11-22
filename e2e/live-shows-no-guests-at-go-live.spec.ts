import { randomBytes } from "node:crypto";
import { test, expect, type Browser } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, NAMES, type Club } from "./rounds-fixture";

/**
 * WHEN SIGN-INS GO FROM HELD TO LIVE, THE PUBLIC BOARD AND ITS SHARE IMAGE STILL SHOW NO GUEST (B97; the Security Lead's
 * condition 3 on #1191, guest entry on the one sign-up link).
 *
 * A guest who has asked to play and not been approved takes no place and is on no list a stranger can read. Going live opens
 * every held page to the world, so this is the moment a leak would be noticed least: the public leaderboard (`/live/<token>`),
 * the event page it links to (`/live/<token>/event`, which says "N places left") and the picture that unfurls when the link
 * is shared (`/live/<token>/opengraph-image`) must say nothing about who is waiting or how many. The only figure about entries
 * a stranger may read is "places left", and it is the same with three guests waiting as with none.
 *
 * Walked as an anonymous visitor (an empty browser, no cookie), held and then live:
 *   - three guests wait (invented names, status pending, standing guest: the rows `registerAsGuest` writes);
 *   - the switch is the app's own row (`PlatformSetting` "signins", what `setSignInsOpen` writes): held, read, then "open", read;
 *   - /live/<token> and /live/<token>/event say no guest's name (in the page's words or in its markup), no waiting word and no
 *     count of guests; /live/<token>/event says "4 places left" (eight places, four members confirmed: the guests take none);
 *   - the share picture is a PNG; its link in the page's markup is the route's own; and its bytes are IDENTICAL with the guests
 *     waiting, held and live, and with no guest at all: the picture's inputs do not include them (a PNG's words cannot be
 *     read, so this asserts on what the route is handed, the way the existing image specs do).
 *   - CONTROLS: the guests really are in the database (pending, standing guest, all three, by name) and the secretary, signed
 *     in with `signedInNow`, is shown them on Entries, so a page that "finds nothing" because nothing was seeded fails.
 *
 * On a server that never holds (dev, CI, e2e) the row is inert, so the "held" read is the same page as the live one: the
 * walk still runs and still means something (no guest on either); on a holding server (see `go-live-switch.spec.ts`) the
 * switch also turns every held page to its live words. It writes the shared "signins" row and puts it back exactly as it was.
 *
 * Fixtures: club `zz-b97`, invented names, no email typed anywhere, `dropClub` in a `finally`.
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): CI runs it first.
 */

const MARK = "zz-b97";
const GUESTS = ["Zz-b97 Wilhelmina Quarrington", "Zz-b97 Barnaby Thistlewood-Pike", "Zz-b97 Ottoline Fenwick-Ashby"];
const TOKEN = `ZZB97${randomBytes(6).toString("hex").toUpperCase()}`;
const CAPACITY = 8;
const MEMBERS = 4;

test.describe.configure({ mode: "serial" });

let club: Club;
let eventId = "";
let shareToken = "";
let savedSwitch: { value: string } | null = null;

async function setSwitch(value: "held" | "open") {
  // What `setSignInsOpen` writes.
  await prisma.platformSetting.upsert({ where: { key: "signins" }, update: { value }, create: { key: "signins", value } });
}

/** What an anonymous visitor is shown at one address: the status, the visible words, the raw markup. */
async function visit(browser: Browser, baseURL: string, path: string) {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const res = await page.goto(`${path}?bust=${Date.now()}`);
    expect(res?.status(), `${path} answered ${res?.status()}`).toBe(200);
    await page.waitForLoadState("networkidle").catch(() => {});
    const html = await page.content();
    const words = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    return { html, words };
  } finally {
    await context.close();
  }
}

async function picture(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
  try {
    const res = await context.request.get(`/live/${shareToken}/opengraph-image?bust=${Date.now()}`);
    expect(res.status(), "the share picture did not answer").toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const body = await res.body();
    expect(body.length, "the share picture is empty").toBeGreaterThan(1000);
    return body;
  } finally {
    await context.close();
  }
}

/** What must not be on a public page, held or live. */
function expectNoGuest(where: string, seen: { html: string; words: string }) {
  for (const name of GUESTS) {
    expect(seen.words, `${where}: shows the waiting guest ${name}`).not.toContain(name);
    expect(seen.html, `${where}: its markup carries the waiting guest ${name}`).not.toContain(name);
    // A surname alone is a name too.
    const surname = name.split(" ").slice(-1)[0];
    expect(seen.html, `${where}: its markup carries ${surname}`).not.toContain(surname);
  }
  expect(seen.words, `${where}: says somebody is waiting or pending`).not.toMatch(/\b(waiting|pending|awaiting)\b/i);
  expect(seen.words, `${where}: counts guests`).not.toMatch(/\b\d+\s+(guests?|waiting|pending|requests?)\b/i);
  expect(seen.words, `${where}: counts the entries asked for`).not.toMatch(/\b(guests?|waiting|pending)\s*[:(]?\s*\d+\b/i);
}

test.beforeAll(async () => {
  await dropClub(MARK);
  savedSwitch = await prisma.platformSetting.findUnique({ where: { key: "signins" }, select: { value: true } });
  club = await makeClub(MARK);
  const made = await makeEvent(club, "Open Outing", {
    status: "draft",
    stages: [{ scoringBasis: "gross" }],
    players: MEMBERS,
    event: { leaderboardVisibility: "public", registrationOpen: true, registrationToken: TOKEN, guestEntryOpen: true, capacity: CAPACITY },
  });
  eventId = made.event.id;
  shareToken = made.event.shareToken;
  const top = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  for (const [i, name] of GUESTS.entries()) {
    await prisma.player.create({
      data: { eventId, name, handicap: 0, handicapSource: "none", handicapType: "18", seed: (top._max.seed ?? 0) + i + 1, status: "pending", standing: "guest", email: "", phone: "" },
    });
  }
});

test.afterAll(async () => {
  try {
    if (savedSwitch) await prisma.platformSetting.upsert({ where: { key: "signins" }, update: { value: savedSwitch.value }, create: { key: "signins", value: savedSwitch.value } });
    else await prisma.platformSetting.deleteMany({ where: { key: "signins" } });
    await dropClub(MARK);
  } finally {
    await prisma.$disconnect();
  }
});

test("CONTROL: the guests are really waiting in the database, and the secretary is shown them", async ({ browser, baseURL }) => {
  const rows = await prisma.player.findMany({ where: { eventId, standing: "guest" }, select: { name: true, status: true } });
  expect(rows.map((r) => r.name).sort(), "the guests were not seeded").toEqual([...GUESTS].sort());
  for (const r of rows) expect(r.status, `${r.name} is not waiting`).toBe("pending");
  expect(await prisma.player.count({ where: { eventId, status: "confirmed" } }), "the members were not seeded").toBe(MEMBERS);
  expect(NAMES.length).toBeGreaterThanOrEqual(MEMBERS);

  // The secretary (signed in with `signedInNow`) is shown the same names on Entries: the page that hides them from a
  // stranger is hiding something that exists.
  const desk = await browser.newContext({ baseURL: baseURL!, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
  try {
    await signIn(desk, baseURL!, club, eventId);
    const page = await desk.newPage();
    const res = await page.goto(`/registration?bust=${Date.now()}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText(GUESTS[0]).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await desk.close();
  }
});

test("held then live, the public board, the event page and the share picture name no guest and count none", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const pages = [`/live/${shareToken}`, `/live/${shareToken}/event`];

  // HELD.
  await setSwitch("held");
  const held: Record<string, { html: string; words: string }> = {};
  for (const p of pages) {
    held[p] = await visit(browser, baseURL!, p);
    expectNoGuest(`held ${p}`, held[p]);
  }
  expect(held[pages[1]].words, "held: the event page does not say how many places are left").toContain(`${CAPACITY - MEMBERS} places left`);
  const heldPicture = await picture(browser, baseURL!);

  // THE SWITCH GOES LIVE (the row the owner's Go live press writes).
  await setSwitch("open");
  const live: Record<string, { html: string; words: string }> = {};
  for (const p of pages) {
    live[p] = await visit(browser, baseURL!, p);
    expectNoGuest(`live ${p}`, live[p]);
  }
  // The one figure a stranger may read: places left, and the waiting guests take none of them.
  expect(live[pages[1]].words, "live: the event page does not say how many places are left").toContain(`${CAPACITY - MEMBERS} places left`);
  expect(live[pages[0]].html, "live: the share picture's link is not the route's own").toMatch(/og:image[^>]*\/live\/[^"']+\/opengraph-image/);

  // THE SHARE PICTURE: a PNG whose words cannot be read, so what it is handed is what is asserted. The same bytes with
  // three guests waiting, held and live, and with none at all.
  const livePicture = await picture(browser, baseURL!);
  expect(Buffer.compare(heldPicture, livePicture), "the share picture changed when sign-ins went live").toBe(0);
  await prisma.player.deleteMany({ where: { eventId, standing: "guest" } });
  const noGuests = await picture(browser, baseURL!);
  expect(Buffer.compare(livePicture, noGuests), "the share picture depends on the waiting guests").toBe(0);
  expect(await prisma.player.count({ where: { eventId, standing: "guest" } })).toBe(0);
});
