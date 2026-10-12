/**
 * Rebuild the organizer guide's PDF from the guide itself.
 *
 * `/guide/steps` has a Download PDF button, and the file behind it was made
 * once by hand — so the first edit to `src/lib/guide-steps.ts` left the page
 * and the download saying different things, with nothing to notice. This
 * prints the PAGE to the file, so the PDF can only ever say what the guide
 * says. CLAUDE.md's "Help and docs travel with the change" asks for a run
 * whenever the guide changes.
 *
 * It needs a BUILT server showing the code you are about to commit (a dev
 * server draws its "N" badge into the page):
 *
 *     NEXT_DIST_DIR=.next-ci npx next build
 *     NEXT_DIST_DIR=.next-ci npx next start --port 3102     # in another shell
 *     node scripts/build-guide-pdf.mjs                      # GUIDE_BASE_URL to point elsewhere
 *
 * The guide is a staff screen, so this signs in as a throwaway organizer of a
 * throwaway tournament — marked, invented, `@example.invalid` — and deletes
 * both in a `finally`. It refuses any database that is not on localhost: the
 * fixture is two rows, but a write is a write.
 */
import { runMark } from "./run-mark.mjs";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { signedInNow } from "./session-cookie.mjs";

const BASE = process.env.GUIDE_BASE_URL ?? "http://127.0.0.1:3102";
const OUT = "public/guide/tourneyhq-organizer-guide.pdf";
const MARK = runMark("zz-guide-pdf");

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`refusing to seed a fixture on ${host}: this script writes only to the development database`);
  }
  const up = await fetch(BASE, { redirect: "manual" }).then((r) => r.status, () => 0);
  if (up === 0) throw new Error(`nothing is answering on ${BASE} — start a built server first (see this file's header)`);

  const { PrismaClient } = await import("@prisma/client");
  const { chromium } = await import("@playwright/test");
  const prisma = new PrismaClient();
  const made = { orgId: null, eventId: null, userId: null };
  let browser = null;

  try {
    // Anything a killed run left behind holds this run's email.
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });

    const org = await prisma.organization.create({ data: { name: `${MARK}-club`, kind: "club" } });
    made.orgId = org.id;
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-event`, organizationId: org.id, status: "draft", shape: "series", dates: "",
        course: "", city: "", address: "", regDeadline: "", shareToken: randomBytes(12).toString("hex"),
      },
    });
    made.eventId = event.id;
    const user = await prisma.user.create({
      data: { email: `${MARK}@example.invalid`, name: "Guide Organizer", password: `${randomBytes(8).toString("hex")}:unusable` },
    });
    made.userId = user.id;
    await prisma.account.create({ data: { eventId: event.id, name: user.name, email: user.email, role: "admin" } });

    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const sign = (v) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;

    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: BASE, colorScheme: "light" });
    await context.addCookies([{ name: "ng_session", value: sign(signedInNow(user.id)), url: BASE }]);
    const page = await context.newPage();
    const res = await page.goto("/guide/steps");
    await page.waitForLoadState("networkidle");
    // A redirect to sign-in is a 200 too: assert the guide itself arrived.
    const heading = await page.locator("h1").first().innerText().catch(() => "");
    if (res?.status() !== 200 || !/step-by-step guide/i.test(heading)) {
      throw new Error(`did not reach the guide (status ${res?.status()}, heading "${heading}") — is AUTH_SECRET the server's?`);
    }
    // Every quick fix printed open, and nothing that is only a screen control.
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("details")) d.open = true;
      for (const el of document.querySelectorAll("a[download], input[type=search]")) {
        (el.closest(".card") ?? el).remove();
      }
      // The bar naming the open tournament. It prints on purpose — a printed
      // tee sheet should say whose it is — but the guide belongs to no
      // tournament, and here it would print the throwaway one's name.
      for (const el of document.querySelectorAll(".event-context-bar")) el.remove();
    });
    await page.emulateMedia({ media: "print" });
    // The fixture's own names must not be printed: the file is committed to a
    // public repository and handed to every club. Print hides the console's
    // chrome, and this refuses to write a PDF if any of it survived.
    const leaks = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent ?? "";
        if (!t.includes("zz-guide-pdf") && !t.includes("Guide Organizer")) continue;
        const el = n.parentElement;
        if (!el || el.closest("script, style")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).visibility === "hidden") continue;
        const box = el.closest("[class]");
        out.push(`${box?.tagName.toLowerCase()}.${String(box?.className).split(" ")[0]}: "${t.trim().slice(0, 40)}"`);
      }
      return out;
    });
    if (leaks.length) {
      throw new Error(`the throwaway organizer or tournament is on the printed page — not hidden in print:\n  ${leaks.join("\n  ")}`);
    }
    // GUIDE_PREVIEW=<file.png> photographs the first sheet as it will print.
    if (process.env.GUIDE_PREVIEW) {
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.screenshot({ path: process.env.GUIDE_PREVIEW });
    }
    await page.pdf({
      path: OUT,
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    const parts = await page.locator("section[aria-labelledby]").count();
    console.log(`wrote ${OUT}: ${parts} parts, ${Math.round(statSync(OUT).size / 1024)} KB`);
  } finally {
    if (browser) await browser.close();
    if (made.eventId) {
      await prisma.account.deleteMany({ where: { eventId: made.eventId } });
      await prisma.event.delete({ where: { id: made.eventId } });
    }
    if (made.orgId) await prisma.organization.delete({ where: { id: made.orgId } });
    if (made.userId) await prisma.user.delete({ where: { id: made.userId } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
