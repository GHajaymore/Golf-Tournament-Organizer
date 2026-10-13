import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "./coverage";
import { consoleScreens, playerScreens } from "./routes";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * WHAT SOMEBODY WHO MEANS HARM CAN DO FROM OUTSIDE — asked in a browser, of
 * the built app, the way they would ask it.
 *
 * `every-action-vs-a-stranger.spec` is the other half and the larger one: it
 * calls every server action as somebody signed out, as a stranger and as a
 * member, and holds each to refusing. This file is everything that is NOT a
 * server action, which until 2026-10-13 was checked in pieces by unit tests
 * that read source (`public-surface.test.ts`, `secure-cookies.test.ts`) and
 * by nothing that asked a running server:
 *
 *   the envelope     the headers every answer is sent in, and what the server
 *                    says about itself
 *   the front door   signed out, no screen of the app opens, and nothing of a
 *                    club is in what comes back instead
 *   the way back     an address handed to sign-in to "go on to" cannot be
 *                    somebody else's site
 *   what is sent     nothing secret is in the scripts the browser downloads,
 *                    and their sources are not published beside them
 *   what is typed    a name, a tournament's title and a club's colour are
 *                    TEXT wherever they are drawn — never markup, never script
 *   another site     a form on somebody else's page cannot act as you
 *   wrong addresses  a bad link answers "not found", never the inside of the app
 *
 * Ajay, 2026-10-13: "please also add the security/vulnerability testing as well
 * in the framework." Known holes in the libraries the app is built from are the
 * other kind of vulnerability, and `scripts/qa/dependencies.mjs` asks about
 * those; a secret committed to this public repository is a third, and
 * `no-secret-is-committed.test.ts` sweeps for it.
 *
 * WHAT THIS CANNOT SEE: production's own envelope (HTTPS, HSTS and whatever
 * Vercel adds or strips), a fault that needs two requests racing, and anything
 * a determined person finds by reading the code. It is a floor, not an audit.
 *
 * One project: none of this changes with the width of a screen.
 */

const DIST = process.env.NEXT_DIST_DIR ?? ".next-e2e";
const MARK = `zz-sec-${randomBytes(3).toString("hex")}`;
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

/** Things typed by a person that the app then draws. Each would run, or break the page, if it were ever written as markup. */
const HOSTILE = {
  // In a name: an element with a handler.
  player: `${MARK} <img src=x onerror="window.__xss='player'">`,
  // In a tournament's title, which is also written into the page's structured data: closing the script it sits in.
  event: `${MARK} </script><script>window.__xss='event'</script>`,
  // In a club's name, which is drawn in every header.
  club: `${MARK} "><svg onload="window.__xss='club'">`,
  // In a club's own colour, which is written into a style sheet.
  colour: `#fff;}</style><script>window.__xss='colour'</script>`,
  // In an announcement, which is prose and the likeliest place for somebody to try a link.
  note: `${MARK} <a href="javascript:window.__xss='note'">click</a>`,
};

type Made = { orgId: string; eventId: string; token: string; organizer: string; player: string };
let made: Made | null = null;
const prisma = new PrismaClient();

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  const org = await prisma.organization.create({
    data: { name: HOSTILE.club, kind: "club", themeAppearance: "auto", themeKey: "custom", themeHex: HOSTILE.colour, themeSecondaryKey: "custom", themeSecondaryHex: HOSTILE.colour },
  });
  const token = `${MARK}-token`;
  const event = await prisma.event.create({
    data: {
      name: HOSTILE.event,
      organizationId: org.id,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "May 2026",
      course: HOSTILE.player,
      city: HOSTILE.player,
      address: "",
      regDeadline: "",
      sideStyle: "individual",
      shareToken: token,
      leaderboardVisibility: "public",
      customPars: JSON.stringify(Array(18).fill(4)),
      customYards: JSON.stringify(Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      tiebreakers: JSON.stringify([]),
      attendanceMode: "opt-out",
    },
  });
  await prisma.stage.create({
    data: { eventId: event.id, position: 0, description: HOSTILE.player, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "net", handicapAllowance: 95 },
  });
  const organizer = await prisma.user.create({ data: { email: `${MARK}-organizer@example.invalid`, name: HOSTILE.player, password: "x:unusable" } });
  await prisma.account.create({ data: { eventId: event.id, name: HOSTILE.player, email: organizer.email, role: "admin" } });
  const player = await prisma.user.create({ data: { email: `${MARK}-player@example.invalid`, name: HOSTILE.player, password: "x:unusable" } });
  // A player is somebody the tournament has an account for and the club has on its list.
  await prisma.account.create({ data: { eventId: event.id, name: HOSTILE.player, email: player.email, role: "player" } });
  await prisma.member.create({ data: { organizationId: org.id, name: HOSTILE.player, email: player.email, handicap: 10, handicapType: "18", handicapSource: "manual" } });
  for (const [i, email] of [player.email, `${MARK}-other@example.invalid`].entries()) {
    await prisma.player.create({ data: { eventId: event.id, name: HOSTILE.player, email, handicap: 10 + i, seed: i + 1, status: "confirmed" } });
  }
  await prisma.announcement.create({ data: { eventId: event.id, title: HOSTILE.note, body: HOSTILE.note, pinned: true } });
  made = { orgId: org.id, eventId: event.id, token, organizer: sign(signedInNow(organizer.id)), player: sign(signedInNow(player.id)) };
});

test.afterAll(async () => {
  if (made) {
    await prisma.event.deleteMany({ where: { id: made.eventId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: made.orgId } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } }).catch(() => {});
  await prisma.$disconnect();
});

const onlyDesktop = (name: string) => test.skip(name !== "desktop", "one project: none of this changes with the width of a screen");

test("every answer is sent in the envelope that protects it, and the server does not say what it is", async ({ request }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  // A page for everybody, a page behind sign-in (the redirect itself), a public board, a file, and a wrong address.
  const paths = ["/", "/faq", "/privacy", "/terms", "/dashboard", `/live/${made!.token}`, "/robots.txt", "/no-such-page"];
  const faults: string[] = [];
  for (const path of paths) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    if (h["x-content-type-options"] !== "nosniff") faults.push(`${path}: a browser may guess its type (x-content-type-options is ${h["x-content-type-options"] ?? "missing"})`);
    if (!/^(SAMEORIGIN|DENY)$/i.test(h["x-frame-options"] ?? "") && !/frame-ancestors/.test(h["content-security-policy"] ?? "")) faults.push(`${path}: another site may put it in a frame`);
    if (!h["referrer-policy"]) faults.push(`${path}: no referrer policy — a link out carries the address it was clicked on`);
    if (!h["permissions-policy"]) faults.push(`${path}: no permissions policy`);
    if (h["x-powered-by"]) faults.push(`${path}: the server names its software (x-powered-by: ${h["x-powered-by"]})`);
    if (/\bnext\.js\b/i.test(h["server"] ?? "")) faults.push(`${path}: the server names its software (server: ${h["server"]})`);
  }
  // CONTROL: the answers were real ones.
  expect((await request.get("/")).status()).toBe(200);
  expect(faults, faults.join("\n")).toEqual([]);
});

test("signed out, no screen of the app opens — and nothing of a club comes back instead", async ({ playwright, baseURL }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const screens = [...consoleScreens(), ...playerScreens(), "/account", "/choose", "/owner"];
  const faults: string[] = [];
  let sentAway = 0;
  for (const path of screens) {
    const res = await anon.get(path, { maxRedirects: 0 });
    const status = res.status();
    const body = await res.text();
    if (status >= 300 && status < 400) {
      sentAway += 1;
      const to = res.headers()["location"] ?? "";
      if (/^https?:\/\//.test(to) && !to.startsWith(baseURL!)) faults.push(`${path}: sent to another site (${to})`);
    } else if (status === 404) {
      sentAway += 1;
    } else {
      faults.push(`${path}: answered ${status} to somebody signed out`);
    }
    // Whatever came back, it carries nobody's name and nobody's address.
    if (body.includes(MARK) || /@example\.invalid/.test(body)) faults.push(`${path}: the answer to a signed-out visitor carries a club's data`);
  }
  await anon.dispose();
  // CONTROL: this read a real list, and every one of them was refused.
  expect(screens.length).toBeGreaterThan(30);
  expect(sentAway, "some screens were neither refused nor reported").toBe(screens.length - faults.filter((f) => f.includes("answered")).length);
  expect(faults, faults.join("\n")).toEqual([]);
});

test("the address to go on to after signing in cannot be somebody else's site", async ({ playwright, baseURL }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  const me = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [{ name: "ng_session", value: made!.organizer, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] },
  });
  const elsewhere = ["https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "https:evil.example", "javascript:alert(1)", "/%2F%2Fevil.example"];
  const faults: string[] = [];
  for (const next of elsewhere) {
    for (const door of ["/", "/play", "/choose"]) {
      const res = await me.get(`${door}?next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
      const to = res.headers()["location"] ?? "";
      if (!to) continue;
      const landing = new URL(to, baseURL);
      if (landing.origin !== new URL(baseURL!).origin) faults.push(`${door}?next=${next} sends a signed-in person to ${to}`);
      if (/^javascript:/i.test(to)) faults.push(`${door}?next=${next} hands back a script as an address`);
    }
  }
  // CONTROL: the session is a real one — the front door sends this person INTO the app.
  const home = await me.get("/", { maxRedirects: 0 });
  expect([200, 302, 303, 307, 308]).toContain(home.status());
  await me.dispose();
  expect(faults, faults.join("\n")).toEqual([]);
});

test("nothing secret is in the scripts the browser downloads, and their sources are not published", async ({ request }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  const root = join(process.cwd(), DIST, "static");
  test.skip(!existsSync(root), `no build at ${DIST} to read`);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|css|json|txt|map)$/.test(name)) files.push(p);
    }
  };
  walk(root);
  // Shapes of things that must never be shipped. Values, not names: the NAME of a setting in a message is not a leak.
  const SECRETS: Array<[string, RegExp]> = [
    ["a database address with a password in it", /postgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@/]+@/i],
    ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["a live payment key", /\b(sk|rk)_live_[0-9a-zA-Z]{16,}/],
    ["a GitHub token", /\bgh[pousr]_[0-9A-Za-z]{30,}/],
    ["a Vercel token", /\bvercel_[0-9A-Za-z]{20,}/i],
    ["a mail or SMS provider key", /\b(re_[0-9A-Za-z]{20,}|SG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}|AC[0-9a-f]{32})\b/],
  ];
  const own = process.env.AUTH_SECRET ?? "";
  const faults: string[] = [];
  let read = 0;
  let sawTheApp = false;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    read += 1;
    if (text.includes("__thqHydrationReplayBackport")) sawTheApp = true;
    const where = file.slice(root.length + 1).replace(/\\/g, "/");
    if (file.endsWith(".map")) faults.push(`${where}: a source map is in what gets served`);
    if (own.length >= 12 && text.includes(own)) faults.push(`${where}: carries this server's own signing key`);
    for (const [what, pattern] of SECRETS) if (pattern.test(text)) faults.push(`${where}: carries ${what}`);
  }
  // CONTROL: the scripts were found and read — one of them is known to carry a marker the build puts there.
  expect(read, "the build's scripts were not found").toBeGreaterThan(20);
  expect(sawTheApp, "none of the files read was the app's own bundle").toBe(true);
  // And a script's source map is not handed out on request either.
  const chunk = files.find((f) => f.endsWith(".js") && statSync(f).size > 20_000)!;
  const url = `/_next/static/${chunk.slice(root.length + 1).replace(/\\/g, "/")}`;
  expect((await request.get(url)).status(), `${url} is not served — the control is reading the wrong place`).toBe(200);
  expect((await request.get(`${url}.map`)).status(), `${url}.map is published`).toBe(404);
  expect(faults, faults.join("\n")).toEqual([]);
});

test("what a person types is text wherever it is drawn — a name, a title, a club's colour, a notice", async ({ browser, baseURL }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  test.setTimeout(240_000);
  const faults: string[] = [];
  const where: Record<string, string> = {};
  const visit = async (who: "organizer" | "player" | "nobody", paths: string[]) => {
    const context = await browser.newContext();
    if (who !== "nobody") {
      await context.addCookies([
        { name: "ng_session", value: who === "organizer" ? made!.organizer : made!.player, url: baseURL! },
        { name: "ng_active_event", value: sign(made!.eventId), url: baseURL! },
      ]);
    }
    const page = await context.newPage();
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    let drew = 0;
    const trail: string[] = [];
    for (const path of paths) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      if (!res || res.status() >= 500) faults.push(`${who} ${path}: answered ${res?.status() ?? "nothing"} — a hostile name broke the screen`);
      const seen = await page.evaluate((mark) => ({
        ran: (window as unknown as { __xss?: string }).__xss ?? "",
        // Elements that exist only if a typed value was written as markup.
        made: document.querySelectorAll('img[src="x"], svg[onload], a[href^="javascript:"], script:not([src]):not([type])').length,
        scripts: Array.from(document.querySelectorAll("script:not([src])")).filter((s) => (s.textContent ?? "").trim().startsWith("window.__xss")).length,
        shown: document.body.innerText.includes(mark),
      }), MARK);
      if (seen.ran) faults.push(`${who} ${path}: a typed ${seen.ran} value RAN as script`);
      if (seen.scripts) faults.push(`${who} ${path}: a typed value became a script element`);
      if (await page.locator('img[src="x"], svg[onload], a[href^="javascript:"]').count()) faults.push(`${who} ${path}: a typed value became an element`);
      if (seen.shown) drew += 1;
      trail.push(`${path}→${new URL(page.url()).pathname}${seen.shown ? " (drawn)" : ""}`);
    }
    if (dialogs) faults.push(`${who}: ${dialogs} dialog(s) opened — something typed was run`);
    await context.close();
    where[who] = trail.join("  ");
    return drew;
  };
  const console_ = consoleScreens();
  const drewForOrganizer = await visit("organizer", ["/dashboard", ...console_]);
  const drewForPlayer = await visit("player", playerScreens());
  const drewForNobody = await visit("nobody", [`/live/${made!.token}`, `/live/${made!.token}/rules`]);
  // CONTROL: the hostile values really were drawn — as text — on a good many screens, to each kind of visitor.
  expect(drewForOrganizer, `the organizer's screens never showed the hostile names: the fixture did not take — ${where.organizer}`).toBeGreaterThan(8);
  expect(drewForPlayer, `the player's screens never showed them — ${where.player}`).toBeGreaterThan(2);
  expect(drewForNobody, `the public board never showed them — ${where.nobody}`).toBeGreaterThan(0);
  expect(faults, faults.join("\n")).toEqual([]);
});

test("a page on another site cannot act as somebody who is signed in here", async ({ playwright, baseURL }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  const manifest = join(process.cwd(), DIST, "server", "server-reference-manifest.json");
  test.skip(!existsSync(manifest), `no build at ${DIST} to read`);
  const ids = Object.keys(JSON.parse(readFileSync(manifest, "utf8")).node ?? {});
  expect(ids.length, "the build lists no server actions").toBeGreaterThan(100);
  const me = await playwright.request.newContext({
    baseURL,
    storageState: {
      cookies: [
        { name: "ng_session", value: made!.organizer, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
        { name: "ng_active_event", value: sign(made!.eventId), domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    },
  });
  const before = await prisma.event.findUnique({ where: { id: made!.eventId }, select: { name: true, status: true } });
  const accepted: string[] = [];
  // The same call a form on this site makes — but saying it comes from somewhere else.
  for (const id of ids.slice(0, 40)) {
    const res = await me.post("/dashboard", {
      headers: { "next-action": id, origin: "https://evil.example", "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" },
      data: "[]",
      maxRedirects: 0,
    });
    if (res.status() < 400) accepted.push(`${id.slice(0, 10)}… answered ${res.status()}`);
  }
  // CONTROL: the same person, from THIS site, is let through to the action (which may then refuse the empty call in words).
  const own = await me.post("/dashboard", {
    headers: { "next-action": ids[0], origin: new URL(baseURL!).origin, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" },
    data: "[]",
    maxRedirects: 0,
  });
  await me.dispose();
  expect(own.status(), "a call from this site was refused too: the check proves nothing").toBeLessThan(500);
  expect(accepted, `calls from another site were answered:\n${accepted.join("\n")}`).toEqual([]);
  const after = await prisma.event.findUnique({ where: { id: made!.eventId }, select: { name: true, status: true } });
  expect(after).toEqual(before);
});

test("a wrong address answers 'not found' — never an error with the inside of the app in it", async ({ request }, testInfo) => {
  onlyDesktop(testInfo.project.name);
  const wrong = [
    "/live/not-a-real-token",
    "/live/not-a-real-token/rules",
    "/register/not-a-real-token",
    "/reset-password?token=not-a-real-token",
    "/match/not-a-real-id",
    "/play/not-a-real-code",
    "/api/no-such-route",
    "/owner",
    "/_next/static/../../package.json",
    "/.env",
    "/.git/config",
  ];
  const faults: string[] = [];
  for (const path of wrong) {
    const res = await request.get(path, { maxRedirects: 0 });
    const body = await res.text();
    if (res.status() >= 500) faults.push(`${path}: answered ${res.status()}`);
    if (/\bat [\w.<>$ ]+ \((?:\/|[A-Z]:\\|webpack|node:)/.test(body) || /node_modules[\\/]/.test(body)) faults.push(`${path}: the answer carries a stack trace`);
    if (/PrismaClient|DATABASE_URL|AUTH_SECRET=/.test(body)) faults.push(`${path}: the answer names the app's insides`);
    if (path === "/.env" || path === "/.git/config" || path.includes("package.json")) {
      if (res.status() === 200 && !/<html/i.test(body)) faults.push(`${path}: a file of the project is served`);
    }
  }
  expect(faults, faults.join("\n")).toEqual([]);
});
